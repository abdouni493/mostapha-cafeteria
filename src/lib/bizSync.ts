/**
 * ─── Fusion de l'état partagé des cafétérias ───────────────────────────────────
 *
 *  LE PROBLÈME QUE CE FICHIER RÈGLE
 *  Les cafétérias vivent dans UNE ligne JSON (`biz_store`). Chaque poste garde sa
 *  copie complète en mémoire ; s'il la RÉÉCRIVAIT en entier :
 *
 *    • au démarrage, la copie du serveur ÉCRASERAIT la copie locale — un produit
 *      créé puis suivi d'un rafraîchissement disparaîtrait définitivement ;
 *    • deux postes ouverts en même temps s'effaceraient mutuellement.
 *
 *  CE QUE FAIT CE MODULE
 *  Deux états ne s'écrasent plus : ils FUSIONNENT, ligne par ligne.
 *
 *    1. Chaque écriture locale horodate la ligne touchée (`_upd`).
 *    2. La fusion réunit les deux côtés par `id` ; sur une ligne présente des
 *       deux côtés, c'est l'horodatage le plus récent qui gagne.
 *    3. Une suppression laisse une PIERRE TOMBALE (`deletedIds`) — sinon la
 *       fusion ferait revenir tout ce qui vient d'être supprimé.
 *
 *  LE REGISTRE DES CAFÉTÉRIAS suit la même règle : deux postes qui créent chacun
 *  une cafétéria doivent se retrouver avec LES DEUX, jamais avec la dernière
 *  enregistrée seulement.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleKey, ModuleState, BizCollection, Cafeteria } from './bizConfig';
import { EMPTY_MODULE } from './bizSeed';

/** Champ posé sur chaque ligne écrite localement : quand elle a été touchée. */
export const STAMP = '_upd';

/** Collections fusionnées ligne par ligne (toutes portent un `id`). */
export const MERGE_COLLECTIONS: BizCollection[] = [
  'categories', 'marques', 'roles', 'products', 'purchases', 'sales',
  'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'productions',
  'fiches', 'comptoir', 'destructions', 'sessions', 'inventaires',
];

/** Une pierre tombale plus vieille que ça ne sert plus à rien : on l'oublie. */
const TOMBSTONE_TTL_DAYS = 60;

/** État d'une cafétéria augmenté des méta-données de fusion. */
export interface SyncMeta {
  /** id supprimé → date ISO de la suppression. */
  deletedIds?: Record<string, string>;
  /** Horodatage du dernier changement d'ordre des accès rapides du POS. */
  posPinnedUpd?: string;
  /** Horodatage du dernier basculement de l'option « coût moyen pondéré ». */
  avgCostEnabledUpd?: string;
}

export type SyncModuleState = ModuleState & SyncMeta;

export const nowIso = (): string => new Date().toISOString();

/** Pose l'horodatage d'écriture sur une ligne (copie — jamais de mutation). */
export function stampItem<T extends object>(item: T, at: string = nowIso()): T {
  return { ...(item as any), [STAMP]: at } as T;
}

/** Horodatage d'ÉCRITURE d'une ligne : c'est lui qui départage deux versions. */
function writeStamp(item: any): string {
  return (item && (item[STAMP] || item.updatedAt)) || '';
}

/** Horodatage d'AFFICHAGE : remet la liste fusionnée dans l'ordre habituel. */
function sortStamp(item: any): string {
  return (item && (item[STAMP] || item.updatedAt || item.createdAt || item.date)) || '';
}

/** Des deux versions d'une même ligne, garde la plus récemment écrite (égalité → `a`). */
function pickNewer<T>(a: T, b: T): T {
  return writeStamp(b) > writeStamp(a) ? b : a;
}

/** Réunit deux registres de suppressions en gardant la date la plus récente. */
function mergeTombstones(
  a: Record<string, string> = {},
  b: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = { ...a };
  for (const [id, at] of Object.entries(b)) {
    if (!out[id] || at > out[id]) out[id] = at;
  }
  return out;
}

/** Oublie les suppressions trop anciennes pour que le blob ne gonfle pas. */
function pruneTombstones(tombs: Record<string, string>): Record<string, string> {
  const limit = new Date(Date.now() - TOMBSTONE_TTL_DAYS * 86_400_000).toISOString();
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(tombs)) if (at >= limit) out[id] = at;
  return out;
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Fusionne DEUX listes de lignes portant un `id` — le cœur de la fusion, isolé
 * parce qu'il sert au blob JSON complet et aux produits, qui ont leur propre
 * table. `base` gagne à égalité d'horodatage : on lui passe toujours le côté
 * LOCAL.
 */
export function mergeRows<T extends { id: string }>(
  base: T[],
  incoming: T[],
  tombstones: Record<string, string> = {},
): T[] {
  const map = new Map<string, T>();
  for (const item of asArray(base)) if (item?.id) map.set(item.id, item);
  for (const item of asArray(incoming)) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    map.set(item.id, prev ? pickNewer(prev, item) : item);
  }

  return [...map.values()]
    // Une ligne supprimée ne revient que si elle a été modifiée APRÈS coup.
    .filter(item => {
      const killedAt = tombstones[(item as any).id];
      return !killedAt || writeStamp(item) > killedAt;
    })
    .sort((x, y) => {
      const sx = sortStamp(x), sy = sortStamp(y);
      return sx === sy ? 0 : sx > sy ? -1 : 1;   // le plus récent en tête
    });
}

