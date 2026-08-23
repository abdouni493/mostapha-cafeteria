/**
 * ─── SUPABASE CLIENT (live backend) ────────────────────────────────────────────
 * Connexion Supabase de Altech Cafeteria. It keeps the EXACT same public
 * surface the previous offline mock exposed (`supabase`, `db`, `signIn`,
 * `dbInsert`, `subscribeTable`, storage helpers, …), so every page, interface and
 * button in the app talks to the live database and Storage buckets without any
 * other file needing changes.
 *
 * Projet : nijwelszigrghxgtnaqj   (schema complet : supabase/schema.sql)
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createClient } from '@supabase/supabase-js';

// Connection — values come from Vite env when present, otherwise fall back to the
// project this app is wired to. The anon key is public by design (RLS protects data).
const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  'https://nijwelszigrghxgtnaqj.supabase.co';
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pandlbHN6aWdyZ2h4Z3RuYXFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTIyNDksImV4cCI6MjEwMzA4ODI0OX0.cOH-CIgltlvw2JMw6DrLY8P-X_Snud0DqwMLOfCkWIQ';

export const AUTH_STORAGE_KEY = 'altech.cafeteria.auth';

/** Minimal shape the app reads off a session. */
export interface PersistedSession {
  access_token: string;
  refresh_token?: string;
  user: { id: string; email?: string; user_metadata?: Record<string, any> };
}

/**
 * The session supabase-js keeps in localStorage, read synchronously.
 *
 * `supabase.auth.getSession()` is async and, on a slow or lossy link, can take
 * seconds because it renews the token first. Nothing that only needs to know
 * *whether* somebody is signed in should wait for that — waiting is what used to
 * strand users on the login screen. Authorisation itself is never decided here:
 * every query still goes through supabase-js (fresh token + RLS), and a session
 * that turns out to be dead ends at SIGNED_OUT.
 */
export function readPersistedSession(): PersistedSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession ?? parsed;
    if (!session?.access_token || !session?.user?.id) return null;
    return session as PersistedSession;
  } catch {
    return null;
  }
}

// ─── Network resilience layer ───────────────────────────────────────────────────
/**
 * Some client machines reach Supabase over a resolver / firewall that drops
 * requests intermittently (`net::ERR_NAME_NOT_RESOLVED`) and share a public IP
 * with other stations, which trips Supabase's per-IP rate limiter on
 * `/auth/v1/token` (HTTP 429).
 *
 * Both used to be fatal on those PCs:
 *   • a transient DNS/network blip made a query fail outright;
 *   • a 429 on a token refresh is NOT in auth-js's retryable status list
 *     ([502, 503, 504, 520…530]), so `_callRefreshToken()` fell through to
 *     `_removeSession()` and destroyed the session mid-login — which is exactly
 *     the "impossible to connect from that machine" symptom.
 *
 * `resilientFetch` makes both survivable:
 *   1. concurrent refresh calls collapse into ONE network request (a burst of
 *      refreshes is what trips the limiter in the first place);
 *   2. a rate-limited or transient request is retried with backoff, honouring
 *      `Retry-After`;
 *   3. a refresh that is still rate-limited after the retries is reported as
 *      503 so auth-js classifies it as retryable and KEEPS the session instead
 *      of signing the user out.
 *
 * Retries are deliberately conservative: a request that may already have been
 * applied server-side (POST/PATCH/DELETE that failed mid-flight) is never
 * replayed, so no write is ever duplicated. Only 429s — which the limiter
 * rejects before any processing — are retried for every method.
 */
/**
 * Budget d'UNE tentative.
 *
 * Il était de 20 s avec trois reprises : une requête vers une base qui ne répond
 * plus coûtait donc 20+1+20+2+20+4+20 ≈ 87 SECONDES avant de rendre la main, et
 * l'hydratation en lance une quarantaine. L'application paraissait morte pendant
 * plusieurs minutes là où elle aurait dû dire « le serveur ne répond pas » tout
 * de suite. Une requête saine revient en moins de 300 ms : huit secondes laissent
 * vingt-cinq fois la marge nécessaire, même sur un lien de station lent.
 *
 * Réduire les reprises AIDE aussi le serveur : réessayer contre une base déjà
 * saturée ne fait qu'ajouter des connexions à une file qui n'avance plus.
 */
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;
/**
 * Un envoi de fichier n'est pas une requête : une photo de bon de livraison sur
 * le lien d'une station met légitimement plus de huit secondes. Lui appliquer le
 * budget des requêtes de données couperait des envois parfaitement sains — et un
 * POST n'est jamais rejoué, il serait donc simplement perdu.
 */
