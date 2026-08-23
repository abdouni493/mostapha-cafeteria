/**
 * ─── Business Modules Store ────────────────────────────────────────────────────
 * Store des parties commerciales (Cafétéria, Lavage & Réparation), tenu à part
 * des tables carburant de `AppContext`.
 *
 *   const biz = useBiz('cafeteria');
 *   biz.state.products; biz.add('products', {...}); await biz.flush();
 *
 * ─── POURQUOI UNE CRÉATION NE PEUT PLUS SE PERDRE ──────────────────────────────
 * L'état des parties tient dans UNE ligne JSON partagée. Chaque poste en gardait
 * une copie complète et la RÉÉCRIVAIT en entier — d'où deux pertes de données
 * silencieuses, celles qui faisaient disparaître un produit tout juste créé :
 *
 *   1. AU DÉMARRAGE, la copie du serveur ÉCRASAIT la copie locale. Un produit
 *      créé puis suivi d'un rafraîchissement dans la seconde (avant que l'envoi
 *      différé ne parte) n'existait plus nulle part.
 *   2. ENTRE DEUX POSTES, le dernier qui écrivait gagnait. Le poste B
 *      enregistrait sa copie — vieille de dix minutes — et le produit créé par
 *      le poste A disparaissait.
 *   3. Une écriture refusée par le serveur était AVALÉE : l'écran affichait
 *      « Produit créé » alors que rien n'était parti.
 *
 * Ce qui les remplace :
 *   • FUSION, jamais d'écrasement — `mergeBizState` réunit les deux côtés ligne
 *     par ligne (voir `src/lib/bizSync.ts`), au démarrage comme à l'écriture ;
 *   • LIRE-FUSIONNER-ÉCRIRE à chaque enregistrement, avec un contrôle de
 *     révision côté serveur : une écriture bâtie sur un état périmé est refusée,
 *     refusionnée, puis rejouée ;
 *   • les erreurs REMONTENT — `flush()` rend la main avec le verdict du serveur,
 *     et la création de produit garde un brouillon tant qu'il n'est pas bon.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  BizState, ModuleKey, ModuleState, BizCollection, BizSession, BizProduct,
  Cafeteria, setCafeteriaRegistry, defaultCafeteria, DEFAULT_CAFETERIA_ID,
} from '../lib/bizConfig';
import { emptyBizState, EMPTY_MODULE } from '../lib/bizSeed';
import { loadBizStoreSnapshot, peekBizStoreRev, saveBizStore, subscribeTable, BizStoreSnapshot } from '../lib/supabase';
import { loadBizSessions } from '../lib/bizSessions';
import {
  loadBizProducts, saveBizProducts, deleteBizProducts, mergeRemoteProducts,
  productsMissingFromRemote, ProductRowInput,
} from '../lib/bizProducts';
import { mergeBizState, stampItem, nowIso, SyncModuleState, BizStateMeta } from '../lib/bizSync';

const STORAGE_KEY = 'altech_cafeteria_biz_v1';

/**
 * Délai avant l'envoi d'une modification (regroupe les rafales de saisie).
 *
 * Porté de 600 ms à 2,5 s : chaque envoi écrit le blob COMPLET (~560 Ko), donc
 * une vente encaissée toutes les quelques secondes déclenchait autant d'envois
 * intégraux — c'est une des causes de la saturation de la base du 2026-08-10.
 * Rien n'est risqué par l'attente : la copie locale est écrite de façon
 * synchrone dans le navigateur à chaque modification, les flux critiques
 * appellent `flush()` explicitement, et la fermeture de la page envoie ce qui
 * reste (visibilitychange / pagehide).
 */
const SAVE_DEBOUNCE_MS = 2_500;
/** Nombre de refusions autorisées quand le serveur signale un conflit. */
const MAX_CONFLICT_RETRIES = 4;

/**
 * Délai avant l'envoi des lignes PRODUIT dans leur table.
 *
 * Bien plus court que celui du blob : une ligne pèse ~800 octets, pas 665 Ko.
 * Le court délai ne sert qu'à regrouper une rafale (un encaissement qui déduit
 * cinq articles fait UNE écriture au lieu de cinq).
 */
const PRODUCT_PUSH_DEBOUNCE_MS = 500;
/** Nouvelle tentative après un échec d'écriture des produits. */
const PRODUCT_RETRY_MS = 6_000;

/** Verdict d'un enregistrement, rendu à l'appelant de `flush()`. */
export interface SaveOutcome {
  ok: boolean;
  /** Renseigné uniquement quand l'enregistrement a échoué. */
  error?: string;
}

// ─── Actions ────────────────────────────────────────────────────────────────────
/**
 * `at` — horodatage d'écriture IMPOSÉ à la ligne. Il n'existe que pour les
 * collections qui partent aussi dans leur propre table (les produits) : la ligne
 * envoyée en base et la copie gardée dans le blob doivent porter EXACTEMENT le
 * même `_upd`, sinon la fusion les croirait différentes et rejouerait l'une
 * par-dessus l'autre à chaque démarrage. Absent, l'instant courant est pris.
 */
type Action =
  | { type: 'ADD'; module: ModuleKey; coll: BizCollection; item: any; at?: string }
  | { type: 'UPDATE'; module: ModuleKey; coll: BizCollection; item: any; at?: string }
  | { type: 'DELETE'; module: ModuleKey; coll: BizCollection; id: string }
  | { type: 'SET'; module: ModuleKey; coll: BizCollection; items: any[]; at?: string }
  | { type: 'PATCH'; module: ModuleKey; patch: Partial<ModuleState> }
  /** Remplace l'état par une valeur DÉJÀ fusionnée (hydratation, conflit, pull). */
  | { type: 'REPLACE'; state: BizState }
  | { type: 'SET_SESSIONS'; sessions: Record<ModuleKey, BizSession[]> }
  /** Cree une cafeteria : registre + partie vide, en une seule ecriture. */
  | { type: 'CAFETERIA_ADD'; cafeteria: Cafeteria }
  | { type: 'CAFETERIA_UPDATE'; cafeteria: Cafeteria }
  | { type: 'CAFETERIA_DELETE'; id: ModuleKey }
  | { type: 'RESET' };

/** L'etat d'une cafeteria, jamais `undefined` : une cle neuve part de vide. */
function moduleOf(state: BizState, key: ModuleKey): SyncModuleState {
  return (state.modules[key] || EMPTY_MODULE()) as SyncModuleState;
}

