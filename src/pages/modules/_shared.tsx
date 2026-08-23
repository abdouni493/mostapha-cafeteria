/**
 * ─── Shared modals & helpers for module pages ──────────────────────────────────
 * ProductModal / ContactModal are reused across Stock, Purchases, Production and
 * POS so the "create new product / client / supplier" experience is identical
 * everywhere the prompt requires it.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Package, Printer, RefreshCw, User, Truck, Wallet, Upload, Image as ImageIcon, X, Beaker, EyeOff,
  AlertTriangle, Search, Pencil, Car, Plus, Trash2, Clock, ScanLine,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AnimatePresence, motion } from 'motion/react';
import { newId, formatCurrency } from '@/src/lib/utils';
const fc = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);
import { BizApi, useActiveCafeterias, useConfirmProduct } from '@/src/store/BizContext';
import { useAppState } from '@/src/store/AppContext';
import { BizProduct, BizContact, BizDocPayment, MODULES, ModuleKey } from '@/src/lib/bizConfig';
import { saveDraft, resolveDraft, failDraft, ProductDraft } from '@/src/lib/productDrafts';
import { Modal, ModalPortal, Field, Input, Textarea, Select, Switch, InlineCreate } from '@/src/components/biz/Kit';
import BarcodeScannerModal from '@/src/components/BarcodeScannerModal';
import { uploadFile, BUCKETS } from '@/src/lib/supabase';
import { useMotionPrefs } from '@/src/lib/motion';

// ─── Barcode helpers ──────────────────────────────────────────────────────────
export function genBarcode(): string {
  let code = '61';
  for (let i = 0; i < 11; i++) code += Math.floor(Math.random() * 10);
  return code;
}

/**
 * Code 128 (subset B) symbol widths — one 6-module pattern per value (0-106).
 * Each pattern is bar/space/bar/space/bar/space; the stop symbol (106) carries an
 * extra terminating bar. This is the standard, scanner-readable Code 128 table.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_START_B = 104;
const CODE128_STOP = 106;

/** Turn any text into a scannable Code 128-B barcode rendered as crisp SVG. */
export function barcodeSVG(text: string, moduleWidth = 2, height = 70): string {
  // Keep only printable ASCII (32-126); Code 128-B cannot encode anything else.
  const clean = String(text).replace(/[^\x20-\x7E]/g, '');
  if (!clean) return '';
  const codes: number[] = [CODE128_START_B];
  for (const ch of clean) codes.push(ch.charCodeAt(0) - 32);
  let checksum = CODE128_START_B;
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);

  const widths = codes.map((c) => CODE128_PATTERNS[c]).join('');
  const quiet = 10 * moduleWidth; // Code 128 needs a ≥10-module quiet zone each side
  let x = quiet;
  let isBar = true;
  let rects = '';
  for (const ch of widths) {
    const w = parseInt(ch, 10) * moduleWidth;
    if (isBar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
    isBar = !isBar;
  }
  const total = x + quiet;
  return `<svg width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect x="0" y="0" width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

export function printBarcode(product: { name: string; barcode?: string; salePrice?: number }) {
  const code = (product.barcode || '').trim();
  if (!code) return;
  const svg = barcodeSVG(code);
  const price = typeof product.salePrice === 'number' && product.salePrice > 0 ? fc(product.salePrice) : '';
  const win = window.open('', '_blank', 'width=460,height=360');
  if (!win) return;
  win.document.write(`
    <html><head><title>Code-barres</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;text-align:center;padding:20px}
      .label{display:inline-block;padding:12px 16px;border:1px solid #eee;border-radius:8px}
      .name{font-weight:800;font-size:15px;margin-bottom:8px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bars svg{display:block;margin:0 auto}
      .code{letter-spacing:4px;margin-top:4px;font-size:13px;font-family:'Courier New',monospace}
      .price{margin-top:8px;font-weight:800;font-size:16px}
      @media print{body{padding:0}.label{border:none}}
    </style></head>
    <body>
      <div class="label">
        <div class="name">${escapeHtml(product.name || '')}</div>
        <div class="bars">${svg}</div>
        <div class="code">${escapeHtml(code)}</div>
        ${price ? `<div class="price">${escapeHtml(price)}</div>` : ''}
      </div>
      <script>window.onload=function(){window.focus();window.print();};</script>
    </body></html>`);
  win.document.close();
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// ─── Empty product template ────────────────────────────────────────────────────
export function emptyProduct(): Partial<BizProduct> {
  return {
    name: '', description: '', barcode: '', marqueId: '', categoryId: '',
    principalQty: 0, currentQty: 0, minQty: 5, purchasePrice: 0, salePrice: 0,
    unit: 'unité', hasExpiration: false, expirationDate: '',
    sellByDetail: false, detailCapacity: 0, detailUnit: 'L', detailSalePrice: 0,
    imageUrl: '', isRawMaterial: false,
  };
}

/** Units a packaged product can be split into when sold au détail. */
export const DETAIL_UNITS = ['L', 'ml', 'kg', 'g', 'm', 'cm', 'unité'];

/**
 * Construit la fiche produit définitive à partir du formulaire — la même règle
 * s'applique à une création, à une modification et au renvoi d'un brouillon.
 */
export function buildProduct(
  form: Partial<BizProduct>,
  lookup: { marques: { id: string; name: string }[]; categories: { id: string; name: string }[] },
): BizProduct {
  const marqueName = lookup.marques.find(x => x.id === form.marqueId)?.name;
  const categoryName = lookup.categories.find(x => x.id === form.categoryId)?.name;
  // Une matière première ne se vend pas : la vente au détail, qui n'existe que
  // pour le point de vente, est retirée avec elle.
  const isRawMaterial = !!form.isRawMaterial;
  const sellByDetail = !isRawMaterial && !!form.sellByDetail;
  return {
    id: form.id || newId(),
    name: (form.name || '').trim(),
    description: form.description || '',
    barcode: form.barcode || '',
    marqueId: form.marqueId, marqueName,
    categoryId: form.categoryId, categoryName,
    principalQty: Number(form.principalQty) || 0,
    currentQty: form.id ? Number(form.currentQty) || 0 : Number(form.principalQty) || 0,
    minQty: Number(form.minQty) || 0,
    purchasePrice: Number(form.purchasePrice) || 0,
    salePrice: Number(form.salePrice) || 0,
    unit: form.unit || 'unité',
    hasExpiration: !!form.hasExpiration,
    expirationDate: form.hasExpiration ? form.expirationDate : undefined,
    sellByDetail,
    detailCapacity: sellByDetail ? Number(form.detailCapacity) || 0 : undefined,
    detailUnit: sellByDetail ? (form.detailUnit || 'L') : undefined,
    // Left empty ⇒ the POS falls back to salePrice / detailCapacity.
    detailSalePrice: sellByDetail && Number(form.detailSalePrice) > 0
      ? Number(form.detailSalePrice) : undefined,
    imageUrl: form.imageUrl || undefined,
    isRawMaterial,
    createdAt: form.createdAt || new Date().toISOString(),
  };
}

/**
 * Enregistre un produit et NE REND LA MAIN QU'UNE FOIS LA BASE D'ACCORD.
 *
 * La fiche part dans sa propre table (`biz_products`) : une ligne de quelques
 * centaines d'octets, confirmée en une fraction de seconde. Elle n'attend plus
 * l'envoi de l'état partagé complet — 665 Ko qui expiraient au bout de huit
 * secondes sur le lien de la station, et faisaient échouer la création d'un
 * produit alors que la base allait parfaitement bien.
 *
 * Le brouillon est écrit AVANT la première tentative : à partir de cet instant,
 * même un rafraîchissement immédiat, une coupure réseau ou un refus du serveur
 * ne peuvent plus faire disparaître la saisie — elle attendra dans l'onglet
 * « Brouillons » de la Gestion de stock, avec son bouton de renvoi.
 */
export async function persistNewProduct(
  biz: BizApi,
  product: BizProduct,
  opts: { createdBy?: string; origin?: ProductDraft['origin'] } = {},
): Promise<{ ok: boolean; error?: string }> {
  const draft = saveDraft({
    moduleKey: biz.module, product, createdBy: opts.createdBy, origin: opts.origin,
  });
  const result = await biz.addAndConfirm('products', product);
  if (result.ok) resolveDraft(draft.id);
  else failDraft(draft.id, result.error);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ─── Recherche de doublons à la saisie du nom ─────────────────────────────────
/**
 * Normalise un nom pour la comparaison : minuscules, accents retirés, espaces
 * et ponctuation réduits. « Café au Lait » et « cafe-au-lait » se rapprochent
 * ainsi l'un de l'autre, ce qui est justement le but.
 */
export function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Produits du catalogue dont le nom ressemble à ce qui est en train d'être
 * tapé — c'est ce qui évite de créer une deuxième fiche « Eau minérale » alors
 * qu'elle existe déjà avec son stock et son historique.
 *
 * Les correspondances sont classées : d'abord le nom IDENTIQUE, puis ce qui
 * commence par la saisie, puis ce qui la contient. `excludeId` retire le produit
 * en cours de modification, qui n'est évidemment pas son propre doublon.
 */
export function findSimilarProducts(
  products: BizProduct[], name: string, excludeId?: string, limit = 6,
): BizProduct[] {
  const q = normalizeName(name);
  if (q.length < 2) return [];
  const scored: { p: BizProduct; score: number }[] = [];
  for (const p of products) {
    if (excludeId && p.id === excludeId) continue;
    const n = normalizeName(p.name);
    if (!n) continue;
    const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : q.includes(n) ? 3 : -1;
    if (score < 0) continue;
    scored.push({ p, score });
  }
  return scored
    .sort((a, b) => (a.score - b.score) || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map(x => x.p);
}

/** « 12 kg » — quantité restante d'un produit, avec son unité. */
function formatQtyLabel(p: BizProduct): string {
  const q = Number(p.currentQty) || 0;
  const rounded = Number.isInteger(q) ? String(q) : q.toFixed(2);
  return `${rounded} ${p.unit || ''}`.trim();
}

/** Un produit porte-t-il EXACTEMENT ce nom ? (comparaison normalisée) */
export function findExactProduct(
  products: BizProduct[], name: string, excludeId?: string,
): BizProduct | undefined {
  const q = normalizeName(name);
  if (!q) return undefined;
  return products.find(p => p.id !== excludeId && normalizeName(p.name) === q);
}

// ─── ProductModal ───────────────────────────────────────────────────────────────
export function ProductModal({
  biz, open, onClose, initial, onSaved, origin = 'stock',
}: {
  biz: BizApi; open: boolean; onClose: () => void; initial?: Partial<BizProduct> | null;
  onSaved?: (p: BizProduct) => void;
  /** D'où vient la saisie — noté sur le brouillon en cas d'échec. */
  origin?: ProductDraft['origin'];
}) {
  const { currentUserName, currentModuleWorker } = useAppState();
  const cafeterias = useActiveCafeterias();
  const confirmProduct = useConfirmProduct();
  const [form, setForm] = useState<Partial<BizProduct>>(initial || emptyProduct());
  /**
   * ─── DANS QUELLE(S) CAFÉTÉRIA(S) CRÉER CE PRODUIT ? ─────────────────────
   * Un « Café allongé » se vend souvent dans TOUS les comptoirs de l'enseigne :
   * le saisir trois fois, c'est trois occasions de se tromper de prix.
   *
   * Chaque cafétéria reçoit sa PROPRE fiche (son propre identifiant) : les
   * stocks, les prix et l'historique restent strictement indépendants ensuite.
   * Ce n'est donc pas un produit partagé, c'est une saisie partagée — modifier
   * le prix ici ne touchera jamais le comptoir d'à côté.
   *
   * En MODIFICATION, ce choix n'existe pas : on modifie la fiche qu'on a
   * ouverte, pas celles des voisins.
   */
  const [targets, setTargets] = useState<ModuleKey[]>([biz.module]);
  // La fiche ouverte peut BASCULER en modification : quand la saisie révèle un
  // produit déjà au catalogue et que l'utilisateur choisit de le reprendre, le
  // formulaire porte alors son `id` et doit l'enregistrer comme une mise à jour.
  const isEdit = !!form.id;
  const [showMarque, setShowMarque] = useState(false);
  const [showCat, setShowCat] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Liste des produits ressemblants, masquée dès que l'utilisateur l'écarte. */
  const [hideSuggestions, setHideSuggestions] = useState(false);
  /** Lecture du code-barres à la caméra plutôt qu'à la main. */
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');

  React.useEffect(() => {
    setForm(initial || emptyProduct());
    setHideSuggestions(false);
    setTargets([biz.module]);
  }, [initial, open, biz.module]);

  // ── Produits déjà au catalogue qui portent (à peu près) le même nom ──────
  const similar = useMemo(
    () => findSimilarProducts(biz.state.products, form.name || '', form.id),
    [biz.state.products, form.name, form.id]);
  const duplicate = useMemo(
    () => findExactProduct(biz.state.products, form.name || '', form.id),
    [biz.state.products, form.name, form.id]);
  const showSimilar = !hideSuggestions && similar.length > 0;

  /**
   * « Reprendre ce produit » : la fiche existante est chargée dans le
   * formulaire, qui passe en MODIFICATION. C'est ce qu'il faut faire neuf fois
   * sur dix — on voulait réapprovisionner ou corriger un produit, pas en créer
   * un second qui coupe l'historique en deux.
   */
  const adoptExisting = (p: BizProduct) => {
    setForm({ ...p });
    setHideSuggestions(true);
    toast('Fiche existante chargée — vous la modifiez au lieu d\'en créer une seconde', { icon: '✏️' });
  };

  const set = (k: keyof BizProduct, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const url = await uploadFile(BUCKETS.PRODUCT_IMAGES, fileName, file);
      if (url) {
        set('imageUrl', url);
      } else {
        const reader = new FileReader();
        reader.onloadend = () => set('imageUrl', reader.result as string);
        reader.readAsDataURL(file);
      }
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => set('imageUrl', reader.result as string);
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
    }
  };

  /**
   * Enregistre — et VÉRIFIE. L'écran ne dit « Produit créé » que lorsque le
   * serveur l'a confirmé ; sinon il le dit franchement et renvoie l'utilisateur
   * vers le brouillon conservé dans la Gestion de stock.
   */
  const save = async () => {
    if (!form.name?.trim() || saving) return;
    const product = buildProduct(form, { marques: biz.state.marques, categories: biz.state.categories });
    setSaving(true);
    try {
      if (isEdit) {
        onSaved?.(product);
        onClose();
        // La fiche modifiée part dans sa ligne, et on attend le verdict : une
        // modification annoncée « enregistrée » sans l'être, c'est un prix de
        // vente faux au point de vente jusqu'au prochain rechargement.
        const res = await biz.updateAndConfirm('products', product);
        if (res.ok) toast.success('Produit modifié');
        else toast.error(`Modification non enregistrée en base — ${res.error}`, { duration: 7000 });
        return;
      }

      // Création : le brouillon est posé d'abord, la fenêtre se ferme tout de
      // suite (l'utilisateur enchaîne), la confirmation arrive derrière.
      onSaved?.(product);
      onClose();

      // La cafétéria courante d'abord (c'est celle que l'écran affiche), puis
      // les autres cochées. Chacune reçoit une fiche INDÉPENDANTE : même nom,
      // mêmes prix de départ, mais son propre identifiant et son propre stock.
      const wanted = targets.includes(biz.module) ? targets : [biz.module, ...targets];
      const by = currentModuleWorker?.name || currentUserName || undefined;

      const failures: string[] = [];
      for (const key of wanted) {
        const copy: BizProduct = key === biz.module
          ? product
          : { ...product, id: newId(), createdAt: new Date().toISOString() };
        const res = key === biz.module
          ? await persistNewProduct(biz, copy, { createdBy: by, origin })
          : await confirmProduct(key, copy, 'add');
        if (!res.ok) failures.push(`${MODULES[key].label} — ${res.error || 'refus du serveur'}`);
      }

      if (!failures.length) {
        toast.success(wanted.length > 1
          ? `Produit créé dans ${wanted.length} cafétérias`
          : 'Produit créé et enregistré');
      } else {
        toast.error(
          `« ${product.name} » n'a pas pu être enregistré partout : ${failures.join(' · ')}. `
          + 'Ce qui a échoué est gardé dans les brouillons de la Gestion de stock.',
          { duration: 9000 },
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} icon={Package} size="xl" formScale
      title={isEdit ? 'Modifier le produit' : 'Nouveau produit'}
      subtitle="Informations du produit"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!form.name?.trim() || uploadingImage || saving}>
          {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}
        </button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* ── Où créer ce produit ? ────────────────────────────────────────
            Affiché seulement à la CRÉATION, et seulement s'il y a plusieurs
            cafétérias : sur une enseigne à un comptoir, ce serait un choix sans
            alternative — donc du bruit. */}
        {!isEdit && cafeterias.length > 1 && (
          <div className="sm:col-span-2 rounded-2xl border border-[#E7C9A9] bg-[#F5E7D8]/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] font-black uppercase tracking-wider text-[#8A5A2B]">
                Créer ce produit dans
              </p>
              <button type="button"
                onClick={() => setTargets(
                  targets.length === cafeterias.length ? [biz.module] : cafeterias.map(c => c.id))}
                className="text-[11px] font-bold text-[#8A5A2B] underline underline-offset-2">
                {targets.length === cafeterias.length ? 'Seulement celle-ci' : 'Toutes les cafétérias'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cafeterias.map(c => {
                const on = targets.includes(c.id);
                const locked = c.id === biz.module;   // on est dans son écran
                return (
                  <button key={c.id} type="button" disabled={locked}
                    onClick={() => setTargets(t => (on ? t.filter(x => x !== c.id) : [...t, c.id]))}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-bold transition-all border ${
                      on ? 'text-white shadow' : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]'
                    } ${locked ? 'opacity-100 cursor-default' : ''}`}
                    style={on ? { background: c.color || '#6F4E37', borderColor: c.color || '#6F4E37' } : undefined}>
                    {c.emoji || '☕'} {c.name}{locked ? ' · ici' : ''}
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] text-[#8A5A2B]/80 leading-relaxed">
              Chaque cafétéria reçoit sa <b>propre fiche</b> : même nom et mêmes prix au départ,
              mais un stock, un historique et des prix qui évoluent ensuite séparément.
            </p>
          </div>
        )}

        {/* ── Nom + produits déjà existants ────────────────────────────────
            Dès les premières lettres, le catalogue est interrogé et les fiches
            qui portent (à peu près) ce nom s'affichent avec leur stock et leurs
            prix. Sans cela, un « Eau minérale » finissait par exister en trois
            exemplaires, chacun avec un bout de l'historique et du stock. */}
        <div className="sm:col-span-2">
          <Field label="Nom du produit" required
            hint="Tapez les premières lettres : les produits déjà au catalogue qui portent ce nom s'affichent en dessous.">
            <Input value={form.name || ''}
              onChange={e => { set('name', e.target.value); setHideSuggestions(false); }}
              placeholder="Ex: Huile de table" autoComplete="off" />
          </Field>

          {duplicate && (
            <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 flex flex-wrap items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs font-bold text-amber-800 min-w-0 flex-1">
                « {duplicate.name} » existe déjà au catalogue — stock {formatQtyLabel(duplicate)}
                {' '}· achat {fc(duplicate.purchasePrice)}
              </span>
              {!isEdit && (
                <button type="button" className="btn-secondary !py-1.5 !px-3 text-[11px] shrink-0"
                  onClick={() => adoptExisting(duplicate)}>
                  <Pencil className="w-3.5 h-3.5" /> Modifier cette fiche
                </button>
              )}
            </div>
          )}

          {showSimilar && (
            <div className="mt-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 border-b border-slate-200">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 min-w-0 flex-1">
                  {similar.length} produit(s) déjà au catalogue avec ce nom
                </p>
                <button type="button" onClick={() => setHideSuggestions(true)}
                  className="text-[11px] font-bold text-slate-400 hover:text-slate-600 shrink-0">Masquer</button>
              </div>
              <div className="max-h-52 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                {similar.map(p => (
                  <div key={p.id} className="px-3.5 py-2.5 flex flex-wrap items-center gap-2 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-700 truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {p.categoryName || 'Sans catégorie'}
                        {p.barcode ? ` · ${p.barcode}` : ''}
                        {p.isRawMaterial ? ' · matière première' : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] font-black text-slate-600 tabular-nums">
                        Stock {formatQtyLabel(p)}
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        Achat {fc(p.purchasePrice)} · Vente {fc(p.salePrice)}
                      </p>
                    </div>
                    {!isEdit && (
                      <button type="button" className="btn-outline !py-1.5 !px-3 text-[11px] shrink-0"
                        onClick={() => adoptExisting(p)}>
                        Reprendre
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="px-3.5 py-2 text-[11px] text-slate-400 border-t border-slate-100">
                « Reprendre » charge la fiche existante ici : vous la modifiez au lieu d'en créer une seconde,
                et son stock comme son historique restent d'un seul tenant.
              </p>
            </div>
          )}
        </div>

        {/* ── Matière première ──────────────────────────────────────────────
            Un ingrédient (farine, café en grains, huile moteur…) se suit en
            stock et s'achète, mais ne se vend jamais tel quel : il disparaît
            alors du point de vente. */}
        <div className={`sm:col-span-2 rounded-xl border px-4 py-3 transition-colors ${
          form.isRawMaterial ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Beaker className={`w-4 h-4 mt-0.5 shrink-0 ${form.isRawMaterial ? 'text-amber-600' : 'text-slate-400'}`} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700">Matière première</p>
                <p className="text-xs text-slate-400">
                  Ingrédient de production — suivi en stock et en achats, jamais vendu tel quel
                </p>
              </div>
            </div>
            <Switch checked={!!form.isRawMaterial} onChange={v => set('isRawMaterial', v)} />
          </div>
          {form.isRawMaterial && (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <EyeOff className="w-3.5 h-3.5 shrink-0" />
              Ce produit n'apparaîtra pas au point de vente.
            </p>
          )}
        </div>

        {/* Image Upload Field */}
        <div className="sm:col-span-2">
          <Field label="Photo du produit" hint="Affichée sur les cartes du point de vente (POS).">
            <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
              {form.imageUrl ? (
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shrink-0 bg-white shadow-sm">
                  <img src={form.imageUrl} alt="Aperçu" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => set('imageUrl', '')}
                    className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 shadow-md hover:bg-red-700 transition-colors"
                    title="Supprimer l'image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center bg-white text-slate-400 shrink-0">
                  <ImageIcon className="w-6 h-6 mb-1" />
                  <span className="text-[10px] font-bold">Sans image</span>
                </div>
              )}
              <div className="flex-1 space-y-1.5">
                <label className="btn-secondary !py-2 !px-3.5 inline-flex items-center gap-2 cursor-pointer text-xs font-bold">
                  <Upload className="w-4 h-4 text-[#003087]" />
                  {uploadingImage ? 'Téléchargement…' : form.imageUrl ? "Changer la photo" : 'Choisir une photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={handleImageChange}
                  />
                </label>
                <p className="text-[11px] text-slate-400">Stockée dans le bucket Supabase « products ».</p>
              </div>
            </div>
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea value={form.description || ''} onChange={e => set('description', e.target.value)} placeholder="Description du produit" />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Code-barres"
            hint="Scannez le code du produit avec la caméra, ou générez-en un s'il n'en possède pas.">
            <div className="flex gap-2">
              <Input value={form.barcode || ''} onChange={e => set('barcode', e.target.value)} placeholder="Code-barres" />
              <button type="button" title="Scanner avec la caméra" className="btn-primary !px-3 shrink-0" onClick={() => { setScanNote(''); setScanning(true); }}>
                <ScanLine className="w-4 h-4" />
              </button>
              <button type="button" title="Générer" className="btn-secondary !px-3 shrink-0" onClick={() => set('barcode', genBarcode())}>
                <RefreshCw className="w-4 h-4" />
              </button>
              <button type="button" title="Imprimer" className="btn-outline !px-3 shrink-0" onClick={() => printBarcode(form as any)} disabled={!form.barcode}>
                <Printer className="w-4 h-4" />
              </button>
            </div>
          </Field>
          {scanNote && <p className="mt-1.5 text-[11px] font-bold text-amber-700">{scanNote}</p>}
        </div>

        <Field label="Marque">
          <div className="flex gap-2">
            <Select value={form.marqueId || ''} onChange={e => set('marqueId', e.target.value)}>
              <option value="">— Sélectionner —</option>
              {biz.state.marques.map(mq => <option key={mq.id} value={mq.id}>{mq.name}</option>)}
            </Select>
            <button type="button" className="btn-secondary !px-3 shrink-0" onClick={() => setShowMarque(s => !s)}>+</button>
          </div>
          {showMarque && (
            <div className="mt-2">
              <InlineCreate placeholder="Nouvelle marque" onCreate={name => {
                const it = { id: newId(), name }; biz.add('marques', it); set('marqueId', it.id); setShowMarque(false);
              }} />
            </div>
          )}
        </Field>

        <Field label="Catégorie">
          <div className="flex gap-2">
            <Select value={form.categoryId || ''} onChange={e => set('categoryId', e.target.value)}>
              <option value="">— Sélectionner —</option>
              {biz.state.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <button type="button" className="btn-secondary !px-3 shrink-0" onClick={() => setShowCat(s => !s)}>+</button>
          </div>
          {showCat && (
            <div className="mt-2">
              <InlineCreate placeholder="Nouvelle catégorie" onCreate={name => {
                const it = { id: newId(), name }; biz.add('categories', it); set('categoryId', it.id); setShowCat(false);
              }} />
            </div>
          )}
        </Field>

        <Field label="Quantité principale">
          <Input type="number" value={form.principalQty ?? 0} onChange={e => set('principalQty', e.target.value)} />
        </Field>
        {isEdit && (
          <Field label="Quantité restante">
            <Input type="number" value={form.currentQty ?? 0} onChange={e => set('currentQty', e.target.value)} />
          </Field>
        )}
        <Field label="Quantité minimale (alerte)">
          <Input type="number" value={form.minQty ?? 0} onChange={e => set('minQty', e.target.value)} />
        </Field>
        <Field label="Unité">
          <Select value={form.unit || 'unité'} onChange={e => set('unit', e.target.value)}>
            {['unité', 'kg', 'g', 'L', 'ml', 'part', 'jeu', 'boîte', 'pack'].map(u => <option key={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label="Prix d'achat (DA)">
          <Input type="number" value={form.purchasePrice ?? 0} onChange={e => set('purchasePrice', e.target.value)} />
        </Field>
        <Field label="Prix de vente (DA)">
          <Input type="number" value={form.salePrice ?? 0} onChange={e => set('salePrice', e.target.value)} />
        </Field>

        <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-700">Date d'expiration</p>
            <p className="text-xs text-slate-400">Activez pour suivre la péremption</p>
          </div>
          <Switch checked={!!form.hasExpiration} onChange={v => set('hasExpiration', v)} />
        </div>
        {form.hasExpiration && (
          <div className="sm:col-span-2">
            <Field label="Date d'expiration">
              <Input type="date" value={form.expirationDate || ''} onChange={e => set('expirationDate', e.target.value)} />
            </Field>
          </div>
        )}

        {/* ── Vente au détail ───────────────────────────────────────────────
            One packaged unit (a 50 L drum, a 25 kg sack…) can be sold litre by
            litre. The POS then deducts the fraction actually sold from stock.
            Sans objet pour une matière première, qui ne se vend pas. */}
        {!form.isRawMaterial && (
        <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-700">Vente au détail</p>
            <p className="text-xs text-slate-400">Vendre une fraction d'une unité (ex: 1 L sur un bidon de 50 L)</p>
          </div>
          <Switch checked={!!form.sellByDetail} onChange={v => set('sellByDetail', v)} />
        </div>
        )}
        {!form.isRawMaterial && form.sellByDetail && (
          <>
            <Field label="Contenance d'une unité" required hint="Ex: 50 pour un bidon de 50 litres">
              <Input type="number" value={form.detailCapacity ?? 0} onChange={e => set('detailCapacity', e.target.value)} />
            </Field>
            <Field label="Unité de détail">
              <Select value={form.detailUnit || 'L'} onChange={e => set('detailUnit', e.target.value)}>
                {DETAIL_UNITS.map(u => <option key={u}>{u}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={`Prix de vente d'un ${form.detailUnit || 'L'} (DA)`}
                hint={`Laissez à 0 pour utiliser ${Number(form.salePrice) || 0} ÷ ${Number(form.detailCapacity) || 0} automatiquement.`}>
                <Input type="number" value={form.detailSalePrice ?? 0} onChange={e => set('detailSalePrice', e.target.value)} />
              </Field>
            </div>
          </>
        )}
      </div>

      {/* ── Lecture du code-barres à la caméra ───────────────────────────────
          Le code lu remplit le champ. S'il appartient DÉJÀ à un autre produit,
          on le dit au lieu de laisser deux fiches partager le même code : le
          point de vente ne saurait plus laquelle vendre. */}
      {scanning && (
        <BarcodeScannerModal
          open
          title="Scanner le code du produit"
          subtitle="Présentez l'étiquette devant la caméra"
          onClose={() => setScanning(false)}
          onDetect={code => {
            const owner = biz.state.products.find(
              (p: BizProduct) => p.id !== form.id && (p.barcode || '').trim() === code);
            set('barcode', code);
            setScanNote(owner
              ? `Ce code appartient déjà à « ${owner.name} » — changez-le, ou reprenez cette fiche.`
              : '');
            if (owner) toast.error(`Code déjà utilisé par « ${owner.name} »`);
            else toast.success(`Code-barres ${code}`);
          }}
        />
      )}
    </Modal>
  );
}

// ─── Le parc d'un client (Lavage & Réparation) ─────────────────────────────────
export function ContactModal({
  biz, coll, open, onClose, initial, onSaved,
}: {
  biz: BizApi; coll: 'clients' | 'suppliers'; open: boolean; onClose: () => void;
  initial?: Partial<BizContact> | null; onSaved?: (c: BizContact) => void;
}) {
  const isSupplier = coll === 'suppliers';
  const isEdit = !!initial?.id;
  const blank = (): Partial<BizContact> => ({
    name: '', phone: '', address: '',
    openingDebt: 0, openingAdvance: 0, openingDate: todayISO(), openingNotes: '',
  });
  const [form, setForm] = useState<Partial<BizContact>>(initial || blank());
  React.useEffect(() => { setForm(initial || blank()); }, [initial, open]);

  const openDebt = Math.max(0, Number(form.openingDebt) || 0);
  const openAdvance = Math.max(0, Number(form.openingAdvance) || 0);

  const save = () => {
    if (!form.name?.trim()) return;
    const contact: BizContact = {
      id: form.id || newId(),
      name: form.name!.trim(),
      phone: form.phone || '',
      address: form.address || '',
      createdAt: form.createdAt || new Date().toISOString(),
      // ── La reprise du compte ────────────────────────────────────────────
      // Un client de cafétéria ou de lavage arrive rarement à zéro : il
      // traîne l'ardoise d'un carnet plus vieux que le logiciel. Faute d'un
      // endroit où l'écrire, il fallait inventer une fausse vente — qui
      // gonflait le chiffre d'affaires d'une marchandise jamais sortie.
      openingDebt: openDebt,
      openingAdvance: openAdvance,
      openingDate: (openDebt > 0 || openAdvance > 0) ? (form.openingDate || todayISO()) : undefined,
      openingNotes: form.openingNotes || undefined,
      // Les règlements déjà encaissés sur cette reprise ne se perdent pas
      // parce qu'on rouvre la fiche pour corriger un numéro de téléphone.
      openingPayments: form.openingPayments,
      // Idem pour les dépôts d'avance (trop-perçus portés au crédit) : rouvrir
      // la fiche pour une correction ne doit pas effacer l'argent que le client
      // a laissé d'avance.
      advancePayments: form.advancePayments,
    };
    if (isEdit) biz.update(coll, contact); else biz.add(coll, contact);
    onSaved?.(contact);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} icon={isSupplier ? Truck : User} size="lg" formScale
      title={isEdit ? (isSupplier ? 'Modifier le fournisseur' : 'Modifier le client') : (isSupplier ? 'Nouveau fournisseur' : 'Nouveau client')}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!form.name?.trim()}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
      </>}>
      <div className="space-y-4">
        <Field label="Nom" required><Input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom complet" /></Field>
        <Field label="Téléphone"><Input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0550 00 00 00" /></Field>
        <Field label="Adresse"><Textarea value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Adresse" /></Field>

        {!isSupplier && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-800">Reprise à l'ouverture du compte</p>
            </div>
            <p className="text-[11px] font-semibold text-amber-900/70 leading-relaxed">
              Ce que le client doit déjà — ou a déjà versé — avant sa première vente ici.
              Le montant devient la première ligne de son historique et compte sur sa carte,
              dans la Caisse Générale et dans les rapports. La <b>dette</b> est une créance de
              plus ; l'<b>avance</b> est son argent : elle vient en déduction de ce qu'il doit,
              et lui reste acquise tant qu'il n'a rien pris.
            </p>
            <p className="text-[11px] font-semibold text-amber-900/70 leading-relaxed">
              Ni l'une ni l'autre ne fait bouger le tiroir aujourd'hui : ce sont des soldes
              REPRIS, contractés ou encaissés avant que la station ne tienne ce compte. Seuls
              les règlements saisis ensuite entrent en caisse.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Dette initiale (DA)">
                <Input type="number" inputMode="decimal" className="text-right" value={form.openingDebt ?? 0}
                  onChange={e => setForm(f => ({ ...f, openingDebt: Number(e.target.value) || 0 }))} />
              </Field>
              <Field label="Avance initiale (DA)">
                <Input type="number" inputMode="decimal" className="text-right" value={form.openingAdvance ?? 0}
                  onChange={e => setForm(f => ({ ...f, openingAdvance: Number(e.target.value) || 0 }))} />
              </Field>
            </div>
            {(openDebt > 0 || openAdvance > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date de la reprise">
                  <Input type="date" value={(form.openingDate || todayISO()).slice(0, 10)}
                    onChange={e => setForm(f => ({ ...f, openingDate: e.target.value }))} />
                </Field>
                <Field label="Note (facultatif)">
                  <Input value={form.openingNotes || ''} placeholder="Ancien carnet, solde repris au…"
                    onChange={e => setForm(f => ({ ...f, openingNotes: e.target.value }))} />
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Product picker (search products in stock) ─────────────────────────────────
export function useProductSearch(products: BizProduct[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return products;
  return products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) || (p.description || '').toLowerCase().includes(q));
}

// ─── PayDebtModal ───────────────────────────────────────────────────────────────
/** Ce qu'un encaissement porte en plus de son montant. */
export interface PayDebtMeta {
  /** Espèces, Chèque, TPE, Virement. */
  mode: string;
  /** Numéro de chèque, de bordereau ou de transaction. */
  reference?: string;
  /** Date de l'encaissement, `YYYY-MM-DD` — aujourd'hui par défaut. */
  date: string;
}

/** Modes proposés à la caisse d'une partie. */
export const PAY_MODES = ['Espèces', 'Chèque', 'TPE', 'Virement'] as const;

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function PayDebtModal({
  open, onClose, total, alreadyPaid, advanceHeld = 0, allowAdvance = false, onPay, title = 'Payer la dette',
}: {
  open: boolean; onClose: () => void; total: number; alreadyPaid: number;
  /**
   * L'avance que la station détient DÉJÀ pour ce client. Elle ne figurait pas
   * ici : la fenêtre réclamait la dette entière à un client qui avait payé
   * d'avance, et le caissier encaissait une seconde fois le même argent.
   */
  advanceHeld?: number;
  /**
   * Autorise un ENCAISSEMENT SUPÉRIEUR à la dette : le trop-perçu devient une
   * avance au crédit du client. Réservé au règlement d'un COMPTE entier (écran
   * Clients) — un règlement sur une facture unique reste plafonné à son reste,
   * car un trop-perçu n'aurait aucune pièce où s'imputer.
   */
  allowAdvance?: boolean;
  /**
   * `meta` porte le mode, la référence et la DATE de l'encaissement : sans elle
   * un relevé de compte ne peut pas dire quand l'argent est entré.
   */
  onPay: (amount: number, meta: PayDebtMeta) => void;
  title?: string;
}) {
  const advance = Math.max(0, Number(advanceHeld) || 0);
  const gross = Math.max(0, total - alreadyPaid);
  /** Ce qu'il reste à ENCAISSER : la dette, son avance déduite. */
  const rest = Math.max(0, gross - advance);
  const [amount, setAmount] = useState<number>(rest);
  const [mode, setMode] = useState<string>('Espèces');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState<string>(todayISO());
  React.useEffect(() => {
    setAmount(rest); setMode('Espèces'); setReference(''); setDate(todayISO());
  }, [rest, open]);
  const newRest = Math.max(0, rest - (Number(amount) || 0));
  /** Le trop-perçu qui deviendra une avance — seulement là où c'est permis. */
  const surplus = allowAdvance ? Math.max(0, (Number(amount) || 0) - rest) : 0;

  return (
    <Modal open={open} onClose={onClose} icon={Wallet} size="lg" formScale title={title} subtitle="Encaissement d'un règlement partiel ou total"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" disabled={!amount || amount <= 0}
          onClick={() => { if (amount > 0) onPay(Number(amount), { mode, reference: reference.trim() || undefined, date }); }}>
          Enregistrer le paiement
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm sm:text-base">{fc(total)}</p></div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Déjà payé</p><p className="font-black text-emerald-600 tabular-nums text-sm sm:text-base">{fc(alreadyPaid)}</p></div>
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm sm:text-base">{fc(rest)}</p></div>
        </div>
        {advance > 0 && (
          <div className="rounded-xl bg-teal-50 border border-teal-200 p-3 text-[11px] font-semibold text-teal-900 leading-relaxed">
            La station détient déjà <b>{fc(advance)}</b> d'avance pour ce client :
            {' '}{fc(Math.min(advance, gross))} en sont imputés sur les {fc(gross)} de ses documents ouverts.
            Ne lui réclamez que le reste.
          </div>
        )}
        <Field label="Montant à payer cette fois (DA)">
          <Input type="number" inputMode="decimal" value={amount}
            onChange={e => setAmount(Number(e.target.value))}
            max={allowAdvance ? undefined : rest} className="text-right" />
        </Field>
        {surplus > 0 && (
          <div className="rounded-xl bg-teal-50 border border-teal-200 p-3 text-[11px] font-semibold text-teal-900 leading-relaxed">
            Le client verse <b>{fc(surplus)}</b> de plus que sa dette :
            {' '}ce trop-perçu est enregistré comme une <b>avance</b> à son crédit,
            {' '}qu'il pourra utiliser sur ses prochains achats.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Mode de règlement">
            <Select value={mode} onChange={e => setMode(e.target.value)}>
              {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Référence (chèque, bordereau…)">
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optionnel" />
          </Field>
          <Field label="Date de l'encaissement">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="rounded-2xl bg-[#001f5c] text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-blue-200">Nouveau reste</span>
          <span className="text-2xl font-black tabular-nums text-[#FFB800]">{fc(newRest)}</span>
        </div>
        {surplus > 0 && (
          <div className="rounded-2xl bg-teal-600 text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-teal-100">Avance créée</span>
            <span className="text-2xl font-black tabular-nums text-white">{fc(surplus)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Les versements d'un document au moment où il est ENREGISTRÉ (création, ou
 * édition qui change le montant déjà payé).
 *
 * Tant que la somme des versements connus colle au cumul `paid`, on les garde
 * intacts — une édition de libellé ne doit pas réécrire l'histoire des
 * encaissements. Dès qu'elle ne colle plus, l'ancien détail ne décrit plus ce
 * document : il est remplacé par UN versement à la date du document, ce qui est
 * exactement ce que l'on sait de lui.
 */
export function seedPayments(
  previous: BizDocPayment[] | undefined, paid: number, date: string, by?: string,
): BizDocPayment[] | undefined {
  const known = Array.isArray(previous) ? previous : [];
  const sum = known.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  if (known.length && Math.abs(sum - paid) < 0.005) return known;
  if (paid <= 0) return undefined;
  return [{ id: newId(), date, amount: paid, mode: 'Espèces', by }];
}

/**
 * Ajoute un versement DATÉ à un document (vente ou intervention) et remet à jour
 * son cumul `paid`.
 *
 * Les documents antérieurs n'avaient qu'un cumul : le premier appel le reprend
 * comme versement d'origine, à la date du document, pour que la somme des
 * versements soit toujours égale à `paid` — sinon le relevé encaisserait deux
 * fois le même argent.
 */
export function withPayment<T extends { id: string; date: string; total: number; paid: number; payments?: BizDocPayment[] }>(
  doc: T, amount: number, meta: PayDebtMeta, by?: string,
): T & { paid: number; rest: number; payments: BizDocPayment[] } {
  const existing: BizDocPayment[] = Array.isArray(doc.payments) ? [...doc.payments] : [];
  if (!existing.length && doc.paid > 0) {
    existing.push({ id: `${doc.id}-p0`, date: doc.date, amount: doc.paid, mode: 'Espèces' });
  }
  const paid = Math.min(doc.total, doc.paid + amount);
  // Le versement réellement ajouté ne peut pas dépasser ce qui restait dû.
  const applied = paid - doc.paid;
  if (applied > 0) {
    existing.push({
      id: newId(),
      date: `${meta.date}T${new Date().toTimeString().slice(0, 8)}`,
      amount: applied,
      mode: meta.mode,
      reference: meta.reference,
      by,
    });
  }
  return { ...doc, paid, rest: Math.max(0, doc.total - paid), payments: existing };
}

// ─── Invoice print helper ───────────────────────────────────────────────────────

/** Identity of the station, printed in the header of every document. */
export interface PrintStation {
  name?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  fiscalId?: string;
  rc?: string;
}

export interface PrintPaymentLine {
  label: string;      // "Espèces", "BNA — chèque 445221"…
  amount: number;
  reference?: string;
}

export interface PrintInvoiceOptions {
  title: string;
  ref: string;
  date: string;
  station?: PrintStation;
  /** @deprecated pass `station` instead — kept so old call sites keep compiling. */
  store?: string;
  party?: { label: string; name: string; phone?: string; address?: string };
  /** Free-form blocks printed under the party (vehicle, session, worker…). */
  info?: { label: string; value: string }[];
  items: { name: string; qty: number | string; unitPrice: number; total: number }[];
  subtotal?: number;
  reduction?: number;
  tva?: number;
  total: number;
  paid: number;
  rest: number;
  payments?: PrintPaymentLine[];
  notes?: string;
  footerNote?: string;
}

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dz = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

export function printInvoice(opts: PrintInvoiceOptions) {
  const st = opts.station || {};
  const stationName = st.name || opts.store || 'altech station';

  const rows = opts.items.map(it => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(it.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${esc(it.qty)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${dz(it.unitPrice)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${dz(it.total)}</td>
    </tr>`).join('');

  const totalLine = (label: string, value: string, color = '#1e293b', border = '') =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;color:${color};${border}">
       <span>${esc(label)}</span><strong>${value} DA</strong></div>`;

  const infoBlocks = (opts.info || []).filter(i => i.value).map(i => `
    <div style="background:#f8fafc;border-radius:10px;padding:10px 14px">
      <p style="margin:0;font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(i.label)}</p>
      <p style="margin:3px 0 0;font-weight:700;font-size:13px">${esc(i.value)}</p>
    </div>`).join('');

  const paymentRows = (opts.payments || []).filter(p => p.amount > 0).map(p => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(p.label)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#64748b">${esc(p.reference || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right"><strong>${dz(p.amount)} DA</strong></td>
    </tr>`).join('');

  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)} ${esc(opts.ref)}</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;padding:32px;max-width:760px;margin:auto">

      <!-- Header: station identity + document -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #003087;padding-bottom:16px;margin-bottom:18px;gap:16px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="" style="width:58px;height:58px;object-fit:cover;border-radius:12px">` : ''}
          <div>
            <h1 style="margin:0;color:#003087;font-size:21px">${esc(stationName)}</h1>
            ${st.address ? `<p style="margin:3px 0 0;color:#64748b;font-size:12px">${esc(st.address)}</p>` : ''}
            ${st.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">Tél: ${esc(st.phone)}</p>` : ''}
            ${st.email ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">${esc(st.email)}</p>` : ''}
            ${(st.fiscalId || st.rc) ? `<p style="margin:2px 0 0;color:#94a3b8;font-size:11px">
              ${st.fiscalId ? `NIF: ${esc(st.fiscalId)}` : ''}${st.fiscalId && st.rc ? ' • ' : ''}${st.rc ? `RC: ${esc(st.rc)}` : ''}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <h2 style="margin:0;color:#FFB800;font-size:19px">${esc(opts.title)}</h2>
          <p style="margin:4px 0 0;font-weight:700">${esc(opts.ref)}</p>
          <p style="margin:2px 0 0;color:#64748b;font-size:12px">${new Date(opts.date).toLocaleString('fr-DZ')}</p>
        </div>
      </div>

      ${opts.party ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(opts.party.label)}</p>
        <p style="margin:4px 0 0;font-weight:700;font-size:15px">${esc(opts.party.name)}</p>
        ${opts.party.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">Tél: ${esc(opts.party.phone)}</p>` : ''}
        ${opts.party.address ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${esc(opts.party.address)}</p>` : ''}
      </div>` : ''}

      ${infoBlocks ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px">${infoBlocks}</div>` : ''}

      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#003087;color:#fff">
          <th style="padding:10px;text-align:left">Désignation</th><th style="padding:10px">Qté</th>
          <th style="padding:10px;text-align:right">P.U (DA)</th><th style="padding:10px;text-align:right">Total (DA)</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="4" style="padding:12px;color:#94a3b8">Aucune ligne</td></tr>'}</tbody></table>

      <div style="margin-top:16px;margin-left:auto;width:280px;font-size:13px">
        ${opts.subtotal !== undefined ? totalLine('Sous-total', dz(opts.subtotal)) : ''}
        ${opts.reduction ? totalLine('Remise', `- ${dz(opts.reduction)}`, '#b45309') : ''}
        ${opts.tva ? totalLine('TVA', dz(opts.tva)) : ''}
        ${totalLine('Total', dz(opts.total), '#003087', 'border-top:2px solid #003087;font-size:15px')}
        ${totalLine('Payé', dz(opts.paid), '#059669')}
        ${totalLine('Reste', dz(opts.rest), '#dc2626')}
      </div>

      ${paymentRows ? `<div style="margin-top:22px">
        <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">Détail du paiement</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f1f5f9;color:#475569">
            <th style="padding:6px 8px;text-align:left">Mode</th>
            <th style="padding:6px 8px;text-align:left">Référence</th>
            <th style="padding:6px 8px;text-align:right">Montant</th>
          </tr></thead><tbody>${paymentRows}</tbody></table>
      </div>` : ''}

      ${opts.notes ? `<div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#b45309;font-weight:700">Observations</p>
        <p style="margin:4px 0 0;font-size:13px">${esc(opts.notes)}</p></div>` : ''}

      <div style="display:flex;justify-content:space-between;margin-top:56px">
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Signature Client</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Cachet &amp; Signature</div></div>
      </div>
      <p style="margin-top:26px;text-align:center;color:#94a3b8;font-size:11px">
        ${esc(opts.footerNote || `${stationName} — Merci de votre confiance.`)}</p>

      <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}

// ─── Payment receipt (reçu de règlement) ────────────────────────────────────────
/**
 * Receipt handed to a client (or kept by the station) when a debt instalment is
 * collected. Same visual language as `printInvoice`, but the body is the
 * movement itself — dette avant → montant réglé → dette après — instead of a
 * list of articles.
 */
export interface PrintReceiptOptions {
  /** Document title, e.g. "Reçu de règlement". */
  title?: string;
  /** Receipt number printed top-right. */
  ref: string;
  date: string;
  station?: PrintStation;
  party?: { label: string; name: string; phone?: string; address?: string };
  /** Extra blocks under the party (N° facture, encaissé par…). */
  info?: { label: string; value: string }[];
  amount: number;
  /** Payment mode: Espèces / Chèque / Virement. */
  mode?: string;
  /** Cheque or transfer number. */
  reference?: string;
  /** Debt before and after the payment, printed as the receipt's summary. */
  debtBefore?: number;
  debtAfter?: number;
  notes?: string;
  footerNote?: string;
}

export function printPaymentReceipt(opts: PrintReceiptOptions) {
  const st = opts.station || {};
  const stationName = st.name || 'altech station';
  const title = opts.title || 'Reçu de règlement';

  const infoBlocks = (opts.info || []).filter(i => i.value).map(i => `
    <div style="background:#f8fafc;border-radius:10px;padding:10px 14px">
      <p style="margin:0;font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(i.label)}</p>
      <p style="margin:3px 0 0;font-weight:700;font-size:13px">${esc(i.value)}</p>
    </div>`).join('');

  const row = (label: string, value: string, color = '#1e293b', extra = '') =>
    `<div style="display:flex;justify-content:space-between;padding:8px 0;color:${color};${extra}">
       <span>${esc(label)}</span><strong>${value} DA</strong></div>`;

  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(opts.ref)}</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;padding:32px;max-width:760px;margin:auto">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #003087;padding-bottom:16px;margin-bottom:18px;gap:16px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="" style="width:58px;height:58px;object-fit:cover;border-radius:12px">` : ''}
          <div>
            <h1 style="margin:0;color:#003087;font-size:21px">${esc(stationName)}</h1>
            ${st.address ? `<p style="margin:3px 0 0;color:#64748b;font-size:12px">${esc(st.address)}</p>` : ''}
            ${st.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">Tél: ${esc(st.phone)}</p>` : ''}
            ${(st.fiscalId || st.rc) ? `<p style="margin:2px 0 0;color:#94a3b8;font-size:11px">
              ${st.fiscalId ? `NIF: ${esc(st.fiscalId)}` : ''}${st.fiscalId && st.rc ? ' • ' : ''}${st.rc ? `RC: ${esc(st.rc)}` : ''}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <h2 style="margin:0;color:#FFB800;font-size:19px">${esc(title)}</h2>
          <p style="margin:4px 0 0;font-weight:700">${esc(opts.ref)}</p>
          <p style="margin:2px 0 0;color:#64748b;font-size:12px">${new Date(opts.date).toLocaleString('fr-DZ')}</p>
        </div>
      </div>

      ${opts.party ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(opts.party.label)}</p>
        <p style="margin:4px 0 0;font-weight:700;font-size:15px">${esc(opts.party.name)}</p>
        ${opts.party.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">Tél: ${esc(opts.party.phone)}</p>` : ''}
        ${opts.party.address ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${esc(opts.party.address)}</p>` : ''}
      </div>` : ''}

      ${infoBlocks ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px">${infoBlocks}</div>` : ''}

      <!-- Le montant encaissé : l'information principale du reçu -->
      <div style="background:#003087;color:#fff;border-radius:12px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div>
          <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#bfdbfe;font-weight:700">Montant encaissé</p>
          <p style="margin:6px 0 0;font-size:12px;color:#bfdbfe">
            ${esc(opts.mode || 'Espèces')}${opts.reference ? ` — ${esc(opts.reference)}` : ''}
          </p>
        </div>
        <span style="font-size:30px;font-weight:800;color:#FFB800">${dz(opts.amount)} DA</span>
      </div>

      ${(opts.debtBefore !== undefined || opts.debtAfter !== undefined) ? `
        <div style="margin-left:auto;width:300px;font-size:13px">
          ${opts.debtBefore !== undefined ? row('Dette avant règlement', dz(opts.debtBefore), '#64748b') : ''}
          ${row('Montant réglé', `- ${dz(opts.amount)}`, '#059669')}
          ${opts.debtAfter !== undefined ? row('Reste dû', dz(opts.debtAfter), '#dc2626', 'border-top:2px solid #003087;font-size:15px') : ''}
        </div>` : ''}

      ${opts.notes ? `<div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#b45309;font-weight:700">Observations</p>
        <p style="margin:4px 0 0;font-size:13px">${esc(opts.notes)}</p></div>` : ''}

      <div style="display:flex;justify-content:space-between;margin-top:56px">
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Signature Client</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Cachet &amp; Signature</div></div>
      </div>
      <p style="margin-top:26px;text-align:center;color:#94a3b8;font-size:11px">
        ${esc(opts.footerNote || `${stationName} — Reçu faisant foi de règlement.`)}</p>

      <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}

// ─── "Imprimer la facture ?" prompt ─────────────────────────────────────────────
/**
 * Small confirmation shown right after a sale / lavage / réparation is saved, so
 * the user decides whether the document is printed.
 */
export function AskPrintModal({
  open, title = 'Imprimer la facture ?', message, onPrint, onSkip,
}: {
  open: boolean; title?: string; message?: string;
  onPrint: () => void; onSkip: () => void;
}) {
  const m = useMotionPrefs();
  /**
   * C'était le dernier dialogue à s'ouvrir par une animation CSS : il
   * apparaissait un peu autrement que tous les autres, et surtout il
   * disparaissait sans transition. Il parle maintenant la même langue que le
   * reste (`confirm`) — et il arrive juste après un encaissement, le moment où
   * une saccade se remarque le plus.
   */
  return (
    <ModalPortal>
      <AnimatePresence>
        {open && (
          <div className="modal-shell" style={{ zIndex: 80 }} onClick={onSkip}>
            <motion.div
              variants={m.backdrop} initial="hidden" animate="show" exit="out"
              className="absolute inset-0 bg-[#1C110B]/55 backdrop-blur-sm"
            />
            <motion.div
              variants={m.confirm} initial="hidden" animate="show" exit="out"
              className="modal-box max-w-sm relative z-10" onClick={e => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="w-12 h-12 rounded-2xl bg-[#F5E7D8] flex items-center justify-center mb-4">
                  <Printer className="w-6 h-6 text-[#8A5A2B]" />
                </div>
                <h3 className="text-base font-black text-[#4B3621] mb-2">{title}</h3>
                <p className="text-sm text-[#7A6A5C]">
                  {message || "Le document reprend les informations de l'enseigne, du client et du paiement."}
                </p>
              </div>
              <div className="p-6 pt-0 flex gap-3">
                <motion.button onClick={onSkip} className="btn-ghost flex-1" {...m.pressSubtle}>
                  Non, merci
                </motion.button>
                <motion.button onClick={onPrint} className="btn-primary flex-1" {...m.press}>
                  <Printer className="w-4 h-4" /> Imprimer
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}

/** Maps the app's station settings onto the print header shape. */
export function stationFromSettings(settings: any): PrintStation {
  return {
    name: settings?.stationName || settings?.name,
    logoUrl: settings?.logoUrl || settings?.logo,
    address: settings?.address,
    phone: settings?.phone,
    email: settings?.email,
    fiscalId: settings?.fiscalId,
    rc: settings?.rc,
  };
}