const UPLOAD_TIMEOUT_MS = 60_000;
/**
 * L'ÉTAT PARTAGÉ DES PARTIES N'EST PAS UNE REQUÊTE ORDINAIRE.
 *
 * `biz_store` tient tout ce que contiennent la Cafétéria et le Lavage dans UNE
 * ligne JSON : 665 Ko aujourd'hui, dont 567 Ko d'historique de ventes. Elle part
 * en entier à chaque enregistrement. Sur le lien montant d'une station, envoyer
 * 665 Ko demande couramment dix à vingt secondes — le budget de huit secondes
 * abandonnait donc des enregistrements parfaitement sains, et l'écran de la
 * Gestion de stock annonçait « Le serveur refuse les enregistrements —
 * TimeoutError » alors que la base n'avait aucun problème.
 *
 * Ce budget-là ne couvre QUE ces deux points d'entrée, ceux dont on sait que la
 * charge utile est volumineuse. Tout le reste garde huit secondes : une requête
 * de données saine revient en moins de 300 ms, et une base en carafe doit être
 * signalée vite.
 *
 * Ce n'est pas un pansement sur la lenteur : les produits, eux, ont quitté ce
 * blob pour leur propre table (`biz_products`, migration 2026-08-15) et ne
 * dépendent plus du tout de ce budget. Les ventes suivront le même chemin.
 */
const BULK_STATE_TIMEOUT_MS = 45_000;

const isStorageRequest = (url: string) => url.includes('/storage/v1/');
/** L'écriture (RPC) et la lecture de la grosse ligne JSON partagée. */
const isBulkStateRequest = (url: string) =>
  url.includes('/rest/v1/rpc/biz_store_save') || url.includes('/rest/v1/biz_store');
// The refresh endpoint retries only once here. Every postgrest call awaits
// getSession(), so a long backoff chain inside a refresh would stall the whole
// app; auth-js has its own paced retry loop for the 503 we hand back, and that
// is the better place to wait.
const MAX_AUTH_RETRIES = 1;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request)?.url ?? '';
}

/** `POST /auth/v1/token?grant_type=refresh_token` — the rate-limited endpoint. */
function isRefreshTokenRequest(url: string): boolean {
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token');
}

/** Backoff delay, preferring the server's `Retry-After` when it sends one. */
function retryDelayMs(attempt: number, res?: Response): number {
  const retryAfter = res?.headers?.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 30_000);
  }
  // 1s → 2s → 4s, plus jitter so several tabs don't retry in lockstep.
  return Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 400);
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  // Only replay requests that cannot have taken effect server-side.
  const replayable = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const callerSignal = init?.signal ?? undefined;
  const url = urlOf(input);
  const budget = isStorageRequest(url) ? UPLOAD_TIMEOUT_MS
    : isBulkStateRequest(url) ? BULK_STATE_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Per-attempt timeout — a request that never settles must not wedge the app.
    // The abort carries a NAMED reason: without it the console fills with
    // "AbortError: signal is aborted without reason", which reads like a bug in
    // the app when it is simply the request budget doing its job.
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    const timer = setTimeout(
      () => controller.abort(new DOMException(`Le serveur n'a pas répondu en ${Math.round(budget / 1000)} s`, 'TimeoutError')),
      budget,
    );
    callerSignal?.addEventListener('abort', onCallerAbort);

    try {
      const res = await fetch(input, { ...init, signal: controller.signal });

      // 429: rejected by the rate limiter before any processing → always safe to retry.
      // 5xx: may have been applied → replay only idempotent methods.
      const retryable = res.status === 429 || (replayable && res.status >= 500);
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(attempt, res));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      // The caller aborted on purpose (component unmounted, request superseded).
      if (callerSignal?.aborted) throw err;
      if (!replayable || attempt >= maxRetries) throw err;
      await sleep(retryDelayMs(attempt));
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  throw lastError;
}

/** In-flight refresh, shared by every caller so a burst becomes one request. */
let refreshInFlight: Promise<Response> | null = null;

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);

  if (!isRefreshTokenRequest(url)) return fetchWithRetry(input, init);

  if (!refreshInFlight) {
    refreshInFlight = fetchWithRetry(input, init, MAX_AUTH_RETRIES)
      .finally(() => { refreshInFlight = null; });
  }

  // Every caller — including the first — reads a clone, so the shared response
  // body is never consumed and can be cloned again by the next waiter.
  const shared = await refreshInFlight;

  if (shared.status === 429) {
    // Still rate limited. Surfacing the 429 would make auth-js drop the session;
    // 503 is in its retryable list, so the session survives and it retries later.
    const body = await shared.clone().text().catch(() => '');
    console.warn('[auth] Rafraîchissement du jeton limité (429) — session conservée, nouvel essai plus tard.');
    return new Response(
      body || JSON.stringify({ error: 'rate_limited', error_description: 'Too many refresh attempts' }),
      { status: 503, statusText: 'Rate limited', headers: new Headers(shared.headers) },
    );
  }

  return shared.clone();
}