/**
 * Fusionne DEUX états d'une même cafétéria. `base` est le côté qui gagne à
 * égalité — on lui passe toujours l'état LOCAL.
 */
export function mergeModuleState(base: SyncModuleState, incoming: SyncModuleState): SyncModuleState {
  const tombs = pruneTombstones(mergeTombstones(base.deletedIds, incoming.deletedIds));
  const out: any = { ...EMPTY_MODULE(), ...base };

  for (const coll of MERGE_COLLECTIONS) {
    out[coll] = mergeRows(asArray(base[coll]), asArray(incoming[coll]), tombs);
  }

  // Réglages SCALAIRES (sans id) : départagés sur leur propre horodatage.
  const basePin = base.posPinnedUpd || '';
  const inPin = incoming.posPinnedUpd || '';
  if (inPin > basePin) {
    out.posPinned = asArray(incoming.posPinned);
    out.posPinnedUpd = inPin;
  } else {
    out.posPinned = asArray(base.posPinned);
    if (basePin) out.posPinnedUpd = basePin;
  }

  const baseAvg = base.avgCostEnabledUpd || '';
  const inAvg = incoming.avgCostEnabledUpd || '';
  if (inAvg > baseAvg) {
    out.avgCostEnabled = !!incoming.avgCostEnabled;
    out.avgCostEnabledUpd = inAvg;
  } else {
    out.avgCostEnabled = !!base.avgCostEnabled;
    if (baseAvg) out.avgCostEnabledUpd = baseAvg;
  }

  out.deletedIds = tombs;
  return out as SyncModuleState;
}

/** Cafétéria augmentée de son horodatage d'écriture. */
type SyncCafeteria = Cafeteria & { [STAMP]?: string };

/**
 * Fusionne les REGISTRES de cafétérias. Une cafétéria créée sur un poste et une
 * autre créée sur un second poste doivent COEXISTER : sans cette fusion, le
 * dernier enregistrement effacerait la cafétéria de l'autre.
 *
 * Les suppressions de cafétéria passent par la même pierre tombale que les
 * lignes (`deletedCafeterias`), sinon la fusion la ferait revenir.
 */
export function mergeCafeterias(
  base: Cafeteria[],
  incoming: Cafeteria[],
  tombstones: Record<string, string> = {},
): Cafeteria[] {
  const merged = mergeRows<SyncCafeteria>(asArray(base), asArray(incoming), tombstones);
  // Le registre se lit dans l'ordre de CRÉATION : la barre latérale ne doit pas
  // se réordonner toute seule parce qu'on a renommé une cafétéria.
  return merged.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/** Pierres tombales du registre — portées à la racine de l'état partagé. */
export type BizStateMeta = BizState & { deletedCafeterias?: Record<string, string> };

/** Fusionne deux états complets (registre + toutes les cafétérias). */
export function mergeBizState(base: BizState, incoming: BizState | null | undefined): BizState {
  if (!incoming) return base;

  const b = base as BizStateMeta;
  const i = incoming as BizStateMeta;
  const tombs = pruneTombstones(mergeTombstones(b.deletedCafeterias, i.deletedCafeterias));
  const cafeterias = mergeCafeterias(b.cafeterias || [], i.cafeterias || [], tombs);

  // Toute clé connue d'un côté OU de l'autre : un état plus ancien ne doit pas
  // faire disparaître les données d'une cafétéria qu'il ne connaît pas encore.
  const keys = new Set<ModuleKey>([
    ...Object.keys(b.modules || {}),
    ...Object.keys(i.modules || {}),
    ...cafeterias.map(c => c.id),
  ]);

  const modules: Record<ModuleKey, ModuleState> = {};
  for (const key of keys) {
    // Une cafétéria supprimée emporte ses données — sinon le blob garderait
    // indéfiniment le stock d'une cafétéria qui n'existe plus.
    if (tombs[key] && !cafeterias.some(c => c.id === key)) continue;
    modules[key] = mergeModuleState(
      (b.modules?.[key] || EMPTY_MODULE()) as SyncModuleState,
      (i.modules?.[key] || EMPTY_MODULE()) as SyncModuleState,
    );
  }

  const out: BizStateMeta = { cafeterias, modules };
  if (Object.keys(tombs).length) out.deletedCafeterias = tombs;
  return out;
}

/** Toutes les lignes de l'état, à plat — sert à vérifier qu'une création est arrivée. */
export function hasItem(
  state: BizState | null | undefined, module: ModuleKey, coll: BizCollection, id: string,
): boolean {
  const list = (state as any)?.modules?.[module]?.[coll];
  return Array.isArray(list) && list.some((x: any) => x?.id === id);
}
