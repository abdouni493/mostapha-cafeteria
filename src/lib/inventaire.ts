/**
 * ─── L'inventaire physique, du comptage à la correction ────────────────────────
 *
 * Compter le rayon, confronter le comptage à ce que l'application annonce, puis
 * — et seulement si on le décide — aligner le stock sur la réalité.
 *
 * TROIS PRÉCAUTIONS Y SONT PRISES, et chacune règle un problème concret :
 *
 *  1. LE PRIX EST FIGÉ À LA SAISIE. Une ligne comptée garde le prix d'achat du
 *     jour du comptage. Sans cela, rouvrir un inventaire de janvier le
 *     revaloriserait aux prix d'aujourd'hui, et le manquant constaté ne serait
 *     plus celui qu'on avait constaté.
 *
 *  2. LA COMPARAISON EST UNE PHOTO. Elle est calculée une fois, à la demande, et
 *     rangée dans l'inventaire. Recalculer à chaque affichage ferait bouger les
 *     écarts au fil des ventes de la journée, et deux personnes lisant le même
 *     rapport n'y verraient pas la même chose.
 *
 *  3. LA CORRECTION EST RÉVERSIBLE. Les quantités d'AVANT sont sauvegardées dans
 *     l'inventaire lui-même. Un comptage bâclé se rattrape donc en un clic, au
 *     lieu de laisser un stock faux qu'il faudrait redresser produit par produit.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizInventaire, BizInventaireLine, BizInventaireComparison, BizInventaireEcart,
  BizInventaireBackupLine, BizProduct, ModuleState, ModuleKey, formatQty, roundQty,
  inventaireCountsForWorkers,
} from './bizConfig';

// ─── Une ligne comptée ────────────────────────────────────────────────────────

/**
 * Quantité comptée, ramenée à l'unité principale (celle du stock).
 *
 * Un produit vendu au détail se compte comme il se range : « 2 bidons et 15 L ».
 * C'est cette conversion qui permet de comparer à un stock tenu en bidons — et
 * l'oublier ferait passer 15 L pour 15 bidons manquants.
 */
export function countedQtyOf(l: BizInventaireLine): number {
  const base = Number(l.countedQty) || 0;
  if (!l.sellByDetail) return roundQty(base);
  const cap = Number(l.detailCapacity) || 0;
  const detail = Number(l.detailQty) || 0;
  return roundQty(base + (cap > 0 ? detail / cap : 0));
}

/** Comptage tel qu'on l'écrit sur un rapport : « 2 bidons + 15 L ». */
export function countedLabelOf(l: BizInventaireLine): string {
  const base = Number(l.countedQty) || 0;
  const detail = Number(l.detailQty) || 0;
  if (!l.sellByDetail || !detail) return `${formatQty(base)}${l.unit ? ` ${l.unit}` : ''}`;
  return `${formatQty(base)}${l.unit ? ` ${l.unit}` : ''} + ${formatQty(detail)} ${l.detailUnit || ''}`.trim();
}

// ─── La comparaison ───────────────────────────────────────────────────────────

/**
 * Confronte un comptage au stock ACTUEL de l'application.
 *
 * Le stock retenu est celui de l'instant où la comparaison est lancée, pas celui
 * enregistré pendant la saisie : compter le rayon prend une heure, pendant
 * laquelle la caisse continue de vendre. C'est bien l'écart au moment où l'on
 * tranche qui doit être constaté.
 */
