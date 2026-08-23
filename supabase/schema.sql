-- ═══════════════════════════════════════════════════════════════════════════
--  ALTECH CAFÉTÉRIA — SCHÉMA COMPLET
--  ─────────────────────────────────────────────────────────────────────────
--  À exécuter EN UNE FOIS dans Supabase → SQL Editor, sur un projet neuf.
--  Le script est IDEMPOTENT : le rejouer ne détruit aucune donnée, il se
--  contente de créer ce qui manque et de remplacer les fonctions.
--
--  CE QU'IL INSTALLE
--    1. Les tables de l'application
--    2. Les buckets de stockage des images (+ leurs règles d'accès)
--    3. Les fonctions d'authentification :
--         • création du PREMIER administrateur depuis la page de connexion
--         • création des comptes d'EMPLOYÉS dans `auth.users`
--         • connexion par nom d'utilisateur (sans taper l'e-mail)
--    4. Les règles RLS : un employé ne peut lire QUE sa cafétéria
--
--  ─── LE MODÈLE DE DONNÉES, EN DEUX MOTS ──────────────────────────────────
--  Les données d'exploitation des cafétérias (stock, ventes, achats, clients,
--  employés, caisse) vivent dans UNE ligne JSON partagée : `biz_store`. Ce
--  choix n'est pas de la paresse — il rend une écriture ATOMIQUE sur des
--  dizaines de collections liées entre elles (une vente touche le stock, la
--  caisse, le client et la session dans la même opération), et il permet la
--  fusion ligne par ligne entre deux postes qui travaillent en même temps.
--
--  Deux ensembles en sortent, parce qu'ils sont écrits trop souvent ou trop
--  gros pour voyager avec le reste :
--    • `biz_products` — une ligne par produit. Créer un produit envoie 800
--      octets au lieu du blob entier.
--    • `biz_sessions` — une ligne par session de caisse, pour que deux
--      caissiers ne s'écrasent jamais l'un l'autre.
--
--  Le reste est relationnel classique : l'enseigne, le coffre général, les
--  comptes administrateurs et le journal.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════════════════════════════════
--  1. TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── L'enseigne ────────────────────────────────────────────────────────────
-- Une seule ligne (id = 'settings-1'). Le nom, le logo et les mentions
-- légales imprimées sur chaque ticket.
create table if not exists public.store_settings (
  id                 text primary key default 'settings-1',
  name               text not null default '',
  logo_url           text,
  address            text,
  phone              text,
  email              text,
  fiscal_id          text,
  rc                 text,
  ai                 text,
  nis                text,
  currency           text default 'DA',
  ticket_footer      text,
  product_categories jsonb default '[]'::jsonb,
  expense_categories jsonb default '[]'::jsonb,
  product_units      jsonb default '[]'::jsonb,
  default_min_qty    numeric default 5,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- ─── Les administrateurs ───────────────────────────────────────────────────
-- `id` EST l'identifiant du compte dans `auth.users` : la ligne existe si et
-- seulement si le compte existe, et disparaît avec lui (on delete cascade).
-- C'est cette table, et elle seule, qui fait foi pour le rôle « admin ».
create table if not exists public.admin_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  username   text unique,
  email      text,
  avatar_url text,
  role       text not null default 'admin',
  created_at timestamptz default now()
);