/** Remplace l'etat d'UNE cafeteria sans toucher aux autres ni au registre. */
function withModule(state: BizState, key: ModuleKey, mod: any): BizState {
  return { ...state, modules: { ...state.modules, [key]: mod } };
}

function reducer(state: BizState, action: Action): BizState {
  switch (action.type) {
    /**
     * Toute écriture locale est HORODATÉE : c'est cet horodatage qui permet à la
     * fusion de savoir quelle version d'une ligne est la plus récente, et donc
     * de ne jamais écraser une création par une copie plus ancienne.
     */
    case 'ADD': {
      const mod = moduleOf(state, action.module);
      const item = stampItem(action.item, action.at);
      // Un identifiant recree ne doit plus etre considere comme supprime.
      const { [action.item.id]: _removed, ...deletedIds } = mod.deletedIds || {};
      return withModule(state, action.module, {
        ...mod,
        deletedIds,
        [action.coll]: [item, ...(mod[action.coll] as any[])],
      });
    }
    case 'UPDATE': {
      const mod = moduleOf(state, action.module);
      const item = stampItem(action.item, action.at);
      return withModule(state, action.module, {
        ...mod,
        [action.coll]: (mod[action.coll] as any[]).map(x => (x.id === item.id ? item : x)),
      });
    }
    /**
     * Une suppression laisse une PIERRE TOMBALE : sans elle, la fusion avec la
     * copie du serveur ferait revenir la ligne au prochain démarrage.
     */
    case 'DELETE': {
      const mod = moduleOf(state, action.module);
      return withModule(state, action.module, {
        ...mod,
        deletedIds: { ...(mod.deletedIds || {}), [action.id]: nowIso() },
        [action.coll]: (mod[action.coll] as any[]).filter(x => x.id !== action.id),
      });
    }
    case 'SET': {
      const mod = moduleOf(state, action.module);
      const at = action.at || nowIso();
      return withModule(state, action.module, { ...mod, [action.coll]: action.items.map(x => stampItem(x, at)) });
    }
    case 'PATCH': {
      const mod = moduleOf(state, action.module);
      const patch: any = { ...action.patch };
      // Ces reglages ne sont pas des listes d'entites : ils se departagent sur
      // leur propre horodatage (voir `mergeModuleState`).
      if ('posPinned' in patch) patch.posPinnedUpd = nowIso();
      if ('avgCostEnabled' in patch) patch.avgCostEnabledUpd = nowIso();
      return withModule(state, action.module, { ...mod, ...patch });
    }
    case 'REPLACE':
      return action.state;
    /**
     * Les sessions de travail viennent de leur propre table Supabase, jamais du
     * blob JSON : la copie du serveur fait foi, et une session créée localement
     * qui n'a pas encore atteint la table (hors ligne) est conservée derrière
     * elle pour que rien ne soit perdu.
     */
    case 'SET_SESSIONS': {
      const modules = { ...state.modules };
      let changed = false;
      Object.keys(state.modules).forEach(key => {
        const remote = action.sessions[key] || [];
        const known = new Set(remote.map(x => x.id));
        const localOnly = (state.modules[key]?.sessions || []).filter(x => !known.has(x.id));
        const merged = [...remote, ...localOnly]
          .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
        if (sessionsSignature(merged) === sessionsSignature(state.modules[key]?.sessions || [])) return;
        changed = true;
        modules[key] = { ...state.modules[key], sessions: merged };
      });
      // Rien de neuf : rendre le MEME etat evite un re-enregistrement inutile.
      return changed ? { ...state, modules } : state;
    }

    /**
     * --- LE REGISTRE DES CAFETERIAS -----------------------------------------
     * Creer une cafeteria, c'est DEUX choses en une seule ecriture : la fiche
     * dans le registre et sa partie vide dans `modules`. Les separer laisserait
     * une fenetre ou la barre laterale affiche une cafeteria dont l'etat
     * n'existe pas encore, et chaque page ferait un rendu a blanc.
     */
    case 'CAFETERIA_ADD': {
      const caf = stampItem(action.cafeteria);
      if (state.cafeterias.some(c => c.id === caf.id)) return state;
      const meta = state as BizStateMeta;
      const { [caf.id]: _revived, ...deletedCafeterias } = meta.deletedCafeterias || {};
      return {
        ...state,
        deletedCafeterias,
        cafeterias: [...state.cafeterias, caf],
        modules: { ...state.modules, [caf.id]: state.modules[caf.id] || EMPTY_MODULE() },
      } as BizState;
    }
    case 'CAFETERIA_UPDATE': {
      const caf = stampItem(action.cafeteria);
      return {
        ...state,
        cafeterias: state.cafeterias.map(c => (c.id === caf.id ? { ...c, ...caf } : c)),
      };
    }
    /**
     * Supprimer une cafeteria emporte ses donnees ET pose une pierre tombale :
     * sans elle, la fusion avec la copie d'un autre poste la ferait revenir au
     * prochain demarrage. La toute derniere cafeteria n'est jamais supprimable,
     * une application sans cafeteria n'ayant plus rien a afficher.
     */
    case 'CAFETERIA_DELETE': {
      if (state.cafeterias.length <= 1) return state;
      const meta = state as BizStateMeta;
      const { [action.id]: _gone, ...modules } = state.modules;
      return {
        ...state,
        deletedCafeterias: { ...(meta.deletedCafeterias || {}), [action.id]: nowIso() },
        cafeterias: state.cafeterias.filter(c => c.id !== action.id),
        modules,
      } as BizState;
    }
    case 'RESET':
      return emptyBizState();
    default:
      return state;
  }
}

/** Empreinte d'une liste de sessions — sert à repérer un rafraîchissement à vide. */
function sessionsSignature(list: BizSession[]): string {
  return list.map(s => `${s.id}|${s.status}|${s.closedAt || ''}|${s.closingCash ?? ''}`).join(';');
}

/**
 * Verifie qu'un etat a bien la forme attendue : un registre et des parties.
 */
function isValidState(v: any): v is BizState {
  return !!v && Array.isArray(v.cafeterias) && !!v.modules && typeof v.modules === 'object';
}

/** Collections d'une ancienne partie reprises telles quelles. */
const KEPT_COLLECTIONS: BizCollection[] = [
  'categories', 'marques', 'roles', 'products', 'purchases', 'sales',
  'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'productions',
  'fiches', 'comptoir', 'destructions', 'sessions', 'inventaires',
];

