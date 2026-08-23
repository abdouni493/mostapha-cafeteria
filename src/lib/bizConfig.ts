/**
 * ─── Altech Cafétéria — Modèle de données & registre des cafétérias ────────────
 *
 * L'application ne gère plus qu'UNE activité : la cafétéria. Mais elle en gère
 * AUTANT QU'ON VEUT — chaque cafétéria créée dans les Réglages est une partie
 * complète et INDÉPENDANTE : son stock, ses achats, ses ventes, ses clients, ses
 * fournisseurs, ses employés, sa caisse et ses rapports.
 *
 * `ModuleKey` est donc devenu l'IDENTIFIANT d'une cafétéria (et non plus une
 * valeur figée). Toutes les pages `src/pages/modules/*` restent paramétrées par
 * cette clé : ajouter une cafétéria n'ajoute pas une ligne de code, seulement
 * une entrée dans le registre.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/** Identifiant d'une cafétéria. C'est la clé de sa partie dans le store. */
export type ModuleKey = string;

/** Identifiant de la cafétéria créée d'office à la première ouverture. */
export const DEFAULT_CAFETERIA_ID = 'cafeteria';

/** Palette proposée à la création d'une cafétéria (teintes « café »). */
export const CAFETERIA_COLORS = [
  '#6F4E37', '#A9746E', '#C08552', '#8C5E3C', '#4B3621',
  '#B85C38', '#7D5A50', '#9C6644', '#5C4033', '#D4A373',
] as const;

/** Émojis proposés à la création d'une cafétéria. */
export const CAFETERIA_EMOJIS = ['☕', '🍰', '🥐', '🍵', '🧁', '🥤', '🍩', '🫖', '🍪', '🥪'] as const;

/**
 * Une cafétéria — sa carte d'identité. Les DONNÉES de la cafétéria vivent dans
 * `BizState.modules[cafeteria.id]`, jamais ici : cette fiche ne porte que ce
 * qui sert à l'afficher et à l'imprimer.
 */
export interface Cafeteria {
  id: ModuleKey;
  name: string;
  /** Nom court affiché dans les filtres et les sous-titres. */
  short?: string;
  emoji?: string;
  /** Teinte d'accent — sert à distinguer les cafétérias d'un coup d'œil. */
  color?: string;
  address?: string;
  phone?: string;
  /** Logo/photo de la cafétéria (URL Supabase Storage). */
  logoUrl?: string;
  /** Une cafétéria archivée reste consultable mais ne reçoit plus d'écritures. */
  archived?: boolean;
  createdAt: string;
}

// ─── Collections tenues par cafétéria ─────────────────────────────────────────
export type BizCollection =
  | 'categories'
  | 'marques'
  | 'products'
  | 'purchases'
  | 'sales'
  | 'clients'
  | 'suppliers'
  | 'workers'
  | 'expenses'
  | 'caisse'
  | 'productions'
  | 'fiches'
  | 'comptoir'
  | 'destructions'
  | 'sessions'
  | 'inventaires'
  | 'roles';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BizNamed { id: string; name: string }

export interface BizProduct {
  id: string;
  name: string;
  description?: string;
  barcode?: string;
  marqueId?: string;
  marqueName?: string;
  categoryId?: string;
  categoryName?: string;
  principalQty: number;   // stock principal (total reçu)
  currentQty: number;     // reste en stock
  minQty: number;         // seuil d'alerte
  purchasePrice: number;
  /** Coût moyen pondéré du stock (CUMP) — voir `src/lib/bizAverageCost.ts`. */
  averageCost?: number;
  /** Dernier prix payé au fournisseur, gardé À PART du coût moyen. */
  lastPurchasePrice?: number;
  salePrice: number;
  unit?: string;
  hasExpiration?: boolean;
  expirationDate?: string;
  /** Vendre des fractions d'une unité conditionnée (1 L sur un bidon de 50 L). */
  sellByDetail?: boolean;
  detailCapacity?: number;
  detailUnit?: string;
  detailSalePrice?: number;
  imageUrl?: string;
  /** Matière première : entre en stock et en achat, jamais au point de vente. */
  isRawMaterial?: boolean;
  createdAt: string;
}

/** Un produit ne s'affiche au point de vente que s'il n'est pas une matière première. */
export const isSellableProduct = (p: Pick<BizProduct, 'isRawMaterial'>) => !p.isRawMaterial;

