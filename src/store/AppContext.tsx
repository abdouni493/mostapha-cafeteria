/**
 * ─── Altech Cafétéria — État applicatif transversal ────────────────────────────
 *
 * Ce store ne porte PLUS de données métier : tout ce que contient une cafétéria
 * (stock, achats, ventes, clients, employés, caisse…) vit dans `BizContext`, où
 * chaque cafétéria est une partie indépendante.
 *
 * Il ne reste donc ici que ce qui est commun à toute l'application :
 *   • l'enseigne et ses réglages (`store_settings`) ;
 *   • QUI est connecté — administrateur ou employé d'une cafétéria — et ce qu'il
 *     a le droit de voir ;
 *   • la caisse GÉNÉRALE de l'enseigne (le coffre au-dessus des cafétérias) ;
 *   • les messages éphémères (toasts) et le journal d'activité.
 *
 * C'est cette séparation qui permet d'ajouter une cafétéria sans toucher à une
 * seule ligne de code : rien ici ne connaît le nombre de cafétérias.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { db, dbSelectAll, dbInsert, dbUpdate, dbDelete, subscribeTable } from '../lib/supabase';

// ─── Qui est connecté ─────────────────────────────────────────────────────────

/**
 * Deux rôles seulement, et c'est volontaire :
 *   • `admin`         — voit toutes les cafétérias, règle l'application ;
 *   • `module_worker` — employé d'UNE cafétéria, ne voit que la sienne et
 *                       uniquement les interfaces qu'on lui a cochées.
 */
export type AppUserRole = 'admin' | 'module_worker';

/** Session d'un employé de cafétéria : sa cafétéria et ses `iface.action`. */
export interface ModuleWorkerSession {
  id: string;
  /** Identifiant de SA cafétéria — il n'en voit aucune autre. */
  moduleKey: string;
  name: string;
  roleName?: string;
  /** Clés `"<interface>.<action>"` → autorisé. */
  permissions: Record<string, boolean>;
  avatarUrl?: string;
}

// ─── Réglages de l'enseigne ───────────────────────────────────────────────────

export interface StoreSettings {
  /** Nom de l'enseigne — apparaît sur les tickets et à la connexion. */
  name: string;
  logo?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** Identifiant fiscal / NIF. */
  fiscalId?: string;
  /** Registre de commerce. */
  rc?: string;
  /** Article d'imposition. */
  ai?: string;
  /** Numéro d'identification statistique. */
  nis?: string;
  /** Devise affichée (« DA » par défaut). */
  currency?: string;
  /** Pied de page imprimé sur les tickets de caisse. */
  ticketFooter?: string;
  productCategories: string[];
  expenseCategories: string[];
  productUnits?: string[];
  /** Seuil de stock bas par défaut proposé à la création d'un produit. */
  defaultMinQty?: number;
}

/** Unités proposées tant que l'enseigne n'a pas défini les siennes. */
export const DEFAULT_PRODUCT_UNITS = ['Pièce', 'Tasse', 'Litre', 'Kg', 'Carton', 'Pack', 'Bouteille'];

export const DEFAULT_PRODUCT_CATEGORIES = [
  'Boissons chaudes', 'Boissons fraîches', 'Viennoiserie', 'Pâtisserie', 'Snacks', 'Épicerie',
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Salaires', 'Loyer', 'Électricité', 'Eau', 'Gaz', 'Entretien', 'Fournitures', 'Impôts', 'Divers',
];

const emptySettings: StoreSettings = {
  name: '',
  currency: 'DA',
  productCategories: DEFAULT_PRODUCT_CATEGORIES,
  expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
  productUnits: DEFAULT_PRODUCT_UNITS,
  defaultMinQty: 5,
};

// ─── La caisse GÉNÉRALE de l'enseigne ─────────────────────────────────────────
/**
 * Le coffre AU-DESSUS des cafétérias. Chaque cafétéria a son tiroir (dans son
 * propre état) ; la caisse générale est là où remontent les fonds, et d'où
 * sortent les charges communes (loyer, salaires du siège, impôts).
 *
 * `cafeteriaId` renseigné = la ligne est le MIROIR d'un transfert saisi dans une
 * cafétéria. Les deux écrans lisent alors la même opération : c'est ce qui
 * empêche qu'une remontée de fonds soit comptée deux fois.
 */
export type GeneralCashKind = 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out' | 'expense';