-- ─── Les employés de cafétéria ─────────────────────────────────────────────
-- `module_key` est l'identifiant de SA cafétéria. C'est la colonne qui décide
-- de tout ce qu'il verra : les règles RLS et l'application s'y réfèrent, et
-- rien ne permet à un employé de lire une autre cafétéria.
--
-- `permissions` porte des clés `"<interface>.<action>"` — par exemple
-- `"pos.voir"`, `"stock.creer"`. Elles sont copiées ici (et pas seulement
-- dans le blob JSON) pour être disponibles DÈS la connexion, avant même que
-- l'application ait chargé quoi que ce soit.
create table if not exists public.module_workers (
  id           text primary key,
  module_key   text not null,
  name         text not null,
  role_name    text,
  phone        text,
  email        text,
  username     text unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  has_account  boolean not null default false,
  permissions  jsonb not null default '{}'::jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists module_workers_auth_idx   on public.module_workers(auth_user_id);
create index if not exists module_workers_module_idx on public.module_workers(module_key);

-- ─── L'état partagé des cafétérias ─────────────────────────────────────────
-- UNE ligne (id = 'cafeteria-v1') qui porte le registre des cafétérias et
-- toutes leurs collections.
--
-- `rev` est le NUMÉRO DE VERSION de la ligne. Toute écriture annonce la
-- révision sur laquelle elle a été construite ; le serveur la refuse si la
-- ligne a bougé entre-temps (voir `biz_store_save`). C'est ce qui empêche un
-- poste d'effacer le produit qu'un autre poste vient de créer.
create table if not exists public.biz_store (
  id         text primary key default 'cafeteria-v1',
  state      jsonb not null default '{}'::jsonb,
  rev        bigint not null default 1,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Le blob pèse vite plusieurs centaines de kilo-octets. Le publier en temps
-- réel le ferait redescendre vers CHAQUE poste à chaque vente encaissée.
-- Cette table-ci ne porte que le numéro de version : quelques octets, qui
-- suffisent à dire « il y a du nouveau, viens le chercher ».
create table if not exists public.biz_store_meta (
  id         text primary key,
  rev        bigint not null default 1,
  updated_at timestamptz default now()
);

-- ─── Le catalogue ──────────────────────────────────────────────────────────
-- Une ligne par produit ET par cafétéria : le même « Café allongé » vendu
-- dans deux comptoirs est DEUX fiches, avec chacune son stock, son prix et
-- son historique. C'est le cœur de l'indépendance entre cafétérias.
--
-- Les colonnes lisibles (nom, stock, prix) sont dérivées du JSON par un
-- déclencheur : l'application n'envoie que `data`, et la base reste
-- interrogeable en SQL pour les exports et les vérifications.
create table if not exists public.biz_products (
  id             text primary key,
  module_key     text not null,
  data           jsonb not null,
  name           text,
  barcode        text,
  category_name  text,
  current_qty    numeric,
  min_qty        numeric,
  purchase_price numeric,
  sale_price     numeric,
  updated_at     timestamptz default now()
);

create index if not exists biz_products_module_idx  on public.biz_products(module_key);
create index if not exists biz_products_barcode_idx on public.biz_products(barcode);
create index if not exists biz_products_name_idx    on public.biz_products(lower(name));

create or replace function public.biz_products_derive()
returns trigger
language plpgsql
as $$
begin
  new.name           := new.data->>'name';
  new.barcode        := new.data->>'barcode';
  new.category_name  := new.data->>'categoryName';
  new.current_qty    := nullif(new.data->>'currentQty', '')::numeric;
  new.min_qty        := nullif(new.data->>'minQty', '')::numeric;
  new.purchase_price := nullif(new.data->>'purchasePrice', '')::numeric;
  new.sale_price     := nullif(new.data->>'salePrice', '')::numeric;
  new.updated_at     := now();
  return new;
end;
$$;

drop trigger if exists biz_products_derive_trg on public.biz_products;
create trigger biz_products_derive_trg
  before insert or update on public.biz_products
  for each row execute function public.biz_products_derive();

-- ─── Les sessions de caisse ────────────────────────────────────────────────
-- Une ligne par session. `auth_user_id` est posé PAR LA BASE (auth.uid()), pas
-- par l'application : c'est ce qui rend impossible d'ouvrir une session au nom
-- de quelqu'un d'autre, même en trafiquant la requête.
create table if not exists public.biz_sessions (
  id             text primary key,
  module_key     text not null,
  ref            text,
  worker_id      text,
  worker_name    text not null default '',
  opening_cash   numeric default 0,
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  closing_cash   numeric,
  status         text not null default 'open',
  notes          text,
  theoretical    numeric,
  credit         numeric,
  decalage       numeric,
  auth_user_id   uuid default auth.uid() references auth.users(id) on delete set null,
  opened_by_id   text,
  opened_by_name text,
  closed_by_id   text,
  closed_by_name text,
  created_at     timestamptz default now()
);

create index if not exists biz_sessions_module_idx on public.biz_sessions(module_key);
create index if not exists biz_sessions_open_idx   on public.biz_sessions(status) where status = 'open';

-- Un employé ne peut tenir qu'UNE session ouverte à la fois. La contrainte est
-- ici plutôt que dans l'application : une double ouverture depuis deux
-- navigateurs fausserait le décalage de fin de service, et l'écran ne peut pas
-- voir ce que fait l'autre onglet.
create unique index if not exists biz_sessions_one_open_per_worker
  on public.biz_sessions(module_key, worker_id)
  where status = 'open' and worker_id is not null;

-- ─── La caisse générale ────────────────────────────────────────────────────
-- Le coffre AU-DESSUS des cafétérias. `cafeteria_id` + `linked_tx_id` portent
-- les transferts : une remontée de fonds est UNE opération vue des deux côtés,
-- jamais deux saisies indépendantes qui finiraient par diverger.
create table if not exists public.general_cash (
  id              text primary key,
  kind            text not null check (kind in ('deposit','withdraw','transfer_in','transfer_out','expense')),
  amount          numeric not null default 0,
  date            timestamptz not null default now(),
  label           text not null default '',
  category        text,
  cafeteria_id    text,
  linked_tx_id    text,
  notes           text,
  created_by_name text,
  created_at      timestamptz default now()
);

create index if not exists general_cash_date_idx      on public.general_cash(date desc);
create index if not exists general_cash_cafeteria_idx on public.general_cash(cafeteria_id);

-- ─── Le journal ────────────────────────────────────────────────────────────
create table if not exists public.activity_log (
  id        text primary key,
  timestamp timestamptz not null default now(),
  user_id   text,
  action    text,
  details   text
);

create index if not exists activity_log_time_idx on public.activity_log(timestamp desc);

-- ═══════════════════════════════════════════════════════════════════════════
--  2. BUCKETS DE STOCKAGE (images)
-- ═══════════════════════════════════════════════════════════════════════════
--  Tous PUBLICS en lecture : une photo de produit s'affiche au point de vente
--  et sur un ticket, il n'y a rien de confidentiel dedans, et un bucket privé
--  imposerait de signer chaque URL à chaque rendu de grille.
--  L'ÉCRITURE, elle, est réservée aux comptes connectés (voir les règles plus
--  bas) : personne ne dépose de fichier sans être authentifié.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('store-logos',      'store-logos',      true, 5242880,  array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('product-images',   'product-images',   true, 5242880,  array['image/png','image/jpeg','image/webp']),
  ('worker-photos',    'worker-photos',    true, 5242880,  array['image/png','image/jpeg','image/webp']),
  ('purchase-docs',    'purchase-docs',    true, 10485760, array['image/png','image/jpeg','image/webp','application/pdf']),
  ('expense-receipts', 'expense-receipts', true, 10485760, array['image/png','image/jpeg','image/webp','application/pdf']),
  ('client-receipts',  'client-receipts',  true, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Les règles du stockage. `drop policy if exists` avant chaque création : le
-- script doit pouvoir être rejoué sans erreur.
drop policy if exists "altech lecture publique" on storage.objects;
create policy "altech lecture publique"
  on storage.objects for select
  using (bucket_id in ('store-logos','product-images','worker-photos','purchase-docs','expense-receipts','client-receipts'));

drop policy if exists "altech depot authentifie" on storage.objects;
create policy "altech depot authentifie"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('store-logos','product-images','worker-photos','purchase-docs','expense-receipts','client-receipts'));

drop policy if exists "altech remplacement authentifie" on storage.objects;
create policy "altech remplacement authentifie"
  on storage.objects for update to authenticated
  using (bucket_id in ('store-logos','product-images','worker-photos','purchase-docs','expense-receipts','client-receipts'));

drop policy if exists "altech suppression authentifiee" on storage.objects;
create policy "altech suppression authentifiee"
  on storage.objects for delete to authenticated
  using (bucket_id in ('store-logos','product-images','worker-photos','purchase-docs','expense-receipts','client-receipts'));

-- ═══════════════════════════════════════════════════════════════════════════
--  3. QUI EST CONNECTÉ ?
-- ═══════════════════════════════════════════════════════════════════════════

-- Vrai si le compte connecté est administrateur.
-- SECURITY DEFINER et `search_path` figé : la fonction est appelée DEPUIS les
-- règles RLS, elle doit donc pouvoir lire `admin_profiles` sans être elle-même
-- soumise à une règle — sinon la règle s'appellerait elle-même à l'infini.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.admin_profiles a where a.id = auth.uid());
$$;

-- La cafétéria de l'employé connecté — `null` pour un administrateur.
create or replace function public.my_module_key()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select w.module_key
  from public.module_workers w
  where w.auth_user_id = auth.uid()
  limit 1;
$$;

-- Le rôle du compte connecté : `admin`, `module_worker`, ou `null`.
-- Un compte sans rôle N'ENTRE PAS : la page de connexion refuse l'accès
-- plutôt que d'ouvrir une application vide.
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when exists (select 1 from public.admin_profiles a where a.id = auth.uid()) then 'admin'
    when exists (select 1 from public.module_workers w where w.auth_user_id = auth.uid()) then 'module_worker'
    else null
  end;
$$;

-- La fiche de l'employé connecté : sa cafétéria et ses permissions, en un seul
-- aller-retour, avant même que l'application ait chargé le reste.
create or replace function public.get_my_module_worker()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select to_jsonb(w) from public.module_workers w
  where w.auth_user_id = auth.uid()
  limit 1;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  4. COMPTES : CRÉATION DEPUIS L'APPLICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ─── POURQUOI CES FONCTIONS EXISTENT ────────────────────────────────────
--  `supabase.auth.signUp()` envoie un e-mail de confirmation et ne permet pas
--  de créer un compte POUR quelqu'un d'autre. Or ici :
--    • le premier administrateur doit pouvoir entrer TOUT DE SUITE, sur une
--      base neuve, sans boîte mail configurée ;
--    • un employé de comptoir n'a souvent pas d'adresse e-mail, et c'est le
--      gérant qui lui crée son accès.
--
--  Ces fonctions écrivent donc directement dans `auth.users`, avec l'e-mail
--  déjà confirmé et le mot de passe haché par `crypt()` — exactement le format
--  que GoTrue attend. Les comptes créés se connectent immédiatement, par la
--  page de connexion normale.
--
--  ⚠ Elles sont SECURITY DEFINER : chacune vérifie elle-même qui a le droit de
--  l'appeler. `create_admin_account` refuse dès qu'un administrateur existe ;
--  `provision_module_worker_account` exige d'être administrateur.

-- L'e-mail interne d'un compte sans adresse réelle. Le domaine `.invalid` est
-- réservé par la RFC 2606 : aucun message ne partira jamais vers lui par
-- accident.
create or replace function public.internal_email(p_username text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_username, ''), '[^a-zA-Z0-9._-]', '', 'g')) || '@altech-cafeteria.invalid';
$$;

