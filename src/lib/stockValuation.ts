/**
 * ─── Valeur du stock — au prix d'achat ET au prix de vente ─────────────────────
 * Une seule question, posée pour toute la station : « qu'est-ce que j'ai en
 * magasin, ce que ça m'a coûté, et ce que ça vaut si je le vends ? »
 *
 * Trois parties, chacune avec ses propres réserves :
 *   • Carburant  → les CUVES (litres × prix d'achat / prix de vente du carburant)
 *                  et le magasin de la station (produits boutique).
 *   • Cafétéria  → le catalogue (Gestion de stock) et le COMPTOIR (productions
 *                  déjà prêtes à la vente, valorisées à leur coût de revient).
 *   • Lavage     → le catalogue (pièces, produits de lavage).
 *
 * Chaque ligne porte les DEUX valorisations : `buyValue` (ce que la marchandise
 * a coûté — la seule qui entre dans un bilan) et `sellValue` (ce qu'elle
 * rapportera si tout part au prix affiché). Leur écart est la marge latente.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleKey, MODULES, ModuleState } from './bizConfig';

/** Une ligne de stock valorisée. */
export interface StockLine {
  id: string;
  name: string;
  /** Code-barres (catalogue) ou type de carburant (cuve) — sert à la recherche. */
  code?: string;
  category?: string;
  unit?: string;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  buyValue: number;
  sellValue: number;
  /** sellValue − buyValue : le gain qui dort dans le stock. */
  margin: number;
  /** Marge en % du prix d'achat. */
  marginPct: number;
  /** Sous seuil d'alerte (catalogue) ou sous le niveau d'alerte (cuve). */
  low?: boolean;
  minQty?: number;
  expirationDate?: string;
  /** Matière première : elle n'a pas de prix de vente propre. */
  raw?: boolean;
  /** Stock à découvert — la quantité est négative. */
  negative?: boolean;
}

/** Un ensemble homogène de lignes dans une partie (cuves, catalogue, comptoir…). */
export interface StockSection {
  key: string;
  label: string;
  hint: string;
  lines: StockLine[];
  buyValue: number;
  sellValue: number;
  margin: number;
  count: number;
  /** Quantité totale, quand elle a un sens (litres en cuve). */
  qty: number;
  unit?: string;
}

/** La réserve complète d'une activité. */
export interface StockPart {
  key: string;
  label: string;
  emoji: string;
  sections: StockSection[];
  buyValue: number;
  sellValue: number;
  margin: number;
  marginPct: number;
  count: number;
  /** Produits sous leur seuil d'alerte. */
  lowCount: number;
  /** Produits dont la quantité est passée en négatif (vente à découvert). */
  negativeCount: number;
}

/** La valorisation complète, toutes cafétérias confondues. */
export interface StockValuation {
  parts: StockPart[];
  buyValue: number;
  sellValue: number;
  margin: number;
  marginPct: number;
  count: number;
  lowCount: number;
  negativeCount: number;
}

/** Un nombre, quoi qu'on lui passe : `undefined`, `null` et `''` valent 0. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Une ligne valorisée.
 *
 * Une quantité NÉGATIVE (stock à découvert) est valorisée telle quelle, en
 * négatif : la ramener à zéro ferait disparaître une dette de marchandise du
 * bilan, ce qui est exactement l'erreur qu'un inventaire cherche à mettre au
 * jour.
 */
function lineOf(l: Omit<StockLine, 'buyValue' | 'sellValue' | 'margin' | 'marginPct'>): StockLine {
  const buyValue = l.qty * l.buyPrice;
  const sellValue = l.qty * l.sellPrice;
  return {
    ...l,
    buyValue,
    sellValue,
    margin: sellValue - buyValue,
    marginPct: buyValue !== 0 ? ((sellValue - buyValue) / Math.abs(buyValue)) * 100 : 0,
  };
}