export interface GeneralCashTx {
  id: string;
  kind: GeneralCashKind;
  amount: number;
  date: string;
  label: string;
  category?: string;
  /** Cafétéria d'où vient (ou vers laquelle part) l'argent, pour un transfert. */
  cafeteriaId?: string;
  /** Ligne du tiroir de la cafétéria dont celle-ci est le miroir. */
  linkedTxId?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

/** Signe d'une ligne sur le solde du coffre général. */
export function generalCashEffect(t: Pick<GeneralCashTx, 'kind' | 'amount'>): number {
  const a = Number(t.amount) || 0;
  return t.kind === 'deposit' || t.kind === 'transfer_in' ? a : -a;
}

/** Solde du coffre général — la somme de toutes ses lignes. */
export function generalCashBalance(txs: GeneralCashTx[]): number {
  return txs.reduce((s, t) => s + generalCashEffect(t), 0);
}

// ─── Messages éphémères ───────────────────────────────────────────────────────
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  /** Durée en SECONDES. */
  duration?: number;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: string;
  details: string;
}

// ─── L'état ───────────────────────────────────────────────────────────────────
export interface AppState {
  settings: StoreSettings;
  generalCash: GeneralCashTx[];
  toasts: ToastMessage[];
  activityLog: ActivityEntry[];
  isRtl: boolean;
  currentUserRole: AppUserRole;
  currentUserId?: string;
  currentUserName?: string;
  currentUserAvatarUrl?: string;
  /** Renseigné uniquement pour un employé de cafétéria. */
  currentModuleWorker?: ModuleWorkerSession;
  isLoading: boolean;
}

const initialState: AppState = {
  settings: emptySettings,
  generalCash: [],
  toasts: [],
  activityLog: [],
  isRtl: false,
  currentUserRole: 'admin',
  isLoading: true,
};

// ─── Actions ──────────────────────────────────────────────────────────────────
export type AppAction =
  | { type: 'SET_SETTINGS'; payload: Partial<StoreSettings> }
  | { type: 'HYDRATE'; payload: Partial<AppState> }
  | { type: 'ADD_GENERAL_TX'; payload: GeneralCashTx }
  | { type: 'UPDATE_GENERAL_TX'; payload: GeneralCashTx }
  | { type: 'DELETE_GENERAL_TX'; payload: string }
  | { type: 'ADD_TOAST'; payload: Omit<ToastMessage, 'id'> & { id?: string } }
  | { type: 'REMOVE_TOAST'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_RTL'; payload: boolean }
  | { type: 'ADD_ACTIVITY'; payload: ActivityEntry }
  | {
      type: 'SET_CURRENT_USER';
      payload: {
        role: AppUserRole;
        id?: string;
        name?: string;
        avatarUrl?: string;
        moduleWorker?: ModuleWorkerSession;
      };
    };

const newId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload };

    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };

    case 'ADD_GENERAL_TX':
      return { ...state, generalCash: [action.payload, ...state.generalCash] };

    case 'UPDATE_GENERAL_TX':
      return {
        ...state,
        generalCash: state.generalCash.map(t => (t.id === action.payload.id ? action.payload : t)),
      };

    case 'DELETE_GENERAL_TX':
      return { ...state, generalCash: state.generalCash.filter(t => t.id !== action.payload) };

    case 'ADD_TOAST': {
      const toast: ToastMessage = { id: action.payload.id || newId('toast'), ...action.payload };
      // Un même message répété (une sauvegarde qui échoue en boucle) ne doit pas
      // empiler dix bandeaux identiques par-dessus l'écran.
      const already = state.toasts.some(t => t.title === toast.title && t.message === toast.message);
      return already ? state : { ...state, toasts: [...state.toasts, toast] };
    }

    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_RTL':
      return { ...state, isRtl: action.payload };

    case 'ADD_ACTIVITY':
      return { ...state, activityLog: [action.payload, ...state.activityLog].slice(0, 300) };

    case 'SET_CURRENT_USER':
      return {
        ...state,
        currentUserRole: action.payload.role,
        currentUserId: action.payload.id ?? state.currentUserId,
        currentUserName: action.payload.name ?? state.currentUserName,
        currentUserAvatarUrl: action.payload.avatarUrl ?? state.currentUserAvatarUrl,
        currentModuleWorker: action.payload.moduleWorker ?? state.currentModuleWorker,
      };

    default:
      return state;
  }
}

// ─── Contexte ─────────────────────────────────────────────────────────────────
const StateCtx = createContext<AppState | null>(null);
const DispatchCtx = createContext<React.Dispatch<AppAction> | null>(null);

