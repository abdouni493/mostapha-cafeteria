/**
 * ─── Les alertes de l'application ──────────────────────────────────────────────
 *
 * UNE seule source. La cloche de la barre supérieure, la pastille de la barre
 * latérale et le bandeau du tableau de bord lisent tous cette liste : trois
 * calculs séparés auraient fini par se contredire, et un gérant qui voit « 3 »
 * sur la cloche et « 5 » sur le tableau de bord ne fait plus confiance ni à
 * l'un ni à l'autre.
 *
 * Rien n'est stocké : une alerte se DÉDUIT de l'état à chaque affichage. La
 * stocker obligerait à la recalculer dès qu'un stock bouge, et un produit
 * réapprovisionné laisserait une alerte fantôme.
 *
 * Ce qui est stocké en revanche, c'est ce que l'utilisateur en a fait : une
 * alerte écartée reste écartée (dans CE navigateur), jusqu'à ce que sa cause
 * change — un produit qui retombe sous le seuil après un réapprovisionnement
 * ré-alerte, parce que sa signature a changé entre-temps.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BizState, ModuleKey, Cafeteria, routeBaseOf, isReversedSale } from '../lib/bizConfig';

export type AlertLevel = 'danger' | 'warning' | 'info';

export interface CafAlert {
  /** Identifiant DÉTERMINISTE : deux calculs de la même alerte doivent tomber
   *  sur la même clé, sinon « écarter » ne tiendrait jamais. */
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  /** Cafétéria concernée — absent pour une alerte transversale. */
  cafeteriaId?: ModuleKey;
  cafeteriaName?: string;
  /** Où aller pour traiter l'alerte. */
  link: string;
  /** Nombre d'éléments derrière l'alerte (produits, tickets…). */
  count: number;
}

/** Jours avant péremption à partir desquels on prévient. */
const EXPIRY_WARN_DAYS = 21;

const dayDiff = (iso?: string): number | null => {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86_400_000);
};

/**
 * Construit les alertes d'une liste de cafétérias.
 *
 * `cafeterias` est déjà filtrée par l'appelant sur ce que l'utilisateur a le
 * droit de voir : un employé ne doit pas apprendre, par une alerte, qu'une
 * autre cafétéria est en rupture.
 */