/** Un ensemble homogène de lignes, avec ses totaux. */
function sectionOf(
  key: string, label: string, hint: string, lines: StockLine[], unit?: string,
): StockSection {
  const buyValue = lines.reduce((a, l) => a + l.buyValue, 0);
  const sellValue = lines.reduce((a, l) => a + l.sellValue, 0);
  return {
    key, label, hint, lines, unit,
    buyValue,
    sellValue,
    margin: sellValue - buyValue,
    count: lines.length,
    qty: lines.reduce((a, l) => a + l.qty, 0),
  };
}

/** La réserve complète d'une cafétéria : ses sections et leurs totaux. */
function partOf(key: string, label: string, emoji: string, sections: StockSection[]): StockPart {
  const lines = sections.flatMap(sec => sec.lines);
  const buyValue = sections.reduce((a, sec) => a + sec.buyValue, 0);
  const sellValue = sections.reduce((a, sec) => a + sec.sellValue, 0);
  return {
    key, label, emoji, sections,
    buyValue,
    sellValue,
    margin: sellValue - buyValue,
    marginPct: buyValue > 0 ? ((sellValue - buyValue) / buyValue) * 100 : 0,
    count: lines.length,
    lowCount: lines.filter(l => l.low).length,
    negativeCount: lines.filter(l => l.negative).length,
  };
}

// ─── Une cafétéria : catalogue + comptoir ─────────────────────────────────────
export function computeModuleStock(st: ModuleState, key: ModuleKey): StockPart {
  const cfg = MODULES[key];

  const catalogue: StockLine[] = (st.products || []).map(p => lineOf({
    id: `p-${p.id}`,
    name: p.name,
    code: p.barcode,
    category: p.categoryName,
    unit: p.unit,
    qty: num(p.currentQty),
    buyPrice: num(p.purchasePrice),
    // Une matière première ne se vend pas telle quelle : sa « valeur de vente »
    // est son coût, sinon la marge latente serait inventée de toutes pièces.
    sellPrice: p.isRawMaterial ? num(p.purchasePrice) : num(p.salePrice),
    low: num(p.currentQty) <= num(p.minQty),
    minQty: num(p.minQty),
    expirationDate: p.hasExpiration ? p.expirationDate : undefined,
    raw: !!p.isRawMaterial,
    negative: num(p.currentQty) < 0,
  }));

  const comptoir: StockLine[] = (st.comptoir || []).map(c => lineOf({
    id: `c-${c.id}`,
    name: c.productName,
    category: c.categoryName || 'Comptoir',
    unit: c.unit,
    qty: num(c.qty),
    // Côté comptoir, `purchasePrice` est le COÛT DE REVIENT de la production et
    // `unitPrice` le prix de vente affiché.
    buyPrice: num(c.purchasePrice),
    sellPrice: num(c.unitPrice),
    negative: num(c.qty) < 0,
  }));

  return partOf(key, cfg.label, cfg.emoji, [
    sectionOf('catalogue', 'Catalogue (Gestion de stock)', 'Produits achetés et matières premières', catalogue),
    sectionOf('comptoir', 'Comptoir', 'Productions prêtes à la vente, au coût de revient', comptoir),
  ]);
}

// ─── Toutes les cafeterias ───────────────────────────────────────────────────
/**
 * La valeur du stock de PLUSIEURS cafeterias, chacune restant une section a
 * part. `keys` decide lesquelles : un employe n'en passe qu'une (la sienne),
 * l'administrateur les passe toutes.
 */
export function computeStockValuation(biz: BizState, keys?: ModuleKey[]): StockValuation {
  const wanted = keys && keys.length ? keys : biz.cafeterias.map(c => c.id);
  const parts = wanted
    .filter(k => !!biz.modules[k])
    .map(k => computeModuleStock(biz.modules[k], k));

  const buyValue = parts.reduce((s, p) => s + p.buyValue, 0);
  const sellValue = parts.reduce((s, p) => s + p.sellValue, 0);
  return {
    parts,
    buyValue,
    sellValue,
    margin: sellValue - buyValue,
    marginPct: buyValue > 0 ? ((sellValue - buyValue) / buyValue) * 100 : 0,
    count: parts.reduce((s, p) => s + p.count, 0),
    lowCount: parts.reduce((s, p) => s + p.lowCount, 0),
    negativeCount: parts.reduce((s, p) => s + p.negativeCount, 0),
  };
}