/**
 * Quantité de stock ramenée au millième. Le point de vente vend À DÉCOUVERT :
 * un stock peut passer en négatif et se rattraper au prochain achat.
 */
export const roundQty = (q: number): number => Math.round(q * 1000) / 1000;

/** Quantité affichée — le signe « − » d'un stock à découvert est conservé. */
export function formatQty(q: number): string {
  const r = roundQty(q);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Prix d'une unité de détail. */
export function detailPrice(p: Pick<BizProduct, 'salePrice' | 'detailCapacity' | 'detailSalePrice'>): number {
  if (p.detailSalePrice && p.detailSalePrice > 0) return p.detailSalePrice;
  const cap = Number(p.detailCapacity) || 0;
  return cap > 0 ? p.salePrice / cap : p.salePrice;
}

export interface BizLineItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  /** Coût de revient d'UNE unité, figé au moment de la vente. */
  unitCost?: number;
  minQty?: number;
  hasExpiration?: boolean;
  expirationDate?: string;
  total?: number;
  detailQty?: number;
  detailUnit?: string;
  // ── Lignes d'achat uniquement ────────────────────────────────────────────
  salePrice?: number;
  sellByDetail?: boolean;
  detailCapacity?: number;
  detailSalePrice?: number;
  // ── Coût moyen pondéré — photo du calcul, figée à la validation ───────────
  prevStockQty?: number;
  prevAvgCost?: number;
  resultStockQty?: number;
  resultAvgCost?: number;
}

export interface BizPurchase {
  id: string;
  ref: string;
  supplierId?: string;
  supplierName: string;
  items: BizLineItem[];
  total: number;
  paid: number;
  rest: number;
  date: string;
  createdAt: string;
  createdBy?: string;
  /** Facture enregistrée en coût moyen pondéré. */
  useAverageCost?: boolean;
}

/** Un versement DATÉ sur un document (vente, achat, dette client). */
export interface BizDocPayment {
  id: string;
  date: string;
  amount: number;
  mode?: string;
  reference?: string;
  notes?: string;
  by?: string;
}

export interface BizSale {
  id: string;
  ref: string;
  clientId?: string;
  clientName: string;   // "Client de passage" si non renseigné
  items: BizLineItem[];
  subtotal: number;
  reduction: number;
  discountType?: BizDiscountType;
  discountValue?: number;
  total: number;
  paid: number;
  rest: number;
  date: string;
  status: 'payée' | 'crédit' | 'retournée' | 'échangée';
  createdBy?: string;
  /** Session de travail dans laquelle la vente a été encaissée. */
  sessionId?: string;
  workerId?: string;
  workerName?: string;
  printedAt?: string;
  refundedAmount?: number;
  refundedAt?: string;
  returnReason?: string;
  exchangeOfSaleId?: string;
  exchangedIntoSaleId?: string;
  exchangeDelta?: number;
  payments?: BizDocPayment[];
}

/** Une vente ANNULÉE — la marchandise n'est plus chez le client. */
export const isReversedSale = (s: Pick<BizSale, 'status'>): boolean =>
  s.status === 'retournée' || s.status === 'échangée';

/** Argent réellement resté en caisse pour une vente. */
export function netCashOfSale(s: BizSale): number {
  if (s.status === 'échangée') return 0;
  if (s.status === 'retournée') return (s.paid || 0) - (s.refundedAmount || 0);
  return s.paid || 0;
}

export interface BizContact {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  createdAt: string;
  /** Ce que le client devait DÉJÀ le jour où sa fiche a été créée. */
  openingDebt?: number;
  openingAdvance?: number;
  openingDate?: string;
  openingNotes?: string;
  openingPayments?: BizDocPayment[];
  /** L'argent versé EN PLUS de ce qui est dû — il gonfle la caisse du jour. */
  advancePayments?: BizDocPayment[];
}

export interface BizAcompte { id: string; date: string; amount: number; description?: string; paid: boolean }
export interface BizAbsence { id: string; date: string; cost: number; description?: string; paid: boolean }