// ─── Diagnostic : QUELLE couche est en panne ? ─────────────────────────────────
/**
 * `ok` — tout répond.
 * `database` — le serveur Supabase répond, mais les requêtes de DONNÉES non : la
 *   base est saturée, redémarre, ou son pool de connexions est épuisé. Le poste
 *   et Internet n'y sont pour RIEN.
 * `offline` — le serveur n'est pas joignable du tout : là, c'est bien le réseau.
 *
 * Cette distinction n'est pas cosmétique. « Vérifiez la connexion Internet »
 * affiché alors que le lien est parfait envoie l'utilisateur débrancher sa box
 * pendant des heures pour un problème qui est côté serveur.
 */
export type BackendStatus = 'ok' | 'database' | 'offline';

/** `fetch` NU : ni reprise ni file d'attente — un diagnostic doit être rapide. */
async function rawFetch(url: string, ms: number, headers?: Record<string, string>): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`Diagnostic sans réponse en ${ms} ms`, 'TimeoutError')), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeBackend(): Promise<BackendStatus> {
  // 1. Une vraie requête de données, courte : c'est elle qui compte.
  const data = await rawFetch(
    `${SUPABASE_URL}/rest/v1/store_settings?select=id&limit=1`, 6_000,
    { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  );
  if (data && data.status < 500) return 'ok';

  // 2. Pas de données. La passerelle répond-elle quand même ? Sans clé elle rend
  //    un 401 immédiat SANS toucher à la base — c'est le test qui sépare
  //    « réseau coupé » de « base en carafe ».
  const gateway = await rawFetch(`${SUPABASE_URL}/rest/v1/`, 5_000);
  return gateway ? 'database' : 'offline';
}

/** Message prêt à afficher pour chaque état — même vocabulaire partout. */
export const BACKEND_STATUS_MESSAGE: Record<Exclude<BackendStatus, 'ok'>, string> = {
  database:
    "Le serveur de données ne répond pas (base saturée ou en redémarrage). "
    + "Votre connexion Internet fonctionne : il n'y a rien à faire sur ce poste, "
    + "réessayez dans quelques minutes.",
  offline:
    "Serveur injoignable depuis ce poste. Vérifiez la connexion Internet, puis réessayez.",
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // No OAuth / magic-link redirect flow in this app — skip the URL parsing.
    detectSessionInUrl: false,
    storageKey: AUTH_STORAGE_KEY,
  },
  global: { fetch: resilientFetch },
  realtime: {
    // Backoff ladder for the websocket. The default tops out at 10 s, which on a
    // machine whose DNS/firewall blocks `wss://` produced an endless stream of
    // ERR_NAME_NOT_RESOLVED in the console. Capped at 2 min instead: the app
    // still heals itself when the network returns, without flooding the log.
    reconnectAfterMs: (tries: number) => {
      const ladder = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000];
      return ladder[Math.min(Math.max(tries, 1), ladder.length) - 1];
    },
    heartbeatIntervalMs: 30_000,
    timeout: 20_000,
  },
});

// ─── Realtime health ────────────────────────────────────────────────────────────
/**
 * Live updates are a nice-to-have: on networks that block websockets the app must
 * still work, just without push. Channels report their subscribe status here; once
 * enough of them fail the app switches to periodic polling (see AppContext) and
 * tells the user once, instead of silently showing stale data.
 */
export type RealtimeHealth = 'connecting' | 'online' | 'offline';

const REALTIME_FAILURE_THRESHOLD = 3;

let realtimeHealth: RealtimeHealth = 'connecting';
let realtimeFailures = 0;
const realtimeListeners = new Set<(health: RealtimeHealth) => void>();

export function getRealtimeHealth(): RealtimeHealth {
  return realtimeHealth;
}

/** Subscribes to health changes; fires immediately with the current value. */
export function onRealtimeHealthChange(cb: (health: RealtimeHealth) => void): () => void {
  realtimeListeners.add(cb);
  cb(realtimeHealth);
  return () => { realtimeListeners.delete(cb); };
}

function setRealtimeHealth(next: RealtimeHealth) {
  if (next === realtimeHealth) return;
  realtimeHealth = next;
  realtimeListeners.forEach(l => { try { l(next); } catch { /* listener errors are not ours */ } });
}

function reportRealtimeStatus(status: string) {
  if (status === 'SUBSCRIBED') {
    realtimeFailures = 0;
    setRealtimeHealth('online');
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    realtimeFailures += 1;
    if (realtimeFailures >= REALTIME_FAILURE_THRESHOLD) setRealtimeHealth('offline');
  }
}