export function buildCafeteriaAlerts(state: BizState, cafeterias: Cafeteria[]): CafAlert[] {
  const out: CafAlert[] = [];

  for (const caf of cafeterias) {
    const mod = state.modules[caf.id];
    if (!mod) continue;
    const base = routeBaseOf(caf.id);
    const tag = (s: string) => `${caf.id}:${s}`;

    // ── Ruptures et stocks bas ──────────────────────────────────────────
    const out0 = mod.products.filter(p => (p.currentQty ?? 0) <= 0);
    const low = mod.products.filter(p => (p.currentQty ?? 0) > 0 && (p.currentQty ?? 0) <= (p.minQty ?? 0));

    if (out0.length) {
      out.push({
        id: tag(`stock-out:${out0.length}`),
        level: 'danger',
        title: `${out0.length} produit${out0.length > 1 ? 's' : ''} en rupture`,
        detail: out0.slice(0, 3).map(p => p.name).join(', ') + (out0.length > 3 ? '…' : ''),
        cafeteriaId: caf.id, cafeteriaName: caf.name,
        link: `${base}/stock`, count: out0.length,
      });
    }
    if (low.length) {
      out.push({
        id: tag(`stock-low:${low.length}`),
        level: 'warning',
        title: `${low.length} produit${low.length > 1 ? 's' : ''} sous le seuil`,
        detail: low.slice(0, 3).map(p => p.name).join(', ') + (low.length > 3 ? '…' : ''),
        cafeteriaId: caf.id, cafeteriaName: caf.name,
        link: `${base}/stock`, count: low.length,
      });
    }

    // ── Péremptions ─────────────────────────────────────────────────────
    // Une cafétéria vend du frais : trois semaines d'avance, c'est le délai
    // qui laisse encore le temps d'écouler la marchandise en promotion.
    const expiring = mod.products.filter(p => {
      if (!p.hasExpiration || !p.expirationDate) return false;
      const d = dayDiff(p.expirationDate);
      return d !== null && d <= EXPIRY_WARN_DAYS;
    });
    if (expiring.length) {
      const expired = expiring.filter(p => (dayDiff(p.expirationDate) ?? 0) < 0);
      out.push({
        id: tag(`expiry:${expiring.length}:${expired.length}`),
        level: expired.length ? 'danger' : 'warning',
        title: expired.length
          ? `${expired.length} produit${expired.length > 1 ? 's' : ''} périmé${expired.length > 1 ? 's' : ''}`
          : `${expiring.length} péremption${expiring.length > 1 ? 's' : ''} proche${expiring.length > 1 ? 's' : ''}`,
        detail: expiring.slice(0, 3).map(p => p.name).join(', ') + (expiring.length > 3 ? '…' : ''),
        cafeteriaId: caf.id, cafeteriaName: caf.name,
        link: `${base}/stock`, count: expiring.length,
      });
    }

    // ── Sessions de caisse restées ouvertes ─────────────────────────────
    // Une session oubliée fausse le décalage du lendemain : c'est l'erreur la
    // plus fréquente et la plus coûteuse à démêler après coup.
    const stale = mod.sessions.filter(s => {
      if (s.status !== 'open') return false;
      const opened = new Date(s.openedAt).getTime();
      return Number.isFinite(opened) && Date.now() - opened > 14 * 3_600_000;
    });
    if (stale.length) {
      out.push({
        id: tag(`session-open:${stale.map(s => s.id).join(',')}`),
        level: 'warning',
        title: `${stale.length} session${stale.length > 1 ? 's' : ''} de caisse non clôturée${stale.length > 1 ? 's' : ''}`,
        detail: stale.map(s => s.workerName).join(', '),
        cafeteriaId: caf.id, cafeteriaName: caf.name,
        link: `${base}/pos`, count: stale.length,
      });
    }

    // ── Créances clients ────────────────────────────────────────────────
    const credit = mod.sales.filter(s => !isReversedSale(s) && (s.rest ?? 0) > 0);
    if (credit.length) {
      const total = credit.reduce((a, s) => a + (s.rest || 0), 0);
      out.push({
        id: tag(`credit:${credit.length}:${Math.round(total)}`),
        level: 'info',
        title: `${credit.length} vente${credit.length > 1 ? 's' : ''} à crédit`,
        detail: `${total.toLocaleString('fr-DZ')} DA restant à encaisser`,
        cafeteriaId: caf.id, cafeteriaName: caf.name,
        link: `${base}/clients`, count: credit.length,
      });
    }

    // ── Dettes fournisseurs ─────────────────────────────────────────────
    const owed = mod.purchases.filter(p => (p.rest ?? 0) > 0);
    if (owed.length) {
      const total = owed.reduce((a, p) => a + (p.rest || 0), 0);
      out.push({
        id: tag(`supplier-debt:${owed.length}:${Math.round(total)}`),
        level: 'info',
        title: `${owed.length} facture${owed.length > 1 ? 's' : ''} fournisseur impayée${owed.length > 1 ? 's' : ''}`,
        detail: `${total.toLocaleString('fr-DZ')} DA dus`,
        cafeteriaId: caf.id, cafeteriaName: caf.name,
        link: `${base}/purchases`, count: owed.length,
      });
    }

    // ── Inventaires laissés en plan ─────────────────────────────────────
    const pendingInv = mod.inventaires.filter(i => i.status === 'draft' || i.status === 'compared');
    if (pendingInv.length) {
      out.push({
        id: tag(`inventaire:${pendingInv.map(i => i.id).join(',')}`),
        level: 'info',
        title: `${pendingInv.length} inventaire${pendingInv.length > 1 ? 's' : ''} à terminer`,
        detail: pendingInv.map(i => i.ref).slice(0, 3).join(', '),
        cafeteriaId: caf.id, cafeteriaName: caf.name,
        link: `${base}/inventaire`, count: pendingInv.length,
      });
    }
  }

  // Le plus grave en premier, puis le plus gros volume.
  const rank: Record<AlertLevel, number> = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.count - a.count);
}

const DISMISS_KEY = 'altech.alerts.dismissed';

/** Les alertes écartées dans CE navigateur, et de quoi en écarter d'autres. */
export function useDismissedAlerts() {
  const [ids, setIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-200))); } catch { /* mode privé */ }
  }, [ids]);

  const dismiss = useCallback((id: string) => {
    setIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const restoreAll = useCallback(() => setIds([]), []);

  return { dismissedIds: ids, dismiss, restoreAll };
}

/** Les alertes visibles : construites, puis privées de celles déjà écartées. */
export function useCafeteriaAlerts(
  state: BizState, cafeterias: Cafeteria[], dismissedIds: string[],
): CafAlert[] {
  return useMemo(() => {
    const gone = new Set(dismissedIds);
    return buildCafeteriaAlerts(state, cafeterias).filter(a => !gone.has(a.id));
  }, [state, cafeterias, dismissedIds]);
}