export interface BizWorkerPayment {
  id: string;
  period: string;
  amount: number;
  date: string;
  description?: string;
  mode?: string;
  worksTotal?: number;
  percentage?: number;
  from?: string;
  to?: string;
  paidDays?: string[];
  paidMonths?: string[];
  primeType?: 'percent' | 'amount';
  primeValue?: number;
  primeAmount?: number;
  // ── Décalages d'inventaire ────────────────────────────────────────────────
  inventaireIds?: string[];
  inventaireTotal?: number;
  inventaireDeduction?: number;
  inventaireDeductionActive?: boolean;
  inventaireDeductionType?: 'percent' | 'amount';
  inventaireDeductionValue?: number;
}

export interface BizWorker {
  id: string;
  /** Supabase auth user id — posé une fois le compte de connexion créé. */
  authUserId?: string;
  name: string;
  birthday?: string;
  cin?: string;
  phone?: string;
  roleName: string;
  paid: boolean;                 // reçoit un salaire ?
  salaryType: 'jour' | 'mois';
  salaryAmount: number;
  /** Jours travaillés, indexés comme `Date.getDay()` (0 = dimanche). */
  workDays?: number[];
  cnasDate?: string;
  hasAccount: boolean;
  email?: string;
  username?: string;
  password?: string;
  startDate: string;
  permissions: Record<string, boolean>;
  acomptes: BizAcompte[];
  absences: BizAbsence[];
  payments: BizWorkerPayment[];
  /** L'employé répond des manquants constatés aux inventaires de sa cafétéria. */
  inventoryLiable?: boolean;
  dismissedInventaireIds?: string[];
  savedInventaireIds?: string[];
  photoUrl?: string;
  createdAt: string;
}

export interface BizExpense {
  id: string;
  name: string;
  description?: string;
  amount: number;
  date: string;
  category?: string;
  /**
   * Le compte d'où l'argent est SORTI : vide ou `CAISSE_<cafétéria>` ⇒ payée en
   * espèces (elle vide le tiroir de CETTE cafétéria).
   */
  accountId?: string;
  paymentMode?: string;
  chequeNumber?: string;
}

/** `true` quand une dépense a réellement vidé le tiroir de la cafétéria. */
export const bizExpensePaidInCash = (e: Pick<BizExpense, 'accountId'>): boolean =>
  !e.accountId || e.accountId.startsWith('CAISSE');

export interface BizCaisseTx {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  date: string;
  description?: string;
  category?: string;
  /**
   * Transfert vers / depuis la CAISSE GÉNÉRALE de l'enseigne. Une remontée de
   * fonds sort du tiroir de la cafétéria et entre au coffre général : les deux
   * écrans lisent la MÊME ligne, jamais deux lignes saisies deux fois.
   */
  transfer?: 'to_general' | 'from_general';
  createdBy?: string;
}

export interface BizIngredient {
  productId: string;
  productName: string;
  quantityUsed: number;
  unitCost: number;
  lineCost: number;
  unit?: string;
  sourceType?: 'stock' | 'fiche';
}

export interface BizFiche {
  id: string;
  name: string;
  categoryId?: string;
  categoryName?: string;
  description?: string;
  ingredients: BizIngredient[];
  sellByUnit?: boolean;
  sellUnit?: string;
  usableInProduction?: boolean;
  productUnit?: string;
  /** Fiche vendue directement au POS (« café au lait ») : elle déduit ses
   *  ingrédients du stock à la vente, sans production ni comptoir. */
  directSale?: boolean;
  outputQuantity: number;
  unitPrice: number;
  totalCost: number;
  costPerUnit: number;
  totalValue: number;
  gainsPerUnit: number;
  totalGains: number;
  imageUrl?: string;
  createdAt: string;
}

export interface BizProduction {
  id: string;
  name: string;
  categoryName?: string;
  ficheId?: string;
  date: string;
  createdBy?: string;
  ingredients: BizIngredient[];
  outputQuantity: number;
  expectedQuantity: number;
  sentToComptoir: number;
  unit?: string;
  unitPrice: number;
  totalCost: number;
  totalValue: number;
  costPerUnit: number;
  hasLoss: boolean;
  lossQuantity: number;
  lossValue: number;
  lossReason?: string;
}

export interface BizComptoirItem {
  id: string;
  productName: string;
  categoryName?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  purchasePrice: number;
  date: string;
  sourceProductionId?: string;
}