// ─── Storage bucket names (unchanged public API) ────────────────────────────────
export const BUCKETS = {
  /** Logos de l'enseigne et des cafeterias. */
  STORE_LOGOS:      'store-logos',
  /** Photos des produits et des fiches techniques. */
  PRODUCT_IMAGES:   'product-images',
  /** Photos des employes. */
  WORKER_PHOTOS:    'worker-photos',
  /** Bons de livraison et factures fournisseurs photographies. */
  PURCHASE_DOCS:    'purchase-docs',
  /** Justificatifs de depenses. */
  EXPENSE_RECEIPTS: 'expense-receipts',
  /** Recus remis aux clients. */
  CLIENT_RECEIPTS:  'client-receipts',
} as const;

// ─── Storage helpers ────────────────────────────────────────────────────────────

/** Build a public URL for a stored object. Pass-throughs full URLs / data-URLs. */
export function getPublicUrl(bucket: string, path: string): string {
  if (!path) return path;
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:')) return path;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function randomName(ext = 'jpg'): string {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${id}.${ext}`;
}

/** Uploads a File to a bucket and returns its public URL (or null on failure). */
export async function uploadFile(bucket: string, path: string, file: File): Promise<string | null> {
  try {
    const key = path && path.length ? path : randomName((file.name?.split('.').pop() || 'jpg'));
    const { error } = await supabase.storage.from(bucket).upload(key, file, {
      upsert: true,
      contentType: file.type || 'image/jpeg',
    });
    if (error) { console.warn('[uploadFile]', error.message); return null; }
    return getPublicUrl(bucket, key);
  } catch (e) {
    console.warn('[uploadFile] failed', e);
    return null;
  }
}

/** Converts a base64 / data-URL string to bytes and uploads it; returns public URL. */
export async function uploadBase64(
  bucket: string,
  path: string,
  base64: string,
  mimeType = 'image/jpeg'
): Promise<string | null> {
  try {
    if (!base64) return null;
    // Already a hosted URL — nothing to upload.
    if (base64.startsWith('http') || base64.startsWith('blob:')) return base64;

    let raw = base64;
    let mime = mimeType;
    const m = base64.match(/^data:([^;]+);base64,(.*)$/);
    if (m) { mime = m[1]; raw = m[2]; }

    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const key = path && path.length ? path : randomName(ext);

    const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
      upsert: true,
      contentType: mime,
    });
    if (error) { console.warn('[uploadBase64]', error.message); return base64; }
    return getPublicUrl(bucket, key);
  } catch (e) {
    console.warn('[uploadBase64] failed', e);
    // Fall back to the original base64 so the image still renders in the UI.
    return base64 || null;
  }
}

// ─── Auth helpers (public API) ──────────────────────────────────────────────────

const DEMO_EMAIL = 'admin@altech-cafeteria.dz';
const DEMO_PASSWORD = 'altech2026';

/**
 * Rôle du compte qui vient de se connecter. La page de connexion REFUSE l'accès
 * quand il vaut null : un échec passager du réseau juste après un mot de passe
 * accepté ne doit donc pas se déguiser en « aucun rôle » — d'où le second essai.
 */
async function resolveRole(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabase.rpc('get_my_role');
      if (!error) return (data as string | null) ?? null;
    } catch { /* réseau — retenté ci-dessous */ }
    if (attempt === 0) await sleep(600);
  }
  return null;
}

/** Why a sign-in failed — the login page shows a different message per reason. */
export type SignInFailure = 'credentials' | 'rate_limited' | 'network';

/**
 * Sign in with an email OR a username (+ password). Returns the resolved role so
 * the login page can route the user; returns `{ error, reason }` on failure.
 *
 * `reason` matters: a rate-limited or unreachable server used to be reported as
 * "identifiants invalides", which sent people hunting for a password problem
 * that did not exist.
 */
export async function signIn(identifier: string, password: string) {
  let email = (identifier || '').trim();

  // Allow login by username: resolve it to the account email.
  if (email && !email.includes('@')) {
    try {
      const { data } = await supabase.rpc('email_for_username', { p_username: email.toLowerCase() });
      if (data) email = data as string;
    } catch { /* fall through — will fail auth below */ }
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const status = (error as any)?.status as number | undefined;
    const reason: SignInFailure =
      status === 429 ? 'rate_limited'
      : (!status || status === 0 || status >= 500) ? 'network'
      : 'credentials';
    return { error: error.message, reason };
  }

  const role = await resolveRole();
  return { user: data.user, session: data.session, role, profile: null };
}

/** One-click demo administrator login (only works if that account exists). */
export async function signInDemoAdmin() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (error) throw new Error(error.message);
  const role = (await resolveRole()) ?? 'admin';
  return { user: data.user, session: data.session, role: role as 'admin' };
}

/**
 * Create the FIRST administrator account (from the login page's signup form).
 * Uses a SECURITY DEFINER RPC that provisions a confirmed auth user + profile, so
 * the new admin can log in immediately (no email-confirmation step).
 */