/**
 * --- LA REPRISE D'UN ETAT ENREGISTRE PAR UNE VERSION PRECEDENTE --------------
 *
 * L'application etait un logiciel de station-service a deux parties figees
 * (`cafeteria`, `lavage`) posees a la racine de l'etat. Elle est devenue un
 * logiciel de cafeterias, ou chaque cafeteria est une cle DYNAMIQUE sous
 * `modules`, et ou le registre `cafeterias` dit lesquelles existent.
 *
 * Cette fonction fait passer l'ancien etat dans le nouveau SANS RIEN PERDRE :
 *   - l'ancienne partie `cafeteria` devient la premiere cafeteria du registre ;
 *   - la partie `lavage` et tout ce qui n'est plus gere sont abandonnes, avec
 *     leurs collections propres (interventions, rappels, encaissements) ;
 *   - un etat deja au nouveau format traverse la fonction sans etre touche.
 *
 * Elle est ecrite pour etre IDEMPOTENTE : elle tourne a chaque lecture du blob
 * et a chaque fusion, elle ne doit donc jamais rejouer une conversion deja
 * faite.
 */
function migrate(raw: any): BizState | null {
  if (!raw || typeof raw !== 'object') return null;

  // Deja au nouveau format : on se contente de completer les trous.
  const looksNew = Array.isArray(raw.cafeterias) && raw.modules && typeof raw.modules === 'object';

  const cafeterias: Cafeteria[] = looksNew ? [...raw.cafeterias] : [];
  const modules: Record<string, any> = looksNew ? { ...raw.modules } : {};

  if (!looksNew) {
    // Ancien format : la partie `cafeteria` de la racine devient la premiere.
    const legacy = raw.cafeteria;
    cafeterias.push(defaultCafeteria());
    modules[DEFAULT_CAFETERIA_ID] = legacy && typeof legacy === 'object' ? legacy : EMPTY_MODULE();
  }

  // Le registre ne peut pas etre vide : l'application n'aurait plus rien a
  // afficher, et aucune page ne saurait ou ecrire.
  if (!cafeterias.length) cafeterias.push(defaultCafeteria());

  for (const caf of cafeterias) {
    const mod = modules[caf.id] || EMPTY_MODULE();
    const base: any = EMPTY_MODULE();
    // Chaque collection du modele courant doit exister, meme vide : les pages
    // lisent ces tableaux sans les tester.
    for (const k of Object.keys(base)) {
      if (Array.isArray(base[k]) && !Array.isArray(mod[k])) mod[k] = base[k];
    }
    if (!mod.deletedIds || typeof mod.deletedIds !== 'object') mod.deletedIds = {};
    // Collections des activites retirees : elles ne servent plus a rien et
    // alourdiraient la ligne partagee a chaque enregistrement.
    for (const gone of ['reparations', 'payRequests', 'messageTemplates', 'rappels', 'services']) {
      if (gone in mod) delete mod[gone];
    }
    // Les employes ont perdu la paie au pourcentage (propre au lavage) : un
    // ancien employe paye ainsi repasse au mois, sinon son salaire vaudrait 0.
    if (Array.isArray(mod.workers)) {
      mod.workers = mod.workers.map((w: any) => (
        w?.salaryType === 'pourcentage'
          ? { ...w, salaryType: 'mois', workerKind: undefined }
          : (w?.workerKind ? { ...w, workerKind: undefined } : w)
      ));
    }
    modules[caf.id] = mod;
  }

  // Une partie sans fiche au registre n'est plus atteignable : on la laisse
  // tomber plutot que de la trainer indefiniment.
  const known = new Set(cafeterias.map(c => c.id));
  for (const key of Object.keys(modules)) if (!known.has(key)) delete modules[key];

  const out: any = { cafeterias, modules };
  if (raw.deletedCafeterias && typeof raw.deletedCafeterias === 'object') {
    out.deletedCafeterias = raw.deletedCafeterias;
  }
  return isValidState(out) ? (out as BizState) : null;
}

function loadInitial(): BizState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const migrated = migrate(JSON.parse(raw));
      if (migrated) return migrated;
    }
  } catch { /* ignore corrupt storage */ }
  return emptyBizState();
}

// ─── Context ─────────────────────────────────────────────────────────────────────
/** Ce que l'application peut savoir de l'état de la synchronisation. */
export interface BizSyncState {
  /** Un enregistrement est en cours. */
  saving: boolean;
  /** Des modifications locales ne sont pas encore confirmées par le serveur. */
  pending: boolean;
  /** Dernier échec d'enregistrement (null quand tout va bien). */
  error: string | null;
  /** Dernière confirmation reçue du serveur. */
  lastSavedAt: string | null;
}

/**
 * État d'écriture du CATALOGUE, qui ne passe plus par le blob mais par sa propre
 * table (`biz_products`). C'est lui qui dit si un produit est réellement en
 * base — donc si son brouillon peut être effacé.
 */
export interface BizProductsSync {
  /** Une écriture de produit est en cours. */
  saving: boolean;
  /** Produits dont l'écriture n'est pas encore confirmée par la base. */
  pending: ReadonlySet<string>;
  /** Dernier échec d'écriture (null quand tout va bien). */
  error: string | null;
  /**
   * `false` quand la table n'existe pas encore (migration non passée) : tout
   * repasse alors par le blob, exactement comme avant.
   */
  relational: boolean;
}

const NO_PENDING: ReadonlySet<string> = new Set();

interface BizContextValue {
  state: BizState;
  dispatch: React.Dispatch<Action>;
  /** Enregistre tout de suite et rend le verdict du serveur. */
  flush: () => Promise<SaveOutcome>;
  /** Attend qu'une écriture ait bien été prise en compte par le rendu. */
  waitFor: (predicate: (s: BizState) => boolean, timeoutMs?: number) => Promise<boolean>;
  sync: BizSyncState;
  /** Écrit une fiche produit DANS SA TABLE et attend le verdict de la base. */
  confirmProduct: (module: ModuleKey, product: BizProduct, mode: 'add' | 'update') => Promise<SaveOutcome>;
  productsSync: BizProductsSync;
  /** Cree / renomme / supprime une cafeteria, et attend le verdict serveur. */
  cafeteriaOps: CafeteriaOps;
}

/**
 * Les operations du registre. Elles ATTENDENT toutes le verdict du serveur :
 * une cafeteria qui n'existerait que dans ce navigateur laisserait un employe
 * affecte a une partie que personne d'autre ne voit.
 */
export interface CafeteriaOps {
  create: (cafeteria: Cafeteria) => Promise<SaveOutcome>;
  update: (cafeteria: Cafeteria) => Promise<SaveOutcome>;
  remove: (id: ModuleKey) => Promise<SaveOutcome>;
}
const Ctx = createContext<BizContextValue | null>(null);