/** Un produit retiré des stocks parce qu'il est perdu : périmé, cassé, volé… */
export interface BizDestruction {
  id: string;
  /** D'où vient le produit détruit. Absent = ancienne destruction du comptoir. */
  source?: 'stock' | 'comptoir';
  productId?: string;
  productName: string;
  categoryName?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  /** Coût de revient réel d'une unité (prix d'achat / coût de production). */
  unitCost?: number;
  value: number;
  reason?: string;
  date: string;
  createdBy?: string;
  recovered?: boolean;
  recoveredAt?: string;
  notes?: string;
}

// ─── Sessions de travail (session de caisse) ──────────────────────────────────
/**
 * Un caissier ouvre une session avant de vendre et la clôture en fin de service.
 * Le fond de caisse (`openingCash`) n'est JAMAIS compté dans ce qu'il doit. Une
 * session appartient à UN employé : deux employés peuvent en tenir une en même
 * temps, chacun ne voit et ne clôture que la sienne.
 */
export interface BizSession {
  id: string;
  ref: string;
  workerId?: string;
  workerName: string;
  openingCash: number;
  openedAt: string;
  closedAt?: string;
  closingCash?: number;
  status: 'open' | 'closed';
  notes?: string;
  theoretical?: number;
  credit?: number;
  decalage?: number;
  authUserId?: string;
  openedById?: string;
  openedByName?: string;
  closedById?: string;
  closedByName?: string;
}

/** Une remise : un pourcentage ou un montant fixe. */
export type BizDiscountType = 'percent' | 'amount';

/** Argent réellement déduit par une remise, plafonné au sous-total. */
export function discountOf(subtotal: number, type: BizDiscountType | undefined, value: number | undefined): number {
  const v = Number(value) || 0;
  if (v <= 0 || subtotal <= 0) return 0;
  const raw = type === 'percent' ? (subtotal * Math.min(v, 100)) / 100 : v;
  return Math.max(0, Math.min(subtotal, raw));
}

// ─── Inventaire physique d'une cafétéria ──────────────────────────────────────
export type BizInventaireStatus = 'draft' | 'completed' | 'compared' | 'corrected';

export type BizBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

export const INVENTAIRE_STATUS_META: Record<BizInventaireStatus, { label: string; hint: string; tone: BizBadgeTone }> = {
  draft:     { label: 'Brouillon',    hint: 'Comptage en cours — reprenez-le quand vous voulez', tone: 'warning' },
  completed: { label: 'Terminé',      hint: 'Comptage figé — lancez la comparaison',             tone: 'info' },
  compared:  { label: 'Comparé',      hint: "Écarts calculés — le stock n'est pas encore corrigé", tone: 'primary' },
  corrected: { label: 'Stock corrigé', hint: "Le stock de l'application a été aligné sur le comptage", tone: 'success' },
};

export interface BizInventaireLine {
  productId: string;
  productName: string;
  barcode?: string;
  categoryId?: string;
  categoryName?: string;
  unit?: string;
  countedQty: number;
  detailQty?: number;
  detailUnit?: string;
  detailCapacity?: number;
  sellByDetail?: boolean;
  /** Prix d'achat FIGÉ au moment du comptage — c'est lui qui valorise l'écart. */
  purchasePrice: number;
  salePrice: number;
  systemQtyAtEntry?: number;
}

export interface BizInventaireEcart {
  productId: string;
  productName: string;
  categoryName?: string;
  unit?: string;
  countedQty: number;
  systemQty: number;
  /** compté − application : négatif = marchandise manquante (perte). */
  ecart: number;
  purchasePrice: number;
  value: number;
  kind: 'perte' | 'gain' | 'exact';
}

export interface BizInventaireComparison {
  at: string;
  by?: string;
  lines: BizInventaireEcart[];
  lossQty: number;
  lossValue: number;
  gainQty: number;
  gainValue: number;
  netValue: number;
  productsCounted: number;
  productsWithEcart: number;
}

export interface BizInventaireBackupLine {
  productId: string;
  productName: string;
  currentQty: number;
  principalQty: number;
}

export interface BizInventaire {
  id: string;
  ref: string;
  date: string;
  status: BizInventaireStatus;
  lines: BizInventaireLine[];
  notes?: string;
  createdAt: string;
  createdBy?: string;
  completedAt?: string;
  comparison?: BizInventaireComparison;
  correctedAt?: string;
  correctedBy?: string;
  backup?: { at: string; lines: BizInventaireBackupLine[] };
  /** Imputer les pertes de cet inventaire aux employés de la cafétéria. */
  chargeWorkers?: boolean;
}