export async function signUpAdmin(params: {
  name: string; username: string; email: string; password: string;
}): Promise<{ user: any; session: any } | { error: string }> {
  const { data, error } = await supabase.rpc('create_admin_account', {
    p_name: params.name,
    p_username: params.username,
    p_email: params.email,
    p_password: params.password,
  });
  if (error) return { error: error.message };
  if (data && (data as any).ok === false) return { error: (data as any).error || 'Échec de la création' };
  return { user: null, session: null };
}

/** True when at least one administrator already exists (hides the signup button). */
export async function adminExists(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('admin_exists');
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ─── Comptes de connexion des employes de cafeteria ───────────────────────────
// Ces employes vivent dans le store `BizContext` : leur compte est provisionne
// par une fonction SECURITY DEFINER qui cree l'utilisateur dans
// `auth.users` ET la ligne `module_workers` en une seule transaction.

/** Identifiant de la cafeteria a laquelle l'employe est rattache. */
export type BizModuleKey = string;

export interface ModuleWorkerRow {
  id: string;
  module_key: BizModuleKey;
  name: string;
  role_name?: string | null;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  auth_user_id?: string | null;
  has_account: boolean;
  permissions: Record<string, boolean>;
}

export async function provisionModuleWorkerAccount(input: {
  action: 'create' | 'update_password' | 'delete';
  moduleKey: BizModuleKey;
  workerId: string;
  username?: string;
  password?: string;
  name?: string;
  email?: string;
  roleName?: string;
  phone?: string;
  permissions?: Record<string, boolean>;
}): Promise<{ ok: boolean; auth_user_id?: string; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('provision_module_worker_account', {
      p_action:      input.action,
      p_module_key:  input.moduleKey,
      p_worker_id:   input.workerId,
      p_username:    input.username ?? null,
      p_password:    input.password ?? null,
      p_name:        input.name ?? null,
      p_email:       input.email ?? null,
      p_role_name:   input.roleName ?? null,
      p_phone:       input.phone ?? null,
      p_permissions: input.permissions ?? {},
    });
    if (error) {
      // The RPC is missing until the migration is run — surface a clear message.
      const hint = /function .* does not exist|schema cache/i.test(error.message)
        ? "Base non initialisée : exécutez supabase/schema.sql dans Supabase → SQL Editor."
        : error.message;
      return { ok: false, error: hint };
    }
    if (data && (data as any).ok) return { ok: true, auth_user_id: (data as any).auth_user_id };
    return { ok: false, error: (data as any)?.error || 'Erreur inconnue' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

/** Persists a part-employee's permissions server-side (so they apply at login). */
export async function saveModuleWorkerPermissions(
  workerId: string,
  permissions: Record<string, boolean>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('save_module_worker_permissions', {
      p_worker_id: workerId,
      p_permissions: permissions,
    });
    if (error) return { ok: false, error: error.message };
    if (data && (data as any).ok === false) return { ok: false, error: (data as any).error };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

/** Resolves the connected part-employee (module_key + permissions), or null. */
export async function getMyModuleWorker(): Promise<ModuleWorkerRow | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_module_worker');
    if (error || !data) return null;
    return data as ModuleWorkerRow;
  } catch {
    return null;
  }
}

// ─── Shared business-parts state (single JSON row) ──────────────────────────────
// Keeps Restaurant / Cafétéria / Lavage / Magasin data identical for the admin
// and for every part-employee who logs in, instead of being browser-local only.
const BIZ_STORE_ID = 'cafeteria-v1';

/**
 * Lecture de l'état partagé, avec sa RÉVISION.
 *
 * La révision est le numéro de version de la ligne : elle est renvoyée à
 * l'écriture pour que le serveur refuse d'écraser un état plus récent que celui
 * qu'on croit connaître (voir `saveBizStore`). Elle vaut `null` tant que la
 * migration `2026-08-06_biz_store_revision_merge.sql` n'a pas été passée — tout
 * continue alors de fonctionner, simplement sans ce garde-fou serveur.
 */
export interface BizStoreSnapshot {
  state: any | null;
  rev: number | null;
}

export async function loadBizStoreSnapshot(): Promise<BizStoreSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from('biz_store').select('state, rev').eq('id', BIZ_STORE_ID).maybeSingle();
    if (!error && data) {
      return { state: (data as any).state ?? null, rev: (data as any).rev ?? null };
    }
    // Colonne `rev` absente (migration non passée) → relecture sans elle.
    const fallback = await supabase
      .from('biz_store').select('state').eq('id', BIZ_STORE_ID).maybeSingle();
    if (fallback.error || !fallback.data) return null;
    return { state: (fallback.data as any).state ?? null, rev: null };
  } catch {
    return null;
  }
}