/** Ligne `general_cash` ↔ modèle applicatif. */
const rowToGeneralTx = (r: any): GeneralCashTx => ({
  id: r.id,
  kind: r.kind,
  amount: Number(r.amount) || 0,
  date: r.date,
  label: r.label || '',
  category: r.category || undefined,
  cafeteriaId: r.cafeteria_id || undefined,
  linkedTxId: r.linked_tx_id || undefined,
  notes: r.notes || undefined,
  createdBy: r.created_by_name || undefined,
  createdAt: r.created_at || r.date,
});

const generalTxToRow = (t: GeneralCashTx) => ({
  id: t.id,
  kind: t.kind,
  amount: t.amount,
  date: t.date,
  label: t.label,
  category: t.category ?? null,
  cafeteria_id: t.cafeteriaId ?? null,
  linked_tx_id: t.linkedTxId ?? null,
  notes: t.notes ?? null,
  created_by_name: t.createdBy ?? null,
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(appReducer, initialState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  /**
   * ─── ÉCRIRE D'ABORD À L'ÉCRAN, PUIS EN BASE ────────────────────────────────
   * L'écran suit la saisie tout de suite (l'utilisateur ne regarde pas un
   * curseur tourner), et l'écriture part derrière. Si la base la REFUSE, on ne
   * se contente pas d'un message : on recharge la table concernée, pour que ce
   * qui est affiché redevienne ce qui est réellement enregistré. Sans ce
   * rattrapage, une ligne refusée resterait à l'écran jusqu'au rechargement
   * suivant — et disparaîtrait alors sans explication.
   */
  const dispatch = useCallback((action: AppAction) => {
    rawDispatch(action);

    const fail = (err: unknown, what: string) => {
      console.error(`[AppContext] ${what}`, err);
      rawDispatch({
        type: 'ADD_TOAST',
        payload: {
          type: 'error',
          title: 'Enregistrement refusé',
          message: `${what} — la base a refusé l'opération. L'écran a été rechargé.`,
          duration: 6,
        },
      });
      void reloadGeneralCash();
    };

    (async () => {
      try {
        switch (action.type) {
          case 'SET_SETTINGS': {
            const s = { ...stateRef.current.settings, ...action.payload };
            await db.saveSettings({
              name: s.name,
              logo_url: s.logoUrl ?? s.logo ?? null,
              address: s.address ?? null,
              phone: s.phone ?? null,
              email: s.email ?? null,
              fiscal_id: s.fiscalId ?? null,
              rc: s.rc ?? null,
              ai: s.ai ?? null,
              nis: s.nis ?? null,
              currency: s.currency ?? 'DA',
              ticket_footer: s.ticketFooter ?? null,
              product_categories: s.productCategories ?? [],
              expense_categories: s.expenseCategories ?? [],
              product_units: s.productUnits ?? [],
              default_min_qty: s.defaultMinQty ?? 5,
            });
            break;
          }
          case 'ADD_GENERAL_TX':
            await dbInsert('general_cash', generalTxToRow(action.payload));
            break;
          case 'UPDATE_GENERAL_TX':
            await dbUpdate('general_cash', action.payload.id, generalTxToRow(action.payload));
            break;
          case 'DELETE_GENERAL_TX':
            await dbDelete('general_cash', action.payload);
            break;
          default:
            break;
        }
      } catch (err) {
        fail(err, action.type.replace(/_/g, ' ').toLowerCase());
      }
    })();
  }, []);

  const reloadGeneralCash = useCallback(async () => {
    try {
      const rows = await dbSelectAll<any>('general_cash', { orderBy: 'date' });
      rawDispatch({ type: 'HYDRATE', payload: { generalCash: rows.map(rowToGeneralTx) } });
    } catch (e) {
      console.warn('[AppContext] general_cash reload', e);
    }
  }, []);

  // ── Hydratation ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const patch: Partial<AppState> = {};
      try {
        const row: any = await db.getSettings();
        if (row) {
          patch.settings = {
            name: row.name || '',
            logo: row.logo_url || undefined,
            logoUrl: row.logo_url || undefined,
            address: row.address || undefined,
            phone: row.phone || undefined,
            email: row.email || undefined,
            fiscalId: row.fiscal_id || undefined,
            rc: row.rc || undefined,
            ai: row.ai || undefined,
            nis: row.nis || undefined,
            currency: row.currency || 'DA',
            ticketFooter: row.ticket_footer || undefined,
            productCategories: row.product_categories?.length ? row.product_categories : DEFAULT_PRODUCT_CATEGORIES,
            expenseCategories: row.expense_categories?.length ? row.expense_categories : DEFAULT_EXPENSE_CATEGORIES,
            productUnits: row.product_units?.length ? row.product_units : DEFAULT_PRODUCT_UNITS,
            defaultMinQty: row.default_min_qty ?? 5,
          };
        }
      } catch (e) {
        console.warn('[AppContext] settings', e);
      }

      try {
        const rows = await dbSelectAll<any>('general_cash', { orderBy: 'date' });
        patch.generalCash = rows.map(rowToGeneralTx);
      } catch (e) {
        console.warn('[AppContext] general_cash', e);
      }

      if (cancelled) return;
      patch.isLoading = false;
      rawDispatch({ type: 'HYDRATE', payload: patch });
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Temps réel : le coffre général est partagé entre tous les postes ───────
  useEffect(() => {
    const unsub = subscribeTable('general_cash', () => { void reloadGeneralCash(); });
    const onFocus = () => { void reloadGeneralCash(); };
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, [reloadGeneralCash]);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(StateCtx);
  if (!ctx) throw new Error('useAppState must be used within <AppProvider>');
  return ctx;
}

export function useAppDispatch(): React.Dispatch<AppAction> {
  const ctx = useContext(DispatchCtx);
  if (!ctx) throw new Error('useAppDispatch must be used within <AppProvider>');
  return ctx;
}

/** Raccourci pour afficher un message sans écrire l'action à la main. */
export function useToast() {
  const dispatch = useAppDispatch();
  return useCallback(
    (type: ToastMessage['type'], title: string, message?: string, duration = 4) =>
      dispatch({ type: 'ADD_TOAST', payload: { type, title, message, duration } }),
    [dispatch],
  );
}

// ─── Permissions d'une interface de cafétéria ─────────────────────────────────
export interface BizPermission {
  voir: boolean; creer: boolean; modifier: boolean; supprimer: boolean;
}
const BIZ_ALL: BizPermission = { voir: true, creer: true, modifier: true, supprimer: true };
const BIZ_NONE: BizPermission = { voir: false, creer: false, modifier: false, supprimer: false };

/**
 * Ce que l'utilisateur connecté a le droit de faire sur UNE interface d'UNE
 * cafétéria :
 *
 *   const perm = useBizPermission(cafeteriaId, 'stock');
 *   {perm.creer && <button>Nouveau produit</button>}
 *
 * L'administrateur a tout. Un employé n'a QUE ce que l'administrateur lui a
 * coché, et uniquement dans SA cafétéria : demander la permission d'une autre
 * cafétéria rend systématiquement « rien ». C'est la garantie qu'un employé ne
 * voit jamais le stock, les ventes ou les clients d'une cafétéria voisine.
 */
export function useBizPermission(moduleKey: string, interfaceId: string): BizPermission {
  const { currentUserRole, currentModuleWorker } = useAppState();
  return useMemo(() => {
    if (currentUserRole !== 'module_worker') return BIZ_ALL;
    if (!currentModuleWorker || currentModuleWorker.moduleKey !== moduleKey) return BIZ_NONE;
    const p = currentModuleWorker.permissions || {};
    const can = (a: string) => !!p[`${interfaceId}.${a}`];
    // Les actions n'ont pas de sens sans « voir » : la page n'est pas atteignable.
    if (!can('voir')) return BIZ_NONE;
    return { voir: true, creer: can('creer'), modifier: can('modifier'), supprimer: can('supprimer') };
  }, [currentUserRole, currentModuleWorker, moduleKey, interfaceId]);
}

/**
 * Les cafétérias que l'utilisateur connecté a le droit de VOIR, filtrées à
 * partir de la liste complète. Un employé n'en garde qu'une : la sienne.
 * C'est la seule fonction à consulter avant d'afficher quoi que ce soit de
 * transversal (tableau de bord, caisse générale, rapports).
 */
export function useVisibleCafeteriaIds(allIds: string[]): string[] {
  const { currentUserRole, currentModuleWorker } = useAppState();
  return useMemo(() => {
    if (currentUserRole !== 'module_worker') return allIds;
    const mine = currentModuleWorker?.moduleKey;
    return mine && allIds.includes(mine) ? [mine] : [];
  }, [currentUserRole, currentModuleWorker, allIds]);
}

/** `true` quand l'utilisateur connecté est administrateur. */
export function useIsAdmin(): boolean {
  return useAppState().currentUserRole === 'admin';
}