/** Nom d'un inventaire, dérivé de sa date : `invnt-01-01-2026`. */
export function inventaireRefFor(date: string): string {
  const d = new Date(date);
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `invnt-${p(safe.getDate())}-${p(safe.getMonth() + 1)}-${safe.getFullYear()}`;
}

export const inventaireCountsForWorkers = (inv: BizInventaire): boolean =>
  !!inv.comparison && inv.chargeWorkers !== false;

export const inventaireLossValue = (inv: BizInventaire): number => inv.comparison?.lossValue || 0;

// ─── L'état d'UNE cafétéria ───────────────────────────────────────────────────
export interface ModuleState {
  categories: BizNamed[];
  marques: BizNamed[];
  roles: BizNamed[];
  products: BizProduct[];
  purchases: BizPurchase[];
  sales: BizSale[];
  clients: BizContact[];
  suppliers: BizContact[];
  workers: BizWorker[];
  expenses: BizExpense[];
  caisse: BizCaisseTx[];
  productions: BizProduction[];
  fiches: BizFiche[];
  comptoir: BizComptoirItem[];
  destructions: BizDestruction[];
  sessions: BizSession[];
  inventaires: BizInventaire[];
  /** Ordre des accès rapides du point de vente. */
  posPinned: string[];
  /** Option « coût moyen pondéré » de la cafétéria. */
  avgCostEnabled?: boolean;
}

/** Clé stable d'une tuile du point de vente (accès rapides). */
export function posPinKey(kind: 'comptoir' | 'product' | 'fiche', idOrName: string): string {
  return `${kind}:${idOrName}`;
}

/**
 * ─── L'ÉTAT COMPLET ───────────────────────────────────────────────────────────
 * `cafeterias` est le registre (qui existe), `modules` porte les données de
 * chacune. Les deux voyagent ensemble dans la ligne partagée `biz_store`.
 */
export interface BizState {
  cafeterias: Cafeteria[];
  modules: Record<ModuleKey, ModuleState>;
}

// ─── Présentation d'une cafétéria ─────────────────────────────────────────────

export interface ModuleConfig {
  key: ModuleKey;
  label: string;          // nom complet
  short: string;          // nom court (filtres, sous-titres)
  emoji: string;
  color: string;
  base: string;           // base de route, `/c/<id>`
  productWord: string;
  hasProduction: boolean;
  hasComptoir: boolean;
}

/** Base de route d'une cafétéria. */
export const routeBaseOf = (key: ModuleKey): string => `/c/${key}`;

/** Fiche de présentation d'une cafétéria à partir de son enregistrement. */
export function configOf(c: Cafeteria): ModuleConfig {
  return {
    key: c.id,
    label: c.name || 'Cafétéria',
    short: c.short || c.name || 'Cafétéria',
    emoji: c.emoji || '☕',
    color: c.color || CAFETERIA_COLORS[0],
    base: routeBaseOf(c.id),
    productWord: 'Produit',
    hasProduction: true,
    hasComptoir: true,
  };
}

/** La cafétéria créée d'office la toute première fois. */
export function defaultCafeteria(name = 'Cafétéria principale'): Cafeteria {
  return {
    id: DEFAULT_CAFETERIA_ID,
    name,
    short: 'Principale',
    emoji: '☕',
    color: CAFETERIA_COLORS[0],
    createdAt: new Date().toISOString(),
  };
}

// ─── Registre vivant ──────────────────────────────────────────────────────────
/**
 * POURQUOI UN REGISTRE MUTABLE
 *
 * `MODULES[key]` est lu partout dans l'application, de façon SYNCHRONE, au beau
 * milieu d'un rendu (titre d'une page, libellé d'un filtre, couleur d'un badge).
 * Passer la liste des cafétérias en paramètre à chacun de ces endroits aurait
 * voulu dire toucher une centaine de composants pour une information qui ne
 * change qu'aux Réglages.
 *
 * `BizProvider` republie donc le registre à chaque changement de l'état
 * (`setCafeteriaRegistry`), et `MODULES` reste une table qu'on interroge par
 * clé — sauf qu'elle est vivante. Une clé inconnue rend une fiche de repli
 * plutôt que `undefined` : un identifiant périmé dans une URL affiche une page
 * vide, il ne casse pas le rendu.
 */