export async function loadBizStore(): Promise<any | null> {
  return (await loadBizStoreSnapshot())?.state ?? null;
}

/**
 * Révision SEULE de la ligne partagée — quelques octets là où le blob complet
 * en pèse des centaines de milliers. C'est le test « y a-t-il du nouveau ? »
 * du retour sur l'onglet : tant que la révision du serveur est celle qu'on
 * connaît, le blob n'est pas retéléchargé. `null` quand la colonne n'existe pas
 * encore (migration non passée) — l'appelant fait alors une lecture complète.
 */
export async function peekBizStoreRev(): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('biz_store').select('rev').eq('id', BIZ_STORE_ID).maybeSingle();
    if (error || !data) return null;
    return (data as any).rev ?? null;
  } catch {
    return null;
  }
}

/** Résultat d'une écriture de l'état partagé. */
export interface BizStoreSaveResult {
  ok: boolean;
  /** Nouvelle révision de la ligne, quand l'écriture est passée. */
  rev?: number | null;
  /** Quelqu'un a écrit entre-temps : `remote` porte la version à fusionner. */
  conflict?: boolean;
  remote?: BizStoreSnapshot;
  error?: string;
}

/**
 * Écrit l'état partagé — SANS jamais écraser en aveugle.
 *
 * `baseRev` est la révision sur laquelle le travail a été construit. Le serveur
 * n'accepte l'écriture que si la ligne est toujours à cette révision ; sinon il
 * renvoie l'état courant et l'appelant fusionne avant de réessayer. C'est ce qui
 * empêche un poste d'effacer le produit qu'un autre poste vient de créer.
 *
 * Deux replis, pour qu'aucune installation ne se retrouve bloquée :
 *   • la fonction serveur n'existe pas (migration non passée) → écriture directe ;
 *   • la colonne `rev` n'existe pas → écriture directe elle aussi.
 * Dans les deux cas l'erreur éventuelle est REMONTÉE : une sauvegarde qui échoue
 * ne doit plus jamais passer inaperçue.
 */
export async function saveBizStore(
  state: unknown,
  baseRev?: number | null,
): Promise<BizStoreSaveResult> {
  try {
    const { data, error } = await supabase.rpc('biz_store_save', {
      p_id: BIZ_STORE_ID,
      p_state: state,
      p_base_rev: baseRev ?? null,
    });

    if (!error && data) {
      const res = data as any;
      if (res.ok) return { ok: true, rev: res.rev ?? null };
      if (res.conflict) {
        return { ok: false, conflict: true, remote: { state: res.state ?? null, rev: res.rev ?? null } };
      }
      return { ok: false, error: res.error || 'Enregistrement refusé par le serveur' };
    }

    // La fonction n'est pas déployée : on retombe sur l'écriture directe.
    const missingRpc = !!error && /does not exist|schema cache|not find the function/i.test(error.message);
    if (error && !missingRpc) return { ok: false, error: error.message };

    const { error: upsertError } = await supabase.from('biz_store')
      .upsert({ id: BIZ_STORE_ID, state, updated_at: new Date().toISOString() });
    if (upsertError) return { ok: false, error: upsertError.message };
    return { ok: true, rev: null };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Réseau indisponible' };
  }
}

// ─── Generic DB helpers (real Supabase queries) ─────────────────────────────────
//
// ⚠ Ces quatre fonctions LÈVENT sur erreur — elles ne doivent JAMAIS l'avaler.
// Elles se contentaient d'un `console.warn` : une écriture refusée (colonne
// absente, contrainte, RLS, réseau) rendait alors la main comme si tout s'était
// bien passé. `syncedDispatch` n'ayant rien à rattraper, l'écran gardait la
// modification optimiste et la base, elle, n'avait rien reçu — d'où des données
// « qui expirent » au rechargement suivant. En levant, l'erreur remonte à
// `syncedDispatch`, qui affiche un message ET recharge la table concernée : ce
// qui est à l'écran redevient ce qui est réellement enregistré.

/** Erreur d'écriture Supabase, avec la table et le détail Postgres. */
export class DbWriteError extends Error {
  constructor(op: string, table: string, err: { message: string; details?: string | null; hint?: string | null; code?: string | null }) {
    super(`[${op} ${table}] ${err.message}${err.details ? ` — ${err.details}` : ''}${err.hint ? ` (${err.hint})` : ''}`);
    this.name = 'DbWriteError';
  }
}

export async function dbInsert<T extends object>(tableName: string, row: T): Promise<T> {
  const { error } = await supabase.from(tableName).insert(row as any);
  if (error) { console.error(`[dbInsert:${tableName}]`, error); throw new DbWriteError('insert', tableName, error); }
  return row;
}