export function buildComparison(
  inv: BizInventaire, products: BizProduct[], by?: string,
): BizInventaireComparison {
  const byId = new Map(products.map(p => [p.id, p]));

  const lines: BizInventaireEcart[] = inv.lines.map(l => {
    const counted = countedQtyOf(l);
    const product = byId.get(l.productId);
    const systemQty = roundQty(Number(product?.currentQty) || 0);
    const ecart = roundQty(counted - systemQty);
    const price = Number(l.purchasePrice) || 0;
    return {
      productId: l.productId,
      productName: l.productName || product?.name || '—',
      categoryName: l.categoryName || product?.categoryName,
      unit: l.unit || product?.unit,
      countedQty: counted,
      systemQty,
      ecart,
      purchasePrice: price,
      value: roundQty(ecart * price),
      kind: ecart < 0 ? 'perte' : ecart > 0 ? 'gain' : 'exact',
    };
  });

  // Pertes et gains sont rendus POSITIFS : un rapport qui annonce
  // « −12 400 DA de manquants » se lit deux fois avant d'être compris.
  const losses = lines.filter(l => l.kind === 'perte');
  const gains = lines.filter(l => l.kind === 'gain');

  const lossQty = Math.abs(losses.reduce((s, l) => s + l.ecart, 0));
  const lossValue = Math.abs(losses.reduce((s, l) => s + l.value, 0));
  const gainQty = gains.reduce((s, l) => s + l.ecart, 0);
  const gainValue = gains.reduce((s, l) => s + l.value, 0);

  return {
    at: new Date().toISOString(),
    by,
    lines,
    lossQty: roundQty(lossQty),
    lossValue: roundQty(lossValue),
    gainQty: roundQty(gainQty),
    gainValue: roundQty(gainValue),
    netValue: roundQty(gainValue - lossValue),
    productsCounted: lines.length,
    productsWithEcart: lines.filter(l => l.kind !== 'exact').length,
  };
}

// ─── La correction ────────────────────────────────────────────────────────────

/** Un produit à réécrire, avec sa nouvelle quantité. */
export interface CorrectionDelta {
  product: BizProduct;
  from: number;
  to: number;
  ecart: number;
}

/**
 * Les produits que la correction va toucher — uniquement ceux dont l'écart n'est
 * pas nul. Réécrire une ligne identique la ferait remonter en tête de liste et
 * repartir vers le serveur pour rien.
 */
export function correctionDeltas(
  cmp: BizInventaireComparison | undefined, products: BizProduct[],
): CorrectionDelta[] {
  if (!cmp) return [];
  const byId = new Map(products.map(p => [p.id, p]));
  const out: CorrectionDelta[] = [];
  for (const l of cmp.lines) {
    if (l.kind === 'exact') continue;
    const product = byId.get(l.productId);
    if (!product) continue;   // produit supprimé depuis le comptage
    out.push({
      product,
      from: roundQty(Number(product.currentQty) || 0),
      to: roundQty(l.countedQty),
      ecart: l.ecart,
    });
  }
  return out;
}

/** Résumé lisible de ce que la correction va faire, pour la confirmation. */
export function describeCorrection(deltas: CorrectionDelta[]): string {
  if (!deltas.length) return '';
  const head = deltas.slice(0, 8).map(d =>
    `• ${d.product.name} : ${formatQty(d.from)} → ${formatQty(d.to)} (${d.ecart > 0 ? '+' : ''}${formatQty(d.ecart)})`,
  );
  const rest = deltas.length - head.length;
  return [`${deltas.length} produit(s) seront corrigés :`, ...head, rest > 0 ? `…et ${rest} autre(s).` : '']
    .filter(Boolean).join('\n');
}

/**
 * Sauvegarde des quantités AVANT correction. Prise sur les produits réels et
 * non sur la comparaison : c'est ce qui permet de revenir exactement à l'état
 * d'avant, y compris pour un produit vendu entre-temps.
 */
export function buildBackup(
  cmp: BizInventaireComparison | undefined, products: BizProduct[],
): { at: string; lines: BizInventaireBackupLine[] } {
  const deltas = correctionDeltas(cmp, products);
  return {
    at: new Date().toISOString(),
    lines: deltas.map(d => ({
      productId: d.product.id,
      productName: d.product.name,
      currentQty: roundQty(Number(d.product.currentQty) || 0),
      principalQty: roundQty(Number(d.product.principalQty) || 0),
    })),
  };
}

/**
 * Écrit les quantités comptées dans le stock.
 *
 * `principalQty` (le total reçu) suit le MÊME écart que `currentQty` : sans
 * cela, corriger un manquant laisserait un « total reçu » supérieur à ce qui
 * est réellement passé, et le taux d'écoulement du produit deviendrait faux.
 */
export function applyCorrection(
  deltas: CorrectionDelta[],
  write: (coll: 'products', item: BizProduct) => void,
): number {
  for (const d of deltas) {
    const shift = roundQty(d.to - d.from);
    write('products', {
      ...d.product,
      currentQty: d.to,
      principalQty: roundQty((Number(d.product.principalQty) || 0) + shift),
    });
  }
  return deltas.length;
}