-- Y a-t-il DÉJÀ un administrateur ? C'est cette réponse qui fait disparaître le
-- bouton « Créer un compte administrateur » de la page de connexion.
create or replace function public.admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.admin_profiles);
$$;

-- Résout un nom d'utilisateur en adresse e-mail, pour se connecter sans avoir
-- à taper l'e-mail. Ne renvoie QUE l'adresse : aucune autre donnée du compte
-- ne sort d'ici.
create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select u.email from public.admin_profiles a
       join auth.users u on u.id = a.id
      where lower(a.username) = lower(p_username) limit 1),
    (select u.email from public.module_workers w
       join auth.users u on u.id = w.auth_user_id
      where lower(w.username) = lower(p_username) limit 1)
  );
$$;

-- ─── Le PREMIER administrateur ─────────────────────────────────────────────
-- Appelable par n'importe qui — y compris un visiteur non connecté — mais UNE
-- SEULE FOIS. Dès qu'une ligne existe dans `admin_profiles`, la fonction
-- refuse : sans ce verrou, toute personne connaissant l'adresse de
-- l'application pourrait s'octroyer un compte administrateur.
create or replace function public.create_admin_account(
  p_name text,
  p_username text,
  p_email text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid   uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user  text := lower(trim(coalesce(p_username, '')));
begin
  if exists (select 1 from public.admin_profiles) then
    return jsonb_build_object('ok', false, 'error',
      'Un administrateur existe déjà. Connectez-vous, ou demandez-lui de créer votre compte.');
  end if;

  if v_user !~ '^[a-z0-9._-]{3,32}$' then
    return jsonb_build_object('ok', false, 'error',
      'Nom d''utilisateur invalide (3 à 32 caractères : lettres, chiffres, . _ -).');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'Adresse e-mail invalide.');
  end if;
  if length(coalesce(p_password, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'Mot de passe : 6 caractères minimum.');
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'Cette adresse e-mail est déjà utilisée.');
  end if;

  -- `email_confirmed_at` est posé tout de suite : le compte est utilisable
  -- sans passer par un lien reçu par e-mail, ce qui n'aurait aucun sens sur
  -- une installation où la messagerie n'est pas encore configurée.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('name', p_name, 'username', v_user),
    '', '', '', ''
  );

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email),
          'email', now(), now(), now());

  insert into public.admin_profiles (id, name, username, email, role)
  values (v_uid, coalesce(nullif(trim(p_name), ''), v_user), v_user, v_email, 'admin');

  -- La ligne de réglages est créée avec lui : l'application n'a jamais à
  -- gérer le cas « aucun réglage n'existe encore ».
  insert into public.store_settings (id, name)
  values ('settings-1', 'Altech Cafétéria')
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'user_id', v_uid);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- ─── Les comptes d'employés ────────────────────────────────────────────────
-- Trois actions en une fonction, parce qu'elles partagent toutes le même
-- contrôle d'accès et la même ligne `module_workers` :
--   • `create`          — crée le compte auth ET la fiche employé ;
--   • `update_password` — change le mot de passe, met la fiche à jour ;
--   • `delete`          — supprime le compte auth, garde la fiche (son
--                         historique de paie ne doit pas disparaître avec
--                         son accès).
create or replace function public.provision_module_worker_account(
  p_action text,
  p_module_key text,
  p_worker_id text,
  p_username text default null,
  p_password text default null,
  p_name text default null,
  p_email text default null,
  p_role_name text default null,
  p_phone text default null,
  p_permissions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid      uuid;
  v_existing uuid;
  v_email    text;
  v_user     text := lower(trim(coalesce(p_username, '')));
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error',
      'Seul un administrateur peut créer ou modifier un compte d''employé.');
  end if;

  select auth_user_id into v_existing from public.module_workers where id = p_worker_id;

  -- ── Suppression du compte ────────────────────────────────────────────
  if p_action = 'delete' then
    if v_existing is not null then
      delete from auth.users where id = v_existing;
    end if;
    update public.module_workers
       set auth_user_id = null, has_account = false, updated_at = now()
     where id = p_worker_id;
    return jsonb_build_object('ok', true);
  end if;

  if v_user !~ '^[a-z0-9._-]{3,32}$' then
    return jsonb_build_object('ok', false, 'error',
      'Identifiant invalide (3 à 32 caractères : lettres, chiffres, . _ -).');
  end if;

  -- Un employé n'a souvent pas d'adresse e-mail : on lui en fabrique une,
  -- interne, qui ne sert qu'à GoTrue. Il se connectera avec son identifiant.
  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is null then
    v_email := public.internal_email(v_user);
  end if;

  -- ── Changement de mot de passe ───────────────────────────────────────
  if p_action = 'update_password' and v_existing is not null then
    if p_password is not null and length(p_password) >= 6 then
      update auth.users
         set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
             updated_at = now()
       where id = v_existing;
    end if;
    update public.module_workers
       set module_key = p_module_key,
           name = coalesce(nullif(trim(p_name), ''), name),
           role_name = coalesce(p_role_name, role_name),
           phone = coalesce(p_phone, phone),
           username = v_user,
           email = v_email,
           has_account = true,
           updated_at = now()
     where id = p_worker_id;
    return jsonb_build_object('ok', true, 'auth_user_id', v_existing);
  end if;

  -- ── Création ─────────────────────────────────────────────────────────
  if length(coalesce(p_password, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'Mot de passe : 6 caractères minimum.');
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return jsonb_build_object('ok', false, 'error',
      'Cet identifiant (ou cette adresse) est déjà pris par un autre compte.');
  end if;

  v_uid := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('name', p_name, 'username', v_user, 'module_key', p_module_key),
    '', '', '', ''
  );

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email),
          'email', now(), now(), now());

  insert into public.module_workers (id, module_key, name, role_name, phone, email, username, auth_user_id, has_account, permissions)
  values (p_worker_id, p_module_key, coalesce(nullif(trim(p_name), ''), v_user),
          p_role_name, p_phone, v_email, v_user, v_uid, true, coalesce(p_permissions, '{}'::jsonb))
  on conflict (id) do update
    set module_key   = excluded.module_key,
        name         = excluded.name,
        role_name    = excluded.role_name,
        phone        = excluded.phone,
        email        = excluded.email,
        username     = excluded.username,
        auth_user_id = excluded.auth_user_id,
        has_account  = true,
        permissions  = excluded.permissions,
        updated_at   = now();

  return jsonb_build_object('ok', true, 'auth_user_id', v_uid);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Les permissions d'un employé, côté serveur : elles s'appliquent DÈS sa