export async function dbUpsert<T extends object>(tableName: string, row: T): Promise<T> {
  const { error } = await supabase.from(tableName).upsert(row as any);
  if (error) { console.error(`[dbUpsert:${tableName}]`, error); throw new DbWriteError('upsert', tableName, error); }
  return row;
}

export async function dbUpdate<T extends object>(
  tableName: string,
  id: string,
  changes: Partial<T>
): Promise<Partial<T>> {
  const { error } = await supabase.from(tableName).update(changes as any).eq('id', id);
  if (error) { console.error(`[dbUpdate:${tableName}]`, error); throw new DbWriteError('update', tableName, error); }
  return changes;
}

export async function dbDelete(tableName: string, id: string) {
  const { error } = await supabase.from(tableName).delete().eq('id', id);
  if (error) { console.error(`[dbDelete:${tableName}]`, error); throw new DbWriteError('delete', tableName, error); }
}

/**
 * ─── Lire une table ENTIÈRE, quel que soit le plafond du serveur ──────────────
 *
 * PostgREST tronque toute réponse à `db-max-rows` (1000 lignes par défaut) et ne
 * signale rien : la requête réussit, il en manque simplement la fin. Les tables
 * d'historique — comptabilité de brigade, justifications, transactions client,
 * ventes magasin — dépassent ce plafond au bout de quelques mois d'exploitation.
 *
 * Conséquence observée : l'historique d'un client ne remontait plus que les
 * toutes dernières opérations. Rien n'était perdu en base ; c'est la lecture qui
 * s'arrêtait. On pagine donc explicitement, par tranches, jusqu'à ce que le
 * serveur rende moins d'une tranche pleine.
 *
 * `orderBy` sert uniquement à rendre la pagination DÉTERMINISTE : sans ordre
 * stable, deux tranches peuvent se recouvrir ou sauter des lignes.
 */
const PAGE_SIZE = 1000;

/**
 * ─── LES TABLES SANS HORODATAGE DE CRÉATION ───────────────────────────────────
 *
 * Trois tables de sous-enregistrements n'ont jamais eu de colonne `created_at` :
 * elles sont écrites en même temps que leur parent, qui en porte une. Les
 * ordonner dessus déclenche une 400 de PostgREST (« column … does not exist »).
 *
 * Le repli qui suivait cette 400 était PIRE que le défaut qu'il rattrapait : il
 * retombait sur `dbSelect`, qui ne pagine pas — donc exactement le plafond de
 * 1000 lignes que cette fonction existe pour contourner. Les justifications de
 * brigade, qui portent la consommation carburant de TOUS les clients, s'y
 * faisaient silencieusement tronquer au bout de quelques mois : l'écran Clients
 * perdait des bons sans que rien ne le dise.
 *
 * On ordonne donc ces tables par `id` — une clé primaire, donc un ordre stable,
 * ce qui est tout ce que la pagination demande. Une requête de moins, et plus
 * aucune ligne perdue.
 */
const NO_CREATED_AT = new Set<string>([]);