/** Remet les quantités d'avant la correction. Rend le nombre de produits remis. */
export function restoreBackupLines(
  backup: { at: string; lines: BizInventaireBackupLine[] } | undefined,
  products: BizProduct[],
  write: (coll: 'products', item: BizProduct) => void,
): number {
  if (!backup?.lines?.length) return 0;
  const byId = new Map(products.map(p => [p.id, p]));
  let n = 0;
  for (const l of backup.lines) {
    const product = byId.get(l.productId);
    if (!product) continue;
    write('products', { ...product, currentQty: l.currentQty, principalQty: l.principalQty });
    n++;
  }
  return n;
}

// ─── Synthèse par cafétéria (rapports généraux) ───────────────────────────────

export interface InventaireSummary {
  /** Identifiant de la cafétéria. */
  key: ModuleKey;
  label: string;
  emoji: string;
  inventaires: BizInventaire[];
  /** Comptages commencés et pas terminés. */
  drafts: number;
  /** Comptages terminés dont la comparaison n'a pas été lancée. */
  pendingComparison: number;
  /** Comptages dont le stock a été aligné. */
  corrected: number;
  lossValue: number;
  gainValue: number;
  /** gainValue − lossValue : l'impact net sur le patrimoine. */
  netValue: number;
  /** Manquants imputables aux employés (inventaires « comparés » et imputés). */
  chargeableLossValue: number;
}

/**
 * Le bilan des inventaires d'UNE cafétéria. `period` restreint aux comptages
 * dont la DATE tombe dans l'intervalle — la date du comptage, pas celle de la
 * correction : c'est le jour où la marchandise a été comptée qui compte.
 */
export function summarizeInventaires(
  state: ModuleState | undefined,
  key: ModuleKey,
  label: string,
  emoji: string,
  period?: { from?: string; to?: string },
): InventaireSummary {
  const all = state?.inventaires || [];
  const inventaires = all.filter(inv => {
    if (!period?.from && !period?.to) return true;
    const d = (inv.date || '').slice(0, 10);
    if (period.from && d < period.from) return false;
    if (period.to && d > period.to) return false;
    return true;
  });

  const lossValue = inventaires.reduce((s, i) => s + (i.comparison?.lossValue || 0), 0);
  const gainValue = inventaires.reduce((s, i) => s + (i.comparison?.gainValue || 0), 0);

  return {
    key, label, emoji, inventaires,
    drafts: inventaires.filter(i => i.status === 'draft').length,
    pendingComparison: inventaires.filter(i => i.status === 'completed').length,
    corrected: inventaires.filter(i => i.status === 'corrected').length,
    lossValue,
    gainValue,
    netValue: gainValue - lossValue,
    chargeableLossValue: inventaires
      .filter(inventaireCountsForWorkers)
      .reduce((s, i) => s + (i.comparison?.lossValue || 0), 0),
  };
}

/**
 * Les inventaires opposables a UN employe.
 *
 * Un inventaire quitte cette liste pour trois raisons, et les trois comptent :
 *   - il n'a pas encore ete compare (aucun ecart connu) ou son imputation aux
 *     employes a ete desactivee (`chargeWorkers: false`) ;
 *   - il a deja ete CONSTATE sur une paie precedente (`settledIds`) ;
 *   - il a ete ecarte a la main pour cet employe (`dismissedIds`).
 *
 * Sans ce filtre, le meme manquant serait propose a chaque paie et finirait par
 * etre retenu deux fois.
 */
export function chargeableInventairesFor(
  inventaires: BizInventaire[],
  opts: { settledIds?: string[]; dismissedIds?: string[] } = {},
): BizInventaire[] {
  const settled = new Set(opts.settledIds || []);
  const dismissed = new Set(opts.dismissedIds || []);
  return (inventaires || [])
    .filter(inv => inventaireCountsForWorkers(inv))
    .filter(inv => (inv.comparison?.lossValue || 0) > 0)
    .filter(inv => !settled.has(inv.id) && !dismissed.has(inv.id))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