let REGISTRY: Record<ModuleKey, ModuleConfig> = {
  [DEFAULT_CAFETERIA_ID]: configOf(defaultCafeteria()),
};
let REGISTRY_LIST: Cafeteria[] = [defaultCafeteria()];

export function setCafeteriaRegistry(list: Cafeteria[]): void {
  const safe = Array.isArray(list) && list.length ? list : [defaultCafeteria()];
  REGISTRY_LIST = safe;
  const next: Record<ModuleKey, ModuleConfig> = {};
  for (const c of safe) if (c?.id) next[c.id] = configOf(c);
  REGISTRY = next;
}

/** Les cafétérias connues, dans l'ordre du registre. */
export const cafeteriaList = (): Cafeteria[] => REGISTRY_LIST;

/** Fiche de repli — une clé inconnue ne doit jamais faire planter un rendu. */
const fallbackConfig = (key: ModuleKey): ModuleConfig => ({
  key,
  label: 'Cafétéria',
  short: 'Cafétéria',
  emoji: '☕',
  color: CAFETERIA_COLORS[0],
  base: routeBaseOf(key),
  productWord: 'Produit',
  hasProduction: true,
  hasComptoir: true,
});

export function getModuleConfig(key: ModuleKey): ModuleConfig {
  return REGISTRY[key] || fallbackConfig(key);
}

/**
 * Table des cafétérias, interrogeable par clé ET énumérable
 * (`Object.keys(MODULES)`), exactement comme la constante figée d'avant.
 */
export const MODULES: Record<ModuleKey, ModuleConfig> = new Proxy({} as Record<ModuleKey, ModuleConfig>, {
  get: (_t, prop: string | symbol) => (typeof prop === 'string' ? getModuleConfig(prop) : undefined),
  has: (_t, prop: string | symbol) => typeof prop === 'string' && prop in REGISTRY,
  ownKeys: () => Object.keys(REGISTRY),
  getOwnPropertyDescriptor: (_t, prop: string | symbol) =>
    typeof prop === 'string' && prop in REGISTRY
      ? { enumerable: true, configurable: true, value: REGISTRY[prop] }
      : undefined,
});

// ─── Interfaces d'une cafétéria (éditeur de permissions & barre latérale) ─────
export const MODULE_INTERFACES: { id: string; label: string; hint: string }[] = [
  { id: 'stock',       label: 'Gestion de stock', hint: 'Catalogue, quantités, alertes de rupture' },
  { id: 'inventaire',  label: 'Inventaire',       hint: 'Comptage physique et écarts' },
  { id: 'purchases',   label: 'Achats',           hint: 'Réceptions fournisseurs et factures' },
  { id: 'production',  label: 'Production',       hint: 'Fiches techniques et fabrications' },
  { id: 'comptoir',    label: 'Comptoir',         hint: 'Produits finis prêts à la vente' },
  { id: 'pos',         label: 'Point de vente',   hint: 'Encaissement et sessions de caisse' },
  { id: 'sales',       label: 'Ventes',           hint: 'Historique des tickets et retours' },
  { id: 'clients',     label: 'Clients',          hint: 'Fiches clients, crédits et relevés' },
  { id: 'suppliers',   label: 'Fournisseurs',     hint: 'Fiches fournisseurs et dettes' },
  { id: 'workers',     label: 'Employés',         hint: 'Personnel, paie et comptes de connexion' },
  { id: 'expenses',    label: 'Dépenses',         hint: 'Charges et sorties de caisse' },
  { id: 'caisse',      label: 'Caisse',           hint: 'Tiroir de la cafétéria et mouvements' },
  { id: 'reports',     label: 'Rapports',         hint: 'Analyses, comptabilité et exports' },
];

export const INTERFACE_ACTIONS = ['voir', 'creer', 'modifier', 'supprimer'] as const;

/** Toutes les interfaces existent pour toutes les cafétérias. */
export function interfacesForModule(_key: ModuleKey): { id: string; label: string; hint: string }[] {
  return MODULE_INTERFACES;
}

/** Ordre des interfaces dans la barre latérale. */
export const INTERFACE_ORDER = MODULE_INTERFACES.map(i => i.id);