export async function dbSelectAll<T>(
  tableName: string,
  opts?: { orderBy?: string; ascending?: boolean; eq?: Record<string, unknown> },
): Promise<T[]> {
  const orderBy = opts?.orderBy || (NO_CREATED_AT.has(tableName) ? 'id' : 'created_at');
  const ascending = opts?.ascending ?? false;
  const out: any[] = [];

  for (let page = 0; ; page++) {
    let q = supabase.from(tableName).select('*');
    if (opts?.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v as any);
    // `nullsFirst: false` garde les lignes sans horodatage à la fin plutôt que de
    // les faire remonter en tête à chaque tranche.
    q = q.order(orderBy, { ascending, nullsFirst: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const { data, error } = await q;
    if (error) {
      // La colonne d'ordre n'existe pas : on repagine sur `id` plutôt que de
      // retomber sur `dbSelect`, qui ne pagine pas et tronquerait à 1000 lignes.
      // Ce n'est plus qu'un filet — les tables connues sont déclarées ci-dessus.
      if (page === 0 && orderBy !== 'id' && /column .* does not exist|42703/i.test(error.message || '')) {
        console.warn(`[dbSelectAll:${tableName}] pas de colonne « ${orderBy} » — tri sur « id »`);
        return dbSelectAll<T>(tableName, { ...opts, orderBy: 'id' });
      }
      console.error(`[dbSelectAll:${tableName}]`, error);
      throw new Error(`[select ${tableName}] ${error.message}`);
    }
    const rows = (data as any[]) || [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out as T[];
}

/**
 * Lecture d'une table. Une lecture qui échoue LÈVE au lieu de rendre une liste
 * vide : renvoyer `[]` faisait passer une panne réseau ou une règle RLS pour
 * « il n'y a rien », l'écran se vidait, et l'utilisateur croyait ses données
 * perdues. Un aller-retour de secours est tenté avant d'abandonner, pour qu'une
 * coupure d'une seconde ne fasse pas remonter d'erreur inutilement.
 */
export async function dbSelect<T>(
  tableName: string,
  query?: Record<string, unknown>,
  limit?: number
): Promise<T[]> {
  const run = async () => {
    let q = supabase.from(tableName).select('*');
    if (query) {
      for (const [k, v] of Object.entries(query)) q = q.eq(k, v as any);
    }
    return q;
  };
  let { data, error } = await run();
  if (error) {
    console.warn(`[dbSelect:${tableName}] échec, nouvelle tentative —`, error.message);
    await new Promise(r => setTimeout(r, 400));
    ({ data, error } = await run());
  }
  if (error) {
    console.error(`[dbSelect:${tableName}]`, error);
    throw new Error(`[select ${tableName}] ${error.message}`);
  }

  // Sort newest-first by created_at when the column exists (matches prior behaviour).
  let rows = (data as any[]) || [];
  rows = [...rows].sort((a, b) => {
    const av = a?.created_at, bv = b?.created_at;
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av < bv ? 1 : -1;
  });
  if (limit) rows = rows.slice(0, limit);
  return rows as T[];
}

// ─── Lecteurs de tables ────────────────────────────────────────────────────────
/**
 * Ce qui reste en RELATIONNEL, et pourquoi.
 *
 * Les donnees d'une cafeteria (stock, ventes, achats…) vivent dans `biz_store` /
 * `biz_products` / `biz_sessions` — voir plus haut. Ne sont ici que les tables
 * TRANSVERSALES, celles qui n'appartiennent a aucune cafeteria :
 *   • `store_settings` — l'enseigne ;
 *   • `general_cash`   — le coffre au-dessus des cafeterias ;
 *   • `admin_profiles` — les administrateurs ;
 *   • `activity_log`   — le journal.
 */
export const db = {
  // ── Reglages de l'enseigne (une seule ligne) ────────────────────────────
  getSettings: async () => {
    const { data } = await supabase.from('store_settings').select('*').limit(1).maybeSingle();
    return data ?? null;
  },
  saveSettings: async (settings: Record<string, unknown>) => {
    // Une ligne unique a identifiant fixe : les ecritures fusionnent au lieu de
    // creer une seconde ligne de reglages que personne ne lirait jamais.
    const existing = await supabase.from('store_settings').select('id').limit(1).maybeSingle();
    const id = (existing.data as any)?.id || 'settings-1';
    const { data, error } = await supabase
      .from('store_settings')
      .upsert({ id, ...settings })
      .select()
      .maybeSingle();
    if (error) throw new DbWriteError('upsert', 'store_settings', error);
    return { data, error };
  },

  // ── Caisse generale ─────────────────────────────────────────────────────
  getGeneralCash:    () => dbSelectAll<any>('general_cash', { orderBy: 'date' }),
  addGeneralCash:    (t: object) => dbInsert('general_cash', t),
  updateGeneralCash: (id: string, t: object) => dbUpdate('general_cash', id, t),
  deleteGeneralCash: (id: string) => dbDelete('general_cash', id),

  // ── Profils administrateurs ─────────────────────────────────────────────
  getAdminProfiles: () => dbSelect('admin_profiles'),
  getAdminProfile: async (id: string) => {
    const { data } = await supabase.from('admin_profiles').select('*').eq('id', id).maybeSingle();
    return data ?? null;
  },
  updateAdminProfile: (id: string, patch: Record<string, unknown>) => dbUpdate('admin_profiles', id, patch),

  // ── Journal d'activite ──────────────────────────────────────────────────
  addActivityLog: (entry: object) =>
    dbInsert('activity_log', {
      id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    }),
  getActivityLog: () => dbSelect('activity_log', undefined, 200),
};

// ─── Camel ↔ Snake conversion helpers (unchanged) ───────────────────────────────
function toCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function toSnake(str: string): string {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

export function rowToCamel<T extends object>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}

export function objToSnake<T extends object>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[toSnake(k)] = v;
  return out as T;
}

export function rowsToCamel<T extends object>(rows: Record<string, unknown>[]): T[] {
  return rows.map(r => rowToCamel<T>(r));
}

// ─── Realtime subscription ──────────────────────────────────────────────────────
export function subscribeTable(
  table: string,
  callback: (payload: { eventType: string; new: unknown; old: unknown }) => void
) {
  const channel = supabase
    .channel(`realtime:${table}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload: any) => {
        callback({ eventType: payload.eventType, new: payload.new, old: payload.old });
      }
    )
    // The status feeds the health tracker above: when the websocket cannot be
    // reached at all, the app falls back to polling instead of going stale.
    .subscribe((status: string) => reportRealtimeStatus(status));

  return () => { supabase.removeChannel(channel); };
}