-- connexion, sans attendre que l'application ait chargé l'état partagé.
create or replace function public.save_module_worker_permissions(
  p_worker_id text,
  p_permissions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Réservé à l''administrateur.');
  end if;
  update public.module_workers
     set permissions = coalesce(p_permissions, '{}'::jsonb), updated_at = now()
   where id = p_worker_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  5. L'ÉCRITURE DE L'ÉTAT PARTAGÉ
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ─── LE CONTRÔLE DE RÉVISION, ET POURQUOI IL EST INDISPENSABLE ──────────
--  Deux caissiers travaillent en même temps. Chacun a en mémoire une copie de
--  l'état. Sans contrôle, le dernier qui enregistre écrase le travail de
--  l'autre : le produit créé il y a trois minutes disparaît, la vente
--  encaissée aussi.
--
--  Cette fonction refuse toute écriture bâtie sur une version périmée et REND
--  la version courante. L'application la fusionne ligne par ligne (horodatage
--  le plus récent par ligne) puis rejoue. Rien ne se perd, et personne n'a
--  besoin de se coordonner.
create or replace function public.biz_store_save(
  p_id text,
  p_state jsonb,
  p_base_rev bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_current bigint;
  v_new     bigint;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Non authentifié.');
  end if;

  select rev into v_current from public.biz_store where id = p_id for update;

  -- Première écriture : la ligne n'existe pas encore.
  if v_current is null then
    insert into public.biz_store (id, state, rev, updated_at, updated_by)
    values (p_id, p_state, 1, now(), auth.uid());
    insert into public.biz_store_meta (id, rev, updated_at) values (p_id, 1, now())
      on conflict (id) do update set rev = 1, updated_at = now();
    return jsonb_build_object('ok', true, 'rev', 1);
  end if;

  -- Quelqu'un a écrit entre-temps : on REND sa version, l'appelant fusionne.
  -- `p_base_rev` à null vient d'un poste qui n'a pas encore lu la ligne : on
  -- le laisse écrire, sa propre fusion a déjà eu lieu côté application.
  if p_base_rev is not null and p_base_rev <> v_current then
    return jsonb_build_object(
      'ok', false, 'conflict', true,
      'rev', v_current,
      'state', (select state from public.biz_store where id = p_id)
    );
  end if;

  v_new := v_current + 1;
  update public.biz_store
     set state = p_state, rev = v_new, updated_at = now(), updated_by = auth.uid()
   where id = p_id;

  -- La notification temps réel part de la table LÉGÈRE : les autres postes
  -- apprennent qu'il y a du nouveau sans recevoir tout le blob.
  insert into public.biz_store_meta (id, rev, updated_at) values (p_id, v_new, now())
    on conflict (id) do update set rev = v_new, updated_at = now();

  return jsonb_build_object('ok', true, 'rev', v_new);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  6. RLS — QUI PEUT LIRE ET ÉCRIRE QUOI
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Le principe tient en une phrase : L'ADMINISTRATEUR VOIT TOUT, L'EMPLOYÉ NE
--  VOIT QUE SA CAFÉTÉRIA.
--
--  Sur les tables qui portent une colonne `module_key` (produits, sessions),
--  la règle est stricte et vérifiable par la base elle-même.
--
--  L'état partagé `biz_store`, lui, est UN SEUL document JSON : Postgres ne
--  peut pas en filtrer une partie par ligne. Le cloisonnement des employés y
--  est donc appliqué par l'application (barre latérale, gardes de route,
--  `useBizPermission`), et la base se contente d'exiger un compte connecté.
--  C'est une limite ASSUMÉE du modèle : elle protège des accès extérieurs,
--  pas d'un employé qui lirait le trafic réseau de son propre poste.