export function BizProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const initial = loadInitial();
    // Le registre alimente `MODULES`, lu de facon SYNCHRONE au beau milieu
    // des rendus. Le publier ici, avant le premier d'entre eux, evite que la
    // barre laterale et les titres affichent une passe avec la cafeteria de
    // repli avant de se corriger.
    setCafeteriaRegistry(initial.cafeterias);
    return initial;
  });
  const [sync, setSync] = useState<BizSyncState>({
    saving: false, pending: false, error: null, lastSavedAt: null,
  });
  /** Même chose, lisible sans re-créer les fonctions à chaque changement. */
  const syncRef = useRef(sync);
  const applySync = useCallback((patch: Partial<BizSyncState>) => {
    syncRef.current = { ...syncRef.current, ...patch };
    setSync(syncRef.current);
  }, []);

  /** État courant, lisible depuis du code asynchrone sans dépendre du rendu. */
  const stateRef = useRef(state);
  /**
   * DERNIER état dont le serveur a accusé réception, par RÉFÉRENCE. Tant que
   * `stateRef.current` pointe ailleurs, il reste du travail à envoyer — c'est
   * tout le mécanisme « y a-t-il quelque chose à enregistrer ? ».
   */
  const lastSavedRef = useRef<BizState | null>(null);
  /** Révision de la ligne partagée, pour que le serveur refuse une écriture périmée. */
  const revRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);
  const savingRef = useRef<Promise<SaveOutcome> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last snapshot read from `biz_sessions`, re-applied after any blob hydrate so
  // the shared JSON never resurrects a stale session of another employee.
  const sessionsRef = useRef<Record<ModuleKey, BizSession[]> | null>(null);

  // ── Enregistrement : FUSIONNER (si besoin) → ÉCRIRE ───────────────────────
  /**
   * Envoie l'état au serveur sans jamais écraser le travail de quelqu'un
   * d'autre. Le garde-fou est la RÉVISION : le serveur refuse toute écriture
   * bâtie sur une version périmée et REND alors sa version, qu'on fusionne
   * avant de rejouer.
   *
   * L'ancienne version relisait le blob COMPLET avant chaque envoi « pour
   * fusionner d'abord » — c'était redondant avec ce contrôle serveur, et c'est
   * ce qui a doublé la charge pendant l'incident du 2026-08-10 (~560 Ko lus
   * puis ~560 Ko écrits à chaque enregistrement, toutes les quelques secondes
   * en pleine activité du point de vente). Tant que la révision locale est
   * connue, on écrit DIRECTEMENT ; la lecture préalable ne subsiste que pour
   * le tout premier envoi et pour les bases sans la colonne `rev`.
   */
  const pushNow = useCallback(async (): Promise<SaveOutcome> => {
    // Version du serveur à fusionner avant d'écrire — connue sans lecture
    // supplémentaire quand elle vient d'un refus de révision.
    let remoteSnapshot: BizStoreSnapshot | null =
      revRef.current === null ? await loadBizStoreSnapshot() : null;

    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const remote = remoteSnapshot?.state ? migrate(remoteSnapshot.state) : null;

      // Entre cette fusion et le dispatch : aucun `await`, donc aucune
      // écriture de l'utilisateur ne peut se glisser et être perdue.
      const candidate = remote ? mergeBizState(stateRef.current, remote) : stateRef.current;
      if (candidate !== stateRef.current) {
        stateRef.current = candidate;
        dispatch({ type: 'REPLACE', state: candidate });
      }

      const result = await saveBizStore(candidate, remoteSnapshot?.rev ?? revRef.current);

      if (result.ok) {
        revRef.current = result.rev ?? null;
        lastSavedRef.current = candidate;
        return { ok: true };
      }
      if (result.conflict) {
        // Quelqu'un a écrit pendant notre envoi : sa version est DANS la
        // réponse du serveur — on la fusionne et on rejoue, sans relire.
        remoteSnapshot = result.remote ?? null;
        revRef.current = result.remote?.rev ?? null;
        continue;
      }
      return { ok: false, error: result.error || 'Enregistrement impossible' };
    }
    return { ok: false, error: 'Conflit persistant avec un autre poste — nouvel essai automatique' };
  }, []);

  /** Envoi différé — reprogrammé tant que la saisie continue. */
  const runSaveRef = useRef<() => Promise<SaveOutcome>>(async () => ({ ok: true }));
  const scheduleSave = useCallback((delay = SAVE_DEBOUNCE_MS) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void runSaveRef.current(); }, delay);
  }, []);

  /** Un seul envoi à la fois ; les appels concurrents attendent le même. */
  const flush = useCallback(async (): Promise<SaveOutcome> => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }

    if (savingRef.current) {
      await savingRef.current.catch(() => undefined);
      // L'envoi précédent emportait peut-être déjà notre modification.
      if (stateRef.current === lastSavedRef.current) {
        const err = syncRef.current.error;
        return err ? { ok: false, error: err } : { ok: true };
      }
    }
    if (stateRef.current === lastSavedRef.current && !syncRef.current.error) return { ok: true };

    applySync({ saving: true });
    const run = pushNow();
    savingRef.current = run;
    let outcome: SaveOutcome;
    try { outcome = await run; } finally { savingRef.current = null; }

    applySync({
      saving: false,
      pending: stateRef.current !== lastSavedRef.current,
      error: outcome.ok ? null : outcome.error,
      ...(outcome.ok ? { lastSavedAt: nowIso() } : {}),
    });

    // De nouvelles modifications sont arrivées pendant l'envoi, ou l'envoi a
    // échoué : on repasse plus tard, l'utilisateur n'a rien à faire.
    if (stateRef.current !== lastSavedRef.current) scheduleSave(outcome.ok ? SAVE_DEBOUNCE_MS : 5_000);
    return outcome;
  }, [pushNow, applySync, scheduleSave]);

  useEffect(() => { runSaveRef.current = flush; }, [flush]);

  /**
   * Attend qu'une écriture soit passée par le rendu avant d'enregistrer.
   * `dispatch` ne met pas `stateRef` à jour tout de suite : sans cette attente,
   * un « créer puis confirmer » enverrait l'état d'AVANT la création et
   * annoncerait un succès qui ne couvre pas le produit.
   */
  const waitFor = useCallback((predicate: (s: BizState) => boolean, timeoutMs = 3_000) => (
    new Promise<boolean>(resolve => {
      const started = Date.now();
      const tick = () => {
        if (predicate(stateRef.current)) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(tick, 25);
      };
      tick();
    })
  ), []);

  // ── LE CATALOGUE : une ligne par produit, écrite dans sa propre table ──────
  /**
   * POURQUOI LES PRODUITS SORTENT DU BLOB
   * Le blob pèse 665 Ko (dont 567 Ko de ventes) et part EN ENTIER à chaque
   * modification. Créer un produit de 800 octets envoyait donc 665 Ko : au-delà
   * de huit secondes la requête était abandonnée et l'écran annonçait « Le
   * serveur refuse les enregistrements » alors que la base allait très bien.
   *
   * Une fiche produit part maintenant seule, dans `biz_products`. Le blob garde
   * sa copie (sauvegarde, restauration, postes non migrés), mais il ne décide
   * plus de rien : c'est la ligne qui fait foi, et c'est son verdict qui efface
   * — ou non — le brouillon.
   */
  const productQueue = useRef(new Map<string, { module: ModuleKey; product: BizProduct | null }>());
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productFlight = useRef<Promise<SaveOutcome> | null>(null);
  const runProductPushRef = useRef<() => Promise<SaveOutcome>>(async () => ({ ok: true }));

  const [productsSync, setProductsSync] = useState<BizProductsSync>({
    saving: false, pending: NO_PENDING, error: null, relational: true,
  });
  const productsSyncRef = useRef(productsSync);
  const applyProductsSync = useCallback((patch: Partial<BizProductsSync>) => {
    productsSyncRef.current = { ...productsSyncRef.current, ...patch };
    setProductsSync(productsSyncRef.current);
  }, []);

  /** Publie la liste des fiches encore en attente — c'est elle que lisent les brouillons. */
  const publishPending = useCallback(() => {
    const ids = new Set(productQueue.current.keys());
    const prev = productsSyncRef.current.pending;
    if (prev.size === ids.size && [...ids].every(id => prev.has(id))) return;
    applyProductsSync({ pending: ids });
  }, [applyProductsSync]);

  const scheduleProductPush = useCallback((delay = PRODUCT_PUSH_DEBOUNCE_MS) => {
    if (productTimer.current) clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => {
      productTimer.current = null;
      void runProductPushRef.current();
    }, delay);
  }, []);

  /** Met une fiche (ou sa suppression, `product` à `null`) dans la file d'envoi. */
  const queueProduct = useCallback((module: ModuleKey, id: string, product: BizProduct | null) => {
    if (!productsSyncRef.current.relational || !id) return;
    productQueue.current.set(id, { module, product });
    publishPending();
    scheduleProductPush();
  }, [publishPending, scheduleProductPush]);

  /** Vide la file vers la base. Rend le verdict — c'est lui qui compte. */
  const pushProductsNow = useCallback(async (): Promise<SaveOutcome> => {
    const batch = [...productQueue.current.entries()];
    if (!batch.length) return { ok: true };

    const upserts: ProductRowInput[] = [];
    const deletes: string[] = [];
    for (const [id, entry] of batch) {
      if (entry.product) upserts.push({ module: entry.module, product: entry.product });
      else deletes.push(id);
    }

    applyProductsSync({ saving: true });
    // Les deux passent toujours : une suppression n'a pas à attendre qu'une
    // création se règle, et inversement.
    const written = await saveBizProducts(upserts);
    const removed = await deleteBizProducts(deletes);

    // Migration non passée : le blob reprend seul le travail, comme avant. Rien
    // n'est perdu — il porte la même copie des produits.
    if (written.missingTable || removed.missingTable) {
      productQueue.current.clear();
      applyProductsSync({ saving: false, relational: false, pending: NO_PENDING, error: null });
      return { ok: true };
    }

    // Ce qui est passé quitte la file ; ce qui a été refusé y reste et sera
    // réessayé. Une fiche RÉÉCRITE pendant l'envoi porte une autre entrée : elle
    // reste elle aussi, sinon la dernière saisie serait tenue pour enregistrée.
    const failed = new Set([...(written.failedIds || []), ...(removed.failedIds || [])]);
    for (const [id, entry] of batch) {
      if (failed.has(id)) continue;
      if (productQueue.current.get(id) === entry) productQueue.current.delete(id);
    }
    publishPending();

    if (!failed.size) {
      applyProductsSync({ saving: false, error: null });
      return { ok: true };
    }

    const error = written.error || removed.error || 'Enregistrement du produit impossible';
    applyProductsSync({ saving: false, error });
    scheduleProductPush(PRODUCT_RETRY_MS);
    return { ok: false, error };
  }, [applyProductsSync, publishPending, scheduleProductPush]);

  /** Un seul envoi de produits à la fois ; les appels concurrents attendent le même. */
  const flushProducts = useCallback(async (): Promise<SaveOutcome> => {
    if (productTimer.current) { clearTimeout(productTimer.current); productTimer.current = null; }
    if (productFlight.current) await productFlight.current.catch(() => undefined);
    if (!productQueue.current.size) {
      const err = productsSyncRef.current.error;
      return err ? { ok: false, error: err } : { ok: true };
    }
    const run = pushProductsNow();
    productFlight.current = run;
    try { return await run; } finally { productFlight.current = null; }
  }, [pushProductsNow]);

  useEffect(() => { runProductPushRef.current = flushProducts; }, [flushProducts]);

  /**
   * Applique le catalogue de la base par-dessus l'état courant. Quand rien
   * n'attendait d'être envoyé, l'état reste PROPRE : sans cela, la moindre
   * modification de produit faite sur un autre poste déclencherait ici un
   * réenregistrement complet du blob.
   */
  const applyRemoteCatalogue = useCallback((remote: Record<ModuleKey, BizProduct[]>) => {
    const wasClean = stateRef.current === lastSavedRef.current;
    const next = mergeRemoteProducts(stateRef.current, remote);
    if (next === stateRef.current) return;
    stateRef.current = next;
    dispatch({ type: 'REPLACE', state: next });
    if (wasClean) lastSavedRef.current = next;
  }, []);

  /**
   * Toute écriture de l'application passe par ici. Un produit part EN PLUS dans
   * sa table, avec EXACTEMENT l'horodatage que porte la copie du blob (`at`) —
   * deux horodatages différents feraient croire à la fusion que les deux copies
   * divergent, et l'une réécrirait l'autre à chaque démarrage.
   */
  const dispatchSync = useCallback((action: Action) => {
    if ((action.type === 'ADD' || action.type === 'UPDATE') && action.coll === 'products' && action.item?.id) {
      const at = nowIso();
      const item = stampItem(action.item, at) as BizProduct;
      queueProduct(action.module, item.id, item);
      dispatch({ ...action, item, at });
      return;
    }
    if (action.type === 'DELETE' && action.coll === 'products') {
      queueProduct(action.module, action.id, null);
    }
    if (action.type === 'SET' && action.coll === 'products') {
      const at = nowIso();
      const items = action.items.map(x => stampItem(x, at)) as BizProduct[];
      const kept = new Set(items.map(p => p?.id));
      for (const gone of ((stateRef.current.modules[action.module]?.products || []) as BizProduct[])) {
        if (!kept.has(gone.id)) queueProduct(action.module, gone.id, null);
      }
      for (const p of items) if (p?.id) queueProduct(action.module, p.id, p);
      dispatch({ ...action, items, at });
      return;
    }
    dispatch(action);
  }, [queueProduct]);

  /**
   * Écrit une fiche produit et NE REND LA MAIN QU'AVEC LE VERDICT DE LA BASE.
   * L'appelant (création, modification, renvoi d'un brouillon) sait donc, à coup
   * sûr, si la ligne existe côté serveur — et garde le brouillon sinon.
   */
  const confirmProduct = useCallback(async (
    module: ModuleKey, product: BizProduct, mode: 'add' | 'update',
  ): Promise<SaveOutcome> => {
    dispatchSync({ type: mode === 'add' ? 'ADD' : 'UPDATE', module, coll: 'products', item: product });
    // La fiche doit être passée par le rendu avant qu'on annonce quoi que ce soit.
    await waitFor(s => ((s.modules[module]?.products || []) as BizProduct[]).some(p => p?.id === product.id));

    // Table absente (migration non passée) : le blob décide, comme avant.
    if (!productsSyncRef.current.relational) return flush();

    await flushProducts();
    // La table s'est révélée absente pendant l'envoi : le blob reprend la main,
    // et c'est LUI qui doit alors confirmer — sinon on annoncerait un
    // enregistrement que personne n'a fait.
    if (!productsSyncRef.current.relational) return flush();

    // La copie du blob suit, sans que l'utilisateur ait à l'attendre.
    scheduleSave();

    // Le verdict porte sur CETTE fiche : elle a quitté la file, donc la base
    // l'a acceptée. L'échec d'une autre ligne ne doit pas retenir son brouillon.
    if (!productQueue.current.has(product.id)) return { ok: true };
    return { ok: false, error: productsSyncRef.current.error || 'Enregistrement du produit impossible' };
  }, [dispatchSync, waitFor, flush, flushProducts, scheduleSave]);

  /** Re-reads the sessions table (one row per session, per employee). */
  const syncSessions = useCallback(async () => {
    const remote = await loadBizSessions();
    if (!remote) return;   // table absente (migration non passée) — le blob suffit
    sessionsRef.current = remote;
    dispatch({ type: 'SET_SESSIONS', sessions: remote });
  }, []);

  /**
   * Récupère la version du serveur et la FUSIONNE dans l'état local — jamais
   * l'inverse. Quand rien n'attendait d'être envoyé, le résultat est déjà ce que
   * le serveur contient : on l'enregistre comme tel pour ne pas déclencher un
   * ré-envoi en boucle à chaque notification temps réel.
   *
   * `announcedRev` est la révision annoncée par la notification (ligne
   * `biz_store_meta`). Quand c'est celle qu'on connaît déjà — typiquement
   * l'écho de NOTRE propre enregistrement — il n'y a rien à télécharger :
   * c'est ce test qui évite de faire redescendre le blob complet vers chaque
   * poste après chaque écriture.
   */
  const pull = useCallback(async (announcedRev?: number) => {
    if (typeof announcedRev === 'number' && announcedRev === revRef.current) return;
    const snapshot = await loadBizStoreSnapshot();
    if (!snapshot) return;
    const remote = snapshot.state ? migrate(snapshot.state) : null;
    revRef.current = snapshot.rev;
    if (!remote) return;

    const wasClean = stateRef.current === lastSavedRef.current;
    const merged = mergeBizState(stateRef.current, remote);
    stateRef.current = merged;
    dispatch({ type: 'REPLACE', state: merged });
    if (wasClean) lastSavedRef.current = merged;
    if (sessionsRef.current) dispatch({ type: 'SET_SESSIONS', sessions: sessionsRef.current });
  }, []);

  // Premier chargement — la copie du serveur est FUSIONNÉE dans la copie locale,
  // jamais substituée : ce qui a été saisi ici et n'est pas encore parti (produit
  // créé juste avant un rafraîchissement, poste hors ligne) survit et repart.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Le blob et le catalogue sont lus EN MÊME TEMPS : ce sont deux sources
      // indépendantes, et l'ouverture ne doit pas coûter deux allers-retours.
      const [snapshot, catalogue] = await Promise.all([loadBizStoreSnapshot(), loadBizProducts()]);
      if (cancelled) return;
      revRef.current = snapshot?.rev ?? null;
      const remote = snapshot?.state ? migrate(snapshot.state) : null;

      let merged = remote ? mergeBizState(stateRef.current, remote) : stateRef.current;
      // Le catalogue de la base s'applique PAR-DESSUS : depuis que les produits
      // ont leur propre table, c'est elle qui fait autorité. Une lecture EN
      // ÉCHEC ne conclut rien (surtout pas « le catalogue est vide ») : on garde
      // ce qu'on a et les écritures suivantes réessaieront.
      if (catalogue.status === 'ok') merged = mergeRemoteProducts(merged, catalogue.products);
      if (catalogue.status === 'missing') applyProductsSync({ relational: false });

      if (merged !== stateRef.current) {
        stateRef.current = merged;
        dispatch({ type: 'REPLACE', state: merged });
      }
      if (remote) {
        // La copie locale n'apportait RIEN que le serveur n'ait déjà : l'état
        // est propre, et le flush() de démarrage ci-dessous ne renverra pas le
        // blob complet pour rien. Chaque ouverture de l'application coûtait
        // cette écriture intégrale (~560 Ko) même sans aucun travail hors
        // ligne à rattraper. La comparaison est textuelle : au moindre doute
        // (ordre différent, clé en plus) elle échoue et l'envoi a lieu —
        // c'est-à-dire l'ancien comportement, jamais moins sûr.
        try {
          if (JSON.stringify(merged) === JSON.stringify(remote)) lastSavedRef.current = merged;
        } catch { /* état non sérialisable : on renvoie, comme avant */ }
      }

      // RATTRAPAGE : les fiches que ce poste a et que la base n'a pas (créées
      // pendant une panne réseau, ou juste avant la fermeture du navigateur)
      // repartent d'elles-mêmes, sans que personne ait à cliquer.
      if (catalogue.status === 'ok') {
        for (const row of productsMissingFromRemote(merged, catalogue.products)) {
          queueProduct(row.module, row.product.id, row.product);
        }
      }

      // The blob may carry an old copy of the sessions: the table wins.
      if (sessionsRef.current) dispatch({ type: 'SET_SESSIONS', sessions: sessionsRef.current });
      hydratedRef.current = true;
      // Tout ce que le local avait en plus part maintenant vers le serveur.
      scheduleSave(0);
      syncSessions();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Catalogue partagé — un produit créé ou réapprovisionné sur un autre poste
  // arrive ici sans rechargement, et sans faire redescendre le blob complet.
  //
  // Une SUPPRESSION n'est pas appliquée depuis cet évènement : c'est la pierre
  // tombale du blob qui la porte (elle seule empêche la ligne de revenir à la
  // fusion suivante), et elle arrive par la notification de révision.
  useEffect(() => {
    const onRow = (payload: { new: unknown }) => {
      const row = payload.new as { id?: string; module_key?: string; data?: BizProduct } | null;
      if (!hydratedRef.current || !row?.id || !row?.data) return;
      const key = row.module_key as ModuleKey;
      // Cle inconnue de ce poste (cafeteria creee ailleurs et pas encore
      // recue) : la ligne arrivera avec le registre, il n'y a rien a fusionner.
      if (!key || !stateRef.current.modules[key]) return;
      applyRemoteCatalogue({ [key]: [{ ...row.data, id: row.id }] } as Record<ModuleKey, BizProduct[]>);
    };
    const unsub = subscribeTable('biz_products', onRow);
    // Filet quand le websocket est bloqué (réseau d'entreprise) : au retour sur
    // l'onglet, on relit le catalogue — quelques dizaines de kilo-octets.
    const onFocus = async () => {
      if (!hydratedRef.current || !productsSyncRef.current.relational) return;
      const res = await loadBizProducts();
      if (res.status === 'ok') applyRemoteCatalogue(res.products);
      else if (res.status === 'missing') applyProductsSync({ relational: false });
    };
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, [applyRemoteCatalogue, applyProductsSync]);

  // Sessions de travail — chaque poste voit en direct l'ouverture / la clôture
  // des autres employés sans jamais écraser leurs lignes.
  useEffect(() => {
    const unsub = subscribeTable('biz_sessions', () => { syncSessions(); });
    // Filet quand le websocket est bloqué (réseau d'entreprise) : au retour sur
    // l'onglet, on relit la table.
    const onFocus = () => { syncSessions(); };
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, [syncSessions]);

  // État partagé — un produit créé sur un autre poste apparaît ici sans
  // rechargement, et le retour sur l'onglet sert de filet quand le temps réel
  // est bloqué par le réseau.
  //
  // La notification vient de `biz_store_meta` (id + rev, quelques octets) : le
  // blob lui-même n'est plus publié en temps réel. L'abonnement historique à
  // `biz_store` est conservé pour les bases où la migration
  // 2026-08-10_fast_role_lookup_and_light_biz_sync.sql n'est pas encore
  // passée — il ne reçoit simplement plus rien ensuite. Dans les deux cas la
  // révision annoncée filtre les échos de nos propres enregistrements.
  useEffect(() => {
    const onChange = (payload: { new: unknown }) => {
      if (!hydratedRef.current) return;
      const rev = (payload.new as { rev?: unknown } | null)?.rev;
      pull(typeof rev === 'number' ? rev : undefined);
    };
    const unsubMeta = subscribeTable('biz_store_meta', onChange);
    const unsubLegacy = subscribeTable('biz_store', onChange);
    // Retour sur l'onglet : un coup d'œil à la révision seule suffit à savoir
    // s'il faut retélécharger — le filet reste, mais il est devenu léger.
    const onFocus = async () => {
      if (!hydratedRef.current) return;
      const rev = await peekBizStoreRev();
      pull(rev ?? undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => { unsubMeta(); unsubLegacy(); window.removeEventListener('focus', onFocus); };
  }, [pull]);

  // Fermeture / rafraîchissement de la page : dernière chance d'envoyer. Même si
  // la requête n'a pas le temps de partir, la copie locale est complète et sera
  // fusionnée au prochain démarrage — rien n'est perdu.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      if (productQueue.current.size) void runProductPushRef.current();
      if (stateRef.current !== lastSavedRef.current) void runSaveRef.current();
    };
    const onPageHide = () => {
      if (productQueue.current.size) void runProductPushRef.current();
      if (stateRef.current !== lastSavedRef.current) void runSaveRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Le registre suit l'etat : une cafeteria creee, renommee ou supprimee
  // change ce que `MODULES` repond partout dans l'application.
  useEffect(() => { setCafeteriaRegistry(state.cafeterias); }, [state.cafeterias]);

  // Toute modification est d'abord écrite dans le navigateur — de façon
  // synchrone — puis programmée pour le serveur.
  useEffect(() => {
    stateRef.current = state;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }

    if (!hydratedRef.current) return;
    if (state === lastSavedRef.current) return;   // rien de neuf à envoyer
    if (!syncRef.current.pending) applySync({ pending: true });
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (productTimer.current) clearTimeout(productTimer.current);
  }, []);

  /**
   * Les ecritures du registre passent par le meme chemin que les autres :
   * dispatch, attente du rendu, puis `flush()` qui rend le verdict du
   * serveur. Sans l'attente, `flush()` enverrait l'etat d'AVANT la creation
   * et annoncerait un succes qui ne couvre pas la nouvelle cafeteria.
   */
  const cafeteriaOps = useMemo<CafeteriaOps>(() => ({
    create: async (cafeteria) => {
      dispatch({ type: 'CAFETERIA_ADD', cafeteria });
      await waitFor(st => st.cafeterias.some(c => c.id === cafeteria.id));
      return flush();
    },
    update: async (cafeteria) => {
      dispatch({ type: 'CAFETERIA_UPDATE', cafeteria });
      await waitFor(st => st.cafeterias.some(c => c.id === cafeteria.id && c.name === cafeteria.name));
      return flush();
    },
    remove: async (id) => {
      dispatch({ type: 'CAFETERIA_DELETE', id });
      await waitFor(st => !st.cafeterias.some(c => c.id === id));
      return flush();
    },
  }), [waitFor, flush]);

  const value = useMemo(
    () => ({ state, dispatch: dispatchSync, flush, waitFor, sync, confirmProduct, productsSync, cafeteriaOps }),
    [state, dispatchSync, flush, waitFor, sync, confirmProduct, productsSync, cafeteriaOps],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ─── Scoped hook ─────────────────────────────────────────────────────────────────
export interface BizApi {
  /** Partie visée par cette instance de l'API. */
  module: ModuleKey;
  state: ModuleState;
  all: BizState;
  add: (coll: BizCollection, item: any) => void;
  update: (coll: BizCollection, item: any) => void;
  remove: (coll: BizCollection, id: string) => void;
  set: (coll: BizCollection, items: any[]) => void;
  patch: (patch: Partial<ModuleState>) => void;
  /**
   * Force l'enregistrement immédiat et ATTEND le verdict du serveur. À utiliser
   * dès qu'une création doit être certaine (produit, achat…) : tant que ceci n'a
   * pas rendu `{ ok: true }`, la ligne n'existe que dans ce navigateur.
   */
  flush: () => Promise<SaveOutcome>;
  /**
   * Ajoute une ligne puis attend sa confirmation par le serveur. Un PRODUIT est
   * écrit dans sa propre table (`biz_products`) : quelques centaines d'octets,
   * un verdict en une fraction de seconde — au lieu des 665 Ko du blob, qui
   * expiraient au bout de huit secondes.
   */
  addAndConfirm: (coll: BizCollection, item: any) => Promise<SaveOutcome>;
  /** Idem pour une modification : la ligne part et on attend le verdict. */
  updateAndConfirm: (coll: BizCollection, item: any) => Promise<SaveOutcome>;
}

export function useBiz(module: ModuleKey): BizApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBiz must be used within <BizProvider>');
  const { state, dispatch, flush, waitFor, confirmProduct } = ctx;
  return useMemo<BizApi>(() => {
    /** Écriture confirmée d'une ligne, quelle que soit sa collection. */
    const writeAndConfirm = async (
      mode: 'add' | 'update', coll: BizCollection, item: any,
    ): Promise<SaveOutcome> => {
      if (coll === 'products' && item?.id) return confirmProduct(module, item, mode);
      dispatch({ type: mode === 'add' ? 'ADD' : 'UPDATE', module, coll, item });
      // L'enregistrement doit porter SUR la ligne qu'on vient d'écrire : on
      // attend qu'elle soit dans l'état avant de l'envoyer.
      await waitFor(s => ((s.modules[module]?.[coll] || []) as any[]).some(x => x?.id === item?.id));
      return flush();
    };

    return {
      module,
      state: state.modules[module] || EMPTY_MODULE(),
      all: state,
      add: (coll, item) => dispatch({ type: 'ADD', module, coll, item }),
      update: (coll, item) => dispatch({ type: 'UPDATE', module, coll, item }),
      remove: (coll, id) => dispatch({ type: 'DELETE', module, coll, id }),
      set: (coll, items) => dispatch({ type: 'SET', module, coll, items }),
      patch: (p) => dispatch({ type: 'PATCH', module, patch: p }),
      flush,
      addAndConfirm: (coll, item) => writeAndConfirm('add', coll, item),
      updateAndConfirm: (coll, item) => writeAndConfirm('update', coll, item),
    };
  }, [state, module, dispatch, flush, waitFor, confirmProduct]);
}

// Read-only access to the whole store (used by the General Reports page).
export function useBizAll(): BizState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizAll must be used within <BizProvider>');
  return ctx.state;
}

/**
 * Les cafeterias declarees, dans l'ordre de creation. C'est la source unique
 * pour la barre laterale, les filtres et tous les selecteurs de cafeteria :
 * une page qui lirait `MODULES` sans passer par ce hook ne se redessinerait
 * pas quand une cafeteria est ajoutee.
 */
export function useCafeterias(): Cafeteria[] {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCafeterias must be used within <BizProvider>');
  return ctx.state.cafeterias;
}

/** Les cafeterias actives (non archivees) — celles ou l'on peut ecrire. */
export function useActiveCafeterias(): Cafeteria[] {
  const list = useCafeterias();
  return useMemo(() => list.filter(c => !c.archived), [list]);
}

/** Creation / modification / suppression d'une cafeteria (Reglages). */
export function useCafeteriaOps(): CafeteriaOps {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCafeteriaOps must be used within <BizProvider>');
  return ctx.cafeteriaOps;
}

/**
 * L'etat de PLUSIEURS cafeterias d'un coup, pour les ecrans transversaux
 * (tableau de bord, caisse generale, rapports generaux). Passer `null` prend
 * toutes les cafeterias connues.
 */
export function useBizModules(keys?: ModuleKey[] | null): { key: ModuleKey; state: ModuleState }[] {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizModules must be used within <BizProvider>');
  const { state } = ctx;
  return useMemo(() => {
    const wanted = keys && keys.length ? keys : state.cafeterias.map(c => c.id);
    return wanted.map(key => ({ key, state: state.modules[key] || EMPTY_MODULE() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, keys ? keys.join('|') : '*']);
}

/** État de la synchronisation — affiché là où une perte serait grave. */
export function useBizSync(): BizSyncState & { flush: () => Promise<SaveOutcome> } {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizSync must be used within <BizProvider>');
  return { ...ctx.sync, flush: ctx.flush };
}

/**
 * État d'écriture du catalogue. `pending` porte les fiches dont la base n'a pas
 * encore accusé réception : c'est LA question que pose l'onglet « Brouillons ».
 */
export function useBizProductsSync(): BizProductsSync {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizProductsSync must be used within <BizProvider>');
  return ctx.productsSync;
}

/**
 * Écrit une fiche produit dans UNE cafétéria précise et attend le verdict de la
 * base — l'outil du formulaire « créer ce produit dans plusieurs cafétérias ».
 *
 * `useBiz(key)` est un hook : impossible de l'appeler pour une cafétéria choisie
 * au moment du clic. Ce hook-ci prend la cafétéria en PARAMÈTRE d'appel, ce qui
 * permet d'enregistrer la même fiche dans deux ou dix comptoirs d'affilée.
 */
export function useConfirmProduct(): (
  module: ModuleKey, product: BizProduct, mode: 'add' | 'update',
) => Promise<SaveOutcome> {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirmProduct must be used within <BizProvider>');
  return ctx.confirmProduct;
}

export function useBizReset() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizReset must be used within <BizProvider>');
  return () => ctx.dispatch({ type: 'RESET' });
}