alter table public.store_settings  enable row level security;
alter table public.admin_profiles  enable row level security;
alter table public.module_workers  enable row level security;
alter table public.biz_store       enable row level security;
alter table public.biz_store_meta  enable row level security;
alter table public.biz_products    enable row level security;
alter table public.biz_sessions    enable row level security;
alter table public.general_cash    enable row level security;
alter table public.activity_log    enable row level security;

-- ─── Réglages de l'enseigne ────────────────────────────────────────────────
-- Tout le monde les LIT (le nom et le logo s'affichent sur la page de
-- connexion, avant toute authentification). Seul l'administrateur les écrit.
drop policy if exists "settings lecture" on public.store_settings;
create policy "settings lecture" on public.store_settings for select using (true);

drop policy if exists "settings ecriture admin" on public.store_settings;
create policy "settings ecriture admin" on public.store_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── Profils administrateurs ───────────────────────────────────────────────
drop policy if exists "admin profil lecture" on public.admin_profiles;
create policy "admin profil lecture" on public.admin_profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "admin profil ecriture" on public.admin_profiles;
create policy "admin profil ecriture" on public.admin_profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ─── Employés ──────────────────────────────────────────────────────────────
-- Un employé ne lit QUE sa propre fiche : la liste du personnel des autres
-- comptoirs — avec leurs salaires — ne doit jamais lui parvenir.
drop policy if exists "employes lecture" on public.module_workers;
create policy "employes lecture" on public.module_workers
  for select to authenticated using (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists "employes ecriture admin" on public.module_workers;
create policy "employes ecriture admin" on public.module_workers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── État partagé ──────────────────────────────────────────────────────────
drop policy if exists "etat lecture" on public.biz_store;
create policy "etat lecture" on public.biz_store for select to authenticated using (true);

drop policy if exists "etat ecriture" on public.biz_store;
create policy "etat ecriture" on public.biz_store
  for all to authenticated using (true) with check (true);

drop policy if exists "etat meta lecture" on public.biz_store_meta;
create policy "etat meta lecture" on public.biz_store_meta for select to authenticated using (true);

drop policy if exists "etat meta ecriture" on public.biz_store_meta;
create policy "etat meta ecriture" on public.biz_store_meta
  for all to authenticated using (true) with check (true);

-- ─── Catalogue ─────────────────────────────────────────────────────────────
-- Ici la base peut vraiment cloisonner : un employé ne lit et n'écrit que les
-- produits de SA cafétéria, quoi que fasse l'application.
drop policy if exists "produits lecture" on public.biz_products;
create policy "produits lecture" on public.biz_products
  for select to authenticated
  using (public.is_admin() or module_key = public.my_module_key());

drop policy if exists "produits ecriture" on public.biz_products;
create policy "produits ecriture" on public.biz_products
  for all to authenticated
  using (public.is_admin() or module_key = public.my_module_key())
  with check (public.is_admin() or module_key = public.my_module_key());

-- ─── Sessions de caisse ────────────────────────────────────────────────────
-- Un employé VOIT les sessions de sa cafétéria (savoir qu'un collègue a laissé
-- la sienne ouverte est utile), mais n'en MODIFIE que les siennes.
-- L'administrateur, lui, peut clôturer une session oubliée.
drop policy if exists "sessions lecture" on public.biz_sessions;
create policy "sessions lecture" on public.biz_sessions
  for select to authenticated
  using (public.is_admin() or module_key = public.my_module_key());

drop policy if exists "sessions creation" on public.biz_sessions;
create policy "sessions creation" on public.biz_sessions
  for insert to authenticated
  with check (public.is_admin() or module_key = public.my_module_key());

drop policy if exists "sessions modification" on public.biz_sessions;
create policy "sessions modification" on public.biz_sessions
  for update to authenticated
  using (public.is_admin() or auth_user_id = auth.uid())
  with check (public.is_admin() or auth_user_id = auth.uid());

drop policy if exists "sessions suppression admin" on public.biz_sessions;
create policy "sessions suppression admin" on public.biz_sessions
  for delete to authenticated using (public.is_admin());

-- ─── Caisse générale ───────────────────────────────────────────────────────
-- Le coffre de l'enseigne est une affaire d'administrateur. Un employé peut
-- toutefois y écrire la CONTREPARTIE d'une remontée de fonds de sa propre
-- cafétéria : sans cela, il ne pourrait pas remettre sa recette au coffre.
drop policy if exists "coffre lecture admin" on public.general_cash;
create policy "coffre lecture admin" on public.general_cash
  for select to authenticated
  using (public.is_admin() or cafeteria_id = public.my_module_key());

drop policy if exists "coffre creation" on public.general_cash;
create policy "coffre creation" on public.general_cash
  for insert to authenticated
  with check (public.is_admin() or cafeteria_id = public.my_module_key());

drop policy if exists "coffre modification admin" on public.general_cash;
create policy "coffre modification admin" on public.general_cash
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "coffre suppression admin" on public.general_cash;
create policy "coffre suppression admin" on public.general_cash
  for delete to authenticated using (public.is_admin());

-- ─── Journal ───────────────────────────────────────────────────────────────
drop policy if exists "journal lecture admin" on public.activity_log;
create policy "journal lecture admin" on public.activity_log
  for select to authenticated using (public.is_admin());

drop policy if exists "journal ecriture" on public.activity_log;
create policy "journal ecriture" on public.activity_log
  for insert to authenticated with check (true);

-- ═══════════════════════════════════════════════════════════════════════════
--  7. TEMPS RÉEL
-- ═══════════════════════════════════════════════════════════════════════════
--  Ce que les autres postes doivent apprendre sans recharger la page.
--  `biz_store` n'y est PAS : c'est `biz_store_meta` qui annonce les
--  changements, avec quelques octets au lieu de plusieurs centaines de Ko.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['biz_store_meta','biz_products','biz_sessions','general_cash']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;   -- déjà publiée, le script est rejouable
    end;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  8. DROITS D'EXÉCUTION
-- ═══════════════════════════════════════════════════════════════════════════
--  `anon` n'obtient que le strict nécessaire à la page de connexion :
--  savoir si un administrateur existe, en créer un s'il n'y en a pas, et
--  résoudre un nom d'utilisateur en adresse e-mail.

grant execute on function public.admin_exists()                to anon, authenticated;
grant execute on function public.create_admin_account(text, text, text, text) to anon, authenticated;
grant execute on function public.email_for_username(text)      to anon, authenticated;

grant execute on function public.get_my_role()                 to authenticated;
grant execute on function public.get_my_module_worker()        to authenticated;
grant execute on function public.is_admin()                    to authenticated;
grant execute on function public.my_module_key()               to authenticated;
grant execute on function public.biz_store_save(text, jsonb, bigint) to authenticated;
grant execute on function public.save_module_worker_permissions(text, jsonb) to authenticated;
grant execute on function public.provision_module_worker_account(
  text, text, text, text, text, text, text, text, text, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
--  9. AMORÇAGE
-- ═══════════════════════════════════════════════════════════════════════════
--  La ligne de réglages et l'état de départ, pour que l'application n'ait
--  jamais à gérer le cas « rien n'existe encore ».
--
--  L'état contient UNE cafétéria, vide. Les suivantes se créent dans
--  Réglages → Cafétérias, et chacune arrive avec tous ses écrans.

insert into public.store_settings (id, name, product_categories, expense_categories, product_units)
values (
  'settings-1',
  'Altech Cafétéria',
  '["Boissons chaudes","Boissons fraîches","Viennoiserie","Pâtisserie","Snacks","Épicerie"]'::jsonb,
  '["Salaires","Loyer","Électricité","Eau","Gaz","Entretien","Fournitures","Impôts","Divers"]'::jsonb,
  '["Pièce","Tasse","Litre","Kg","Carton","Pack","Bouteille"]'::jsonb
)
on conflict (id) do nothing;

insert into public.biz_store (id, state, rev)
values (
  'cafeteria-v1',
  jsonb_build_object(
    'cafeterias', jsonb_build_array(
      jsonb_build_object(
        'id', 'cafeteria',
        'name', 'Cafétéria principale',
        'short', 'Principale',
        'emoji', '☕',
        'color', '#6F4E37',
        'createdAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    ),
    'modules', jsonb_build_object(
      'cafeteria', jsonb_build_object(
        'categories', '[]'::jsonb, 'marques', '[]'::jsonb, 'roles', '[]'::jsonb,
        'products', '[]'::jsonb, 'purchases', '[]'::jsonb, 'sales', '[]'::jsonb,
        'clients', '[]'::jsonb, 'suppliers', '[]'::jsonb, 'workers', '[]'::jsonb,
        'expenses', '[]'::jsonb, 'caisse', '[]'::jsonb, 'productions', '[]'::jsonb,
        'fiches', '[]'::jsonb, 'comptoir', '[]'::jsonb, 'destructions', '[]'::jsonb,
        'sessions', '[]'::jsonb, 'inventaires', '[]'::jsonb, 'posPinned', '[]'::jsonb
      )
    )
  ),
  1
)
on conflict (id) do nothing;

insert into public.biz_store_meta (id, rev) values ('cafeteria-v1', 1)
on conflict (id) do nothing;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  ET MAINTENANT ?
--  ─────────────────────────────────────────────────────────────────────────
--  1. Ouvrez l'application. La page de connexion affiche le bouton
--     « Créer un compte administrateur » — il n'apparaît que tant qu'aucun
--     administrateur n'existe, et disparaît définitivement ensuite.
--  2. Créez ce compte : vous êtes connecté immédiatement, sans e-mail de
--     confirmation à attendre.
--  3. Réglages → Cafétérias : ajoutez vos comptoirs. Chacun arrive complet.
--  4. Employés (dans une cafétéria) : créez leurs accès. Chaque employé se
--     connecte avec son identifiant et ne voit que sa cafétéria.
-- ═══════════════════════════════════════════════════════════════════════════
