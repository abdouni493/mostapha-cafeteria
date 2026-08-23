/**
 * ─── Réglages ──────────────────────────────────────────────────────────────────
 *
 * Quatre écrans, et rien d'autre. Chacun répond à une question précise :
 *
 *  • ENSEIGNE   — qui vous êtes : le nom, le logo, les mentions légales qui
 *    partent sur chaque ticket, et les listes proposées dans les formulaires.
 *  • CAFÉTÉRIAS — combien de comptoirs et lesquels. C'est ICI qu'on ajoute une
 *    cafétéria : elle apparaît alors dans la barre latérale, dans les filtres,
 *    dans les rapports et dans les affectations d'employés, sans autre réglage.
 *  • MON COMPTE — nom, photo, et les identifiants de connexion.
 *  • BASE DE DONNÉES — sauvegarder, restaurer, et savoir où l'on est branché.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Store, Coffee, UserCircle, Database, Save, Plus, Trash2, Pencil, Upload,
  Download, Loader2, Check, AlertTriangle, KeyRound, Mail, AtSign, Lock, Eye, EyeOff,
  Image as ImageIcon, X, ShieldCheck, RefreshCw, HardDriveDownload, HardDriveUpload,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn, newId } from '@/src/lib/utils';
import { useAppState, useAppDispatch, DEFAULT_PRODUCT_UNITS } from '@/src/store/AppContext';
import { useBizAll, useCafeterias, useCafeteriaOps } from '@/src/store/BizContext';
import {
  Cafeteria, CAFETERIA_COLORS, CAFETERIA_EMOJIS, DEFAULT_CAFETERIA_ID,
} from '@/src/lib/bizConfig';
import {
  supabase, uploadFile, BUCKETS, db, probeBackend, BACKEND_STATUS_MESSAGE,
} from '@/src/lib/supabase';
import {
  createFullBackup, restoreBundle, isBackupBundle, bundleToJson, bundleToSql,
  downloadText, fileStamp, BackupBundle, RestoreOutcome,
} from '@/src/lib/backup';
import {
  PageHeader, Tabs, TabPanel, Field, Input, Textarea, Select, Modal, Confirm, Badge,
  money, formatDate,
} from '@/src/components/biz/Kit';

type Tab = 'enseigne' | 'cafeterias' | 'compte' | 'base';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('enseigne');

  return (
    <div className="space-y-6">
      <PageHeader icon={Store} title="Réglages" subtitle="Enseigne, cafétérias, compte et base de données" />

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'enseigne', label: 'Enseigne', icon: Store },
          { id: 'cafeterias', label: 'Cafétérias', icon: Coffee },
          { id: 'compte', label: 'Mon compte', icon: UserCircle },
          { id: 'base', label: 'Base de données', icon: Database },
        ]}
      />

      {/* Le panneau glisse d'un onglet a l'autre : le sens du mouvement dit
          qu'on a change de vue, pas que la page a recharge. */}
      <TabPanel tabKey={tab}>
        {tab === 'enseigne' && <StoreTab />}
        {tab === 'cafeterias' && <CafeteriasTab />}
        {tab === 'compte' && <AccountTab />}
        {tab === 'base' && <DatabaseTab />}
      </TabPanel>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ENSEIGNE
// ══════════════════════════════════════════════════════════════════════════════

function StoreTab() {
  const { settings } = useAppState();
  const dispatch = useAppDispatch();
  const [f, setF] = useState(settings);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setF(settings); }, [settings]);

  const set = (k: keyof typeof settings, v: any) => setF(p => ({ ...p, [k]: v }));

  const save = () => {
    dispatch({ type: 'SET_SETTINGS', payload: f });
    toast.success('Réglages enregistrés');
  };

  const pickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const url = await uploadFile(BUCKETS.STORE_LOGOS, `logo-${Date.now()}.${ext}`, file);
      if (url) {
        set('logoUrl', url);
        // L'envoi part tout de suite : un logo choisi puis oublié avant de
        // cliquer « Enregistrer » ne servirait à rien.
        dispatch({ type: 'SET_SETTINGS', payload: { ...f, logoUrl: url } });
        toast.success('Logo mis à jour');
      } else {
        toast.error("Le logo n'a pas pu être envoyé — vérifiez le bucket `store-logos`.");
      }
    } finally {
      setUploading(false);
    }
  };

  /** Une liste de choix (catégories, unités) éditée comme du texte, une par ligne. */
  const ListEditor = ({ label, hint, value, onChange }: {
    label: string; hint: string; value: string[]; onChange: (v: string[]) => void;
  }) => (
    <Field label={label} hint={hint}>
      <Textarea
        rows={5}
        value={(value || []).join('\n')}
        onChange={e => onChange(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
      />
    </Field>
  );

  return (
    <div className="space-y-5">
      <Card title="Identité de l'enseigne"
        hint="Ce nom et ce logo apparaissent sur l'écran de connexion, dans la barre latérale et en tête de chaque ticket.">
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex flex-col items-center gap-2">
            <div className="w-24 h-24 rounded-2xl overflow-hidden flex items-center justify-center border-2 border-[#EFE5DA]"
              style={{ background: f.logoUrl ? '#fff' : 'var(--grad-caramel)' }}>
              {f.logoUrl
                ? <img src={f.logoUrl} alt="" className="w-full h-full object-cover" />
                : <Coffee className="w-9 h-9 text-[#2B1B12]" />}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickLogo} />
            <button className="btn-ghost text-[11px]" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {f.logoUrl ? 'Changer' : 'Ajouter un logo'}
            </button>
            {f.logoUrl && (
              <button className="text-[10.5px] text-red-500 hover:underline" onClick={() => set('logoUrl', undefined)}>
                Retirer
              </button>
            )}
          </div>

          <div className="flex-1 min-w-[16rem] grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Field label="Nom de l'enseigne" required>
                <Input value={f.name || ''} onChange={e => set('name', e.target.value)} placeholder="Altech Cafétéria" />
              </Field>
            </div>
            <Field label="Téléphone"><Input value={f.phone || ''} onChange={e => set('phone', e.target.value)} /></Field>
            <Field label="E-mail"><Input type="email" value={f.email || ''} onChange={e => set('email', e.target.value)} /></Field>
            <div className="sm:col-span-2">
              <Field label="Adresse"><Textarea rows={2} value={f.address || ''} onChange={e => set('address', e.target.value)} /></Field>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Mentions légales"
        hint="Elles sont imprimées en pied de facture. Laissez vide ce que vous n'avez pas.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="NIF / Identifiant fiscal"><Input value={f.fiscalId || ''} onChange={e => set('fiscalId', e.target.value)} /></Field>
          <Field label="Registre de commerce"><Input value={f.rc || ''} onChange={e => set('rc', e.target.value)} /></Field>
          <Field label="Article d'imposition"><Input value={f.ai || ''} onChange={e => set('ai', e.target.value)} /></Field>
          <Field label="NIS"><Input value={f.nis || ''} onChange={e => set('nis', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="Devise affichée"><Input value={f.currency || 'DA'} onChange={e => set('currency', e.target.value)} /></Field>
          <Field label="Pied de ticket" hint="Le mot de la fin sur chaque ticket de caisse.">
            <Input value={f.ticketFooter || ''} onChange={e => set('ticketFooter', e.target.value)} placeholder="Merci de votre visite !" />
          </Field>
        </div>
      </Card>

      <Card title="Listes proposées dans les formulaires"
        hint="Une valeur par ligne. Ce sont les choix qui s'offrent à la saisie — jamais une contrainte : un produit peut toujours porter une catégorie qui n'est pas dans la liste.">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ListEditor label="Catégories de produits" hint="Boissons chaudes, viennoiserie…"
            value={f.productCategories} onChange={v => set('productCategories', v)} />
          <ListEditor label="Catégories de dépenses" hint="Loyer, électricité, salaires…"
            value={f.expenseCategories} onChange={v => set('expenseCategories', v)} />
          <ListEditor label="Unités" hint="Pièce, tasse, kg…"
            value={f.productUnits || DEFAULT_PRODUCT_UNITS} onChange={v => set('productUnits', v)} />
        </div>
        <div className="mt-3 max-w-xs">
          <Field label="Seuil d'alerte par défaut" hint="Proposé à la création d'un produit.">
            <Input type="number" value={f.defaultMinQty ?? 5} onChange={e => set('defaultMinQty', Number(e.target.value) || 0)} />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <button className="btn-primary" onClick={save}><Save className="w-4 h-4" /> Enregistrer</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CAFÉTÉRIAS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * L'écran qui donne son sens à toute l'application : ajouter une cafétéria ici,
 * c'est créer un comptoir COMPLET et INDÉPENDANT — son stock, ses achats, ses
 * ventes, ses clients, ses fournisseurs, ses employés, sa caisse et ses
 * rapports. Rien n'est partagé entre deux cafétérias, hormis l'enseigne et la
 * caisse générale.
 */
function CafeteriasTab() {
  const cafeterias = useCafeterias();
  const biz = useBizAll();
  const ops = useCafeteriaOps();
  const [form, setForm] = useState<Cafeteria | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Cafeteria | null>(null);
  const [busy, setBusy] = useState(false);

  /** Ce qu'une cafétéria contient — le chiffre qui rend une suppression grave. */
  const weightOf = (id: string) => {
    const m = biz.modules[id];
    if (!m) return { products: 0, sales: 0, workers: 0, clients: 0 };
    return {
      products: m.products.length,
      sales: m.sales.length,
      workers: m.workers.length,
      clients: m.clients.length,
    };
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    const res = await ops.remove(toDelete.id);
    setBusy(false);
    if (res.ok) toast.success(`« ${toDelete.name} » supprimée`);
    else toast.error(`Suppression non enregistrée : ${res.error}`);
    setToDelete(null);
  };

  return (
    <div className="space-y-5">
      <Card title="Vos cafétérias"
        hint="Chaque cafétéria est une activité complète et séparée. Un employé rattaché à l'une ne voit jamais les autres."
        action={<button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvelle cafétéria</button>}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {cafeterias.map(c => {
            const w = weightOf(c.id);
            return (
              <div key={c.id} className="caf-tint rounded-2xl border border-[#EFE5DA] bg-white p-4"
                style={{ ['--caf-color' as any]: c.color || '#6F4E37' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                      style={{ background: `${c.color || '#6F4E37'}22`, border: `1px solid ${c.color || '#6F4E37'}55` }}>
                      {c.emoji || '☕'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-black text-[#2A2018] truncate">{c.name}</p>
                      <p className="text-[10.5px] text-[#A39588] truncate">
                        {c.short || '—'}{c.address ? ` · ${c.address}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => setForm(c)} title="Modifier"
                      className="p-1.5 rounded-lg text-[#A39588] hover:bg-[#F3EBE2] hover:text-[#6F4E37]">
                      <Pencil size={13} />
                    </button>
                    {cafeterias.length > 1 && (
                      <button onClick={() => setToDelete(c)} title="Supprimer"
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 mt-3">
                  <Stat label="Produits" value={w.products} />
                  <Stat label="Ventes" value={w.sales} />
                  <Stat label="Employés" value={w.workers} />
                  <Stat label="Clients" value={w.clients} />
                </div>

                {c.archived && (
                  <p className="mt-2 text-[10.5px] font-bold text-amber-700">
                    Archivée — consultable, mais plus proposée à la saisie.
                  </p>
                )}
                {c.id === DEFAULT_CAFETERIA_ID && (
                  <p className="mt-2 text-[10px] text-[#C9B7A5]">Cafétéria d'origine</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {form && (
        <CafeteriaForm
          initial={form === 'new' ? null : form}
          existingIds={cafeterias.map(c => c.id)}
          onClose={() => setForm(null)}
        />
      )}

      <Confirm open={!!toDelete} title="Supprimer cette cafétéria" danger
        confirmLabel="Supprimer définitivement"
        message={toDelete
          ? `« ${toDelete.name} » et TOUTES ses données seront supprimées : `
            + `${weightOf(toDelete.id).products} produit(s), ${weightOf(toDelete.id).sales} vente(s), `
            + `${weightOf(toDelete.id).workers} employé(s), ${weightOf(toDelete.id).clients} client(s).\n\n`
            + "Cette opération est DÉFINITIVE. Si vous voulez seulement cesser d'y saisir, "
            + 'modifiez-la et cochez « Archivée » : ses chiffres restent alors consultables.'
          : ''}
        onConfirm={remove} onCancel={() => setToDelete(null)} />
      {busy && <p className="sr-only">Enregistrement…</p>}
    </div>
  );
}

/** Identifiant technique dérivé du nom : lisible dans l'URL, stable dans la base. */
function slugify(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'cafeteria';
}

function CafeteriaForm({ initial, existingIds, onClose }: {
  initial: Cafeteria | null; existingIds: string[]; onClose: () => void;
}) {
  const ops = useCafeteriaOps();
  const isEdit = !!initial;
  const [f, setF] = useState<Cafeteria>(initial || {
    id: '', name: '', short: '', emoji: '☕', color: CAFETERIA_COLORS[0],
    address: '', phone: '', createdAt: new Date().toISOString(),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Cafeteria, v: any) => setF(p => ({ ...p, [k]: v }));

  /**
   * L'identifiant est calculé à partir du nom et ne change JAMAIS ensuite : il
   * est écrit dans chaque ligne de stock, chaque vente et chaque fiche employé.
   * Le renommer casserait tous ces liens — d'où le champ figé en modification.
   */
  const id = isEdit ? f.id : uniqueId(slugify(f.name), existingIds);

  const save = async () => {
    if (!f.name.trim()) { toast.error('Le nom est requis'); return; }
    setSaving(true);
    const cafeteria: Cafeteria = {
      ...f,
      id,
      name: f.name.trim(),
      short: (f.short || '').trim() || f.name.trim(),
      createdAt: initial?.createdAt || new Date().toISOString(),
    };
    const res = isEdit ? await ops.update(cafeteria) : await ops.create(cafeteria);
    setSaving(false);
    if (!res.ok) { toast.error(`Non enregistré : ${res.error}`); return; }
    toast.success(isEdit
      ? 'Cafétéria modifiée'
      : `« ${cafeteria.name} » créée — elle apparaît dans le menu avec tous ses écrans`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Coffee} size="lg" formScale
      title={isEdit ? 'Modifier la cafétéria' : 'Nouvelle cafétéria'}
      subtitle={isEdit ? f.name : 'Un comptoir complet et indépendant'}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={saving || !f.name.trim()}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {isEdit ? 'Enregistrer' : 'Créer la cafétéria'}
        </button>
      </>}>
      <div className="space-y-4">
        {!isEdit && (
          <div className="rounded-xl border border-[#E7C9A9] bg-[#F5E7D8]/60 px-3.5 py-3 text-[11.5px] text-[#8A5A2B] leading-relaxed">
            Cette cafétéria aura son <b>propre stock</b>, ses <b>propres achats, ventes, clients,
            fournisseurs, employés et sa propre caisse</b>. Rien ne sera partagé avec les autres,
            en dehors de l'enseigne et de la caisse générale.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nom" required>
            <Input value={f.name} onChange={e => set('name', e.target.value)} placeholder="Ex : Cafétéria de la gare" autoFocus />
          </Field>
          <Field label="Nom court" hint="Affiché dans les filtres et les sous-titres.">
            <Input value={f.short || ''} onChange={e => set('short', e.target.value)} placeholder="Gare" />
          </Field>
        </div>

        <Field label="Identifiant" hint={isEdit
          ? "Il ne peut plus changer : chaque produit, vente et employé y est rattaché."
          : "Calculé à partir du nom. Il apparaîtra dans l'adresse des pages."}>
          <Input value={id} disabled readOnly />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Téléphone"><Input value={f.phone || ''} onChange={e => set('phone', e.target.value)} /></Field>
          <Field label="Adresse"><Input value={f.address || ''} onChange={e => set('address', e.target.value)} /></Field>
        </div>

        <Field label="Symbole" hint="Il distingue la cafétéria d'un coup d'œil dans le menu.">
          <div className="flex flex-wrap gap-1.5">
            {CAFETERIA_EMOJIS.map(e => (
              <button key={e} type="button" onClick={() => set('emoji', e)}
                className={cn('w-10 h-10 rounded-xl text-lg transition border-2',
                  f.emoji === e ? 'border-[#B8763E] bg-[#F5E7D8]' : 'border-[#EFE5DA] bg-white hover:border-[#D4A373]')}>
                {e}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Couleur" hint="Elle teinte ses cartes, ses filtres et sa courbe dans les rapports.">
          <div className="flex flex-wrap gap-1.5">
            {CAFETERIA_COLORS.map(c => (
              <button key={c} type="button" onClick={() => set('color', c)}
                className={cn('w-10 h-10 rounded-xl transition border-2 flex items-center justify-center',
                  f.color === c ? 'border-[#2B1B12]' : 'border-transparent')}
                style={{ background: c }}>
                {f.color === c && <Check className="w-4 h-4 text-white" />}
              </button>
            ))}
          </div>
        </Field>

        {isEdit && (
          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-[#EFE5DA] bg-[#FAF6F1] cursor-pointer">
            <input type="checkbox" checked={!!f.archived} onChange={e => set('archived', e.target.checked)}
              className="mt-0.5" />
            <span>
              <span className="block text-[12.5px] font-bold text-[#2A2018]">Archiver cette cafétéria</span>
              <span className="block text-[10.5px] text-[#A39588] leading-relaxed">
                Elle disparaît du menu et des sélecteurs, mais ses chiffres restent
                dans les rapports. C'est l'alternative à la suppression quand on ferme
                un comptoir sans vouloir perdre son historique.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

/** `gare`, puis `gare-2`, `gare-3`… — jamais deux cafétérias sur la même clé. */
function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// MON COMPTE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Le profil de l'administrateur connecté ET ses identifiants de connexion.
 *
 * Les deux sont sur le même écran mais dans DEUX cartes distinctes, parce que ce
 * sont deux opérations de nature différente : changer son nom touche une ligne
 * de la base ; changer son mot de passe touche le compte d'authentification.
 * Les mélanger dans un seul bouton « Enregistrer » a déjà fait réinitialiser des
 * mots de passe par accident.
 */
function AccountTab() {
  const { currentUserId, currentUserName, currentUserAvatarUrl } = useAppState();
  const dispatch = useAppDispatch();

  const [name, setName] = useState(currentUserName || '');
  const [avatar, setAvatar] = useState(currentUserAvatarUrl || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);

  useEffect(() => { setName(currentUserName || ''); setAvatar(currentUserAvatarUrl || ''); },
    [currentUserName, currentUserAvatarUrl]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || ''));
  }, []);

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const url = await uploadFile(BUCKETS.STORE_LOGOS, `avatar-${currentUserId}-${Date.now()}.${ext}`, file);
      if (url) setAvatar(url);
      else toast.error("La photo n'a pas pu être envoyée.");
    } finally { setUploading(false); }
  };

  const saveProfile = async () => {
    if (!currentUserId) return;
    if (!name.trim()) { toast.error('Le nom est requis'); return; }
    setSavingProfile(true);
    try {
      await db.updateAdminProfile(currentUserId, { name: name.trim(), avatar_url: avatar || null });
      dispatch({ type: 'SET_CURRENT_USER', payload: { role: 'admin', id: currentUserId, name: name.trim(), avatarUrl: avatar || undefined } });
      toast.success('Profil enregistré');
    } catch (err: any) {
      toast.error(`Profil non enregistré : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const saveAuth = async () => {
    if (password && password.length < 6) { toast.error('Mot de passe : 6 caractères minimum'); return; }
    if (password && password !== confirm) { toast.error('Les deux mots de passe ne correspondent pas'); return; }
    if (!password && !email.trim()) { toast.error('Rien à modifier'); return; }

    setSavingAuth(true);
    const patch: { email?: string; password?: string } = {};
    if (email.trim()) patch.email = email.trim();
    if (password) patch.password = password;
    const { error } = await supabase.auth.updateUser(patch);
    setSavingAuth(false);

    if (error) { toast.error(`Non modifié : ${error.message}`); return; }
    setPassword(''); setConfirm('');
    toast.success(password
      ? 'Mot de passe modifié — il sera demandé à la prochaine connexion'
      : 'Adresse e-mail modifiée');
  };

  return (
    <div className="space-y-5">
      <Card title="Informations personnelles" hint="Votre nom et votre photo s'affichent en bas du menu.">
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex flex-col items-center gap-2">
            <div className="w-24 h-24 rounded-2xl overflow-hidden flex items-center justify-center border-2 border-[#EFE5DA]"
              style={{ background: avatar ? '#fff' : 'var(--grad-coffee)' }}>
              {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" />
                : <UserCircle className="w-10 h-10 text-[#D4A373]" />}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
            <button className="btn-ghost text-[11px]" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {avatar ? 'Changer' : 'Ajouter une photo'}
            </button>
          </div>
          <div className="flex-1 min-w-[16rem] space-y-3">
            <Field label="Nom complet" required>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Votre nom" />
            </Field>
            <button className="btn-primary" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer le profil
            </button>
          </div>
        </div>
      </Card>

      <Card title="Connexion"
        hint="L'adresse e-mail et le mot de passe qui ouvrent l'application. Laissez le mot de passe vide pour ne changer que l'e-mail.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <div className="sm:col-span-2">
            <Field label="Adresse e-mail">
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
          </div>
          <Field label="Nouveau mot de passe">
            <div className="relative">
              <Input type={showPass ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)} placeholder="6 caractères minimum" autoComplete="new-password" />
              <button type="button" onClick={() => setShowPass(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C9B7A5] hover:text-[#6F4E37]">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirmer">
            <Input type={showPass ? 'text' : 'password'} value={confirm}
              onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <button className="btn-primary mt-4" onClick={saveAuth} disabled={savingAuth}>
          {savingAuth ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          Mettre à jour la connexion
        </button>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BASE DE DONNÉES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ─── LA RÈGLE DE LA RESTAURATION ──────────────────────────────────────────────
 * Elle n'EFFACE JAMAIS RIEN. Chaque ligne du fichier est réécrite sur son
 * identifiant ; une ligne présente aujourd'hui mais absente du fichier reste en
 * place. Une restauration ne peut donc pas faire disparaître le travail fait
 * depuis la sauvegarde — au pire elle ramène d'anciennes lignes.
 */
function DatabaseTab() {
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'database' | 'offline'>('idle');
  const [backingUp, setBackingUp] = useState(false);
  const [progress, setProgress] = useState('');
  const [bundle, setBundle] = useState<BackupBundle | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [pending, setPending] = useState<BackupBundle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { settings } = useAppState();

  const projectUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://nijwelszigrghxgtnaqj.supabase.co';

  const check = async () => {
    setStatus('checking');
    const res = await probeBackend();
    setStatus(res);
  };
  useEffect(() => { void check(); }, []);

  const backup = async () => {
    setBackingUp(true);
    setProgress('Lecture de la base…');
    try {
      const b = await createFullBackup({
        stationName: settings.name,
        onProgress: (step, done, total) => setProgress(`${step} (${done + 1}/${total})`),
      });
      setBundle(b);
      toast.success(`Sauvegarde prête — ${b.totals.rows} ligne(s) sur ${b.totals.tables} table(s)`);
    } catch (err: any) {
      toast.error(`Sauvegarde impossible : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setBackingUp(false);
      setProgress('');
    }
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        if (!isBackupBundle(raw)) { toast.error('Ce fichier n\'est pas une sauvegarde de cette application.'); return; }
        setPending(raw);
      } catch {
        toast.error('Fichier illisible.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const restore = async () => {
    if (!pending) return;
    setRestoring(true);
    setProgress('Écriture en base…');
    try {
      const res = await restoreBundle(pending, (step, done, total) => setProgress(`${step} (${done + 1}/${total})`));
      setOutcome(res);
      toast.success(`Restauration terminée — ${res.totalWritten} ligne(s) réécrite(s)`);
    } catch (err: any) {
      toast.error(`Restauration interrompue : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setRestoring(false);
      setProgress('');
      setPending(null);
    }
  };

  const STATUS_UI = {
    idle:     { label: 'Non vérifié', tone: 'neutral' as const },
    checking: { label: 'Vérification…', tone: 'info' as const },
    ok:       { label: 'Connectée', tone: 'success' as const },
    database: { label: 'Base injoignable', tone: 'danger' as const },
    offline:  { label: 'Poste hors ligne', tone: 'danger' as const },
  }[status];

  return (
    <div className="space-y-5">
      <Card title="Connexion à la base" hint="L'application enregistre tout en ligne, en continu.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={STATUS_UI.tone}>{STATUS_UI.label}</Badge>
          <code className="text-[11px] px-2.5 py-1 rounded-lg bg-[#F3EBE2] text-[#7A6A5C] break-all">{projectUrl}</code>
          <button className="btn-ghost text-[11px]" onClick={check} disabled={status === 'checking'}>
            <RefreshCw className={cn('w-3.5 h-3.5', status === 'checking' && 'animate-spin')} /> Revérifier
          </button>
        </div>
        {(status === 'database' || status === 'offline') && (
          <p className="mt-3 text-[11.5px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 leading-relaxed">
            {BACKEND_STATUS_MESSAGE[status]}
          </p>
        )}
      </Card>

      <Card title="Sauvegarder"
        hint="Le fichier contient TOUT : l'enseigne, chaque cafétéria, son stock, ses ventes, ses employés et la caisse générale. Gardez-le hors du poste.">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={backup} disabled={backingUp}>
            {backingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDriveDownload className="w-4 h-4" />}
            Créer une sauvegarde
          </button>
          {bundle && (
            <>
              <button className="btn-secondary"
                onClick={() => downloadText(`altech-cafeteria-${fileStamp()}.json`, bundleToJson(bundle), 'application/json')}>
                <Download className="w-4 h-4" /> Télécharger .json
              </button>
              <button className="btn-outline"
                onClick={() => downloadText(`altech-cafeteria-${fileStamp()}.sql`, bundleToSql(bundle), 'text/plain')}>
                <Download className="w-4 h-4" /> Télécharger .sql
              </button>
            </>
          )}
        </div>
        {progress && <p className="text-[11.5px] text-[#A39588] mt-2">{progress}</p>}

        {bundle && (
          <div className="mt-4 rounded-xl border border-[#EFE5DA] overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className="table-head">Table</th>
                <th className="table-head text-right">Lignes</th>
                <th className="table-head">État</th>
              </tr></thead>
              <tbody>
                {bundle.report.map(r => (
                  <tr key={r.table}>
                    <td className="table-cell">{r.label}</td>
                    <td className="table-cell text-right tabular-nums">{r.rows}</td>
                    <td className="table-cell">
                      {r.missing ? <Badge tone="warning">Absente</Badge>
                        : r.error ? <Badge tone="danger">{r.error}</Badge>
                          : <Badge tone="success">OK</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Restaurer"
        hint="La restauration n'efface jamais rien : elle réécrit les lignes du fichier et laisse en place tout ce qui a été créé depuis.">
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={pickFile} />
        <button className="btn-outline" onClick={() => fileRef.current?.click()} disabled={restoring}>
          <HardDriveUpload className="w-4 h-4" /> Choisir un fichier de sauvegarde
        </button>

        {outcome && (
          <div className="mt-4 rounded-xl border border-[#EFE5DA] overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className="table-head">Table</th>
                <th className="table-head text-right">Réécrites</th>
                <th className="table-head">État</th>
              </tr></thead>
              <tbody>
                {outcome.report.map(r => (
                  <tr key={r.table}>
                    <td className="table-cell">{r.label}</td>
                    <td className="table-cell text-right tabular-nums">{r.written}</td>
                    <td className="table-cell">
                      {r.error ? <Badge tone="danger">{r.error}</Badge> : <Badge tone="success">OK</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Confirm open={!!pending} title="Restaurer cette sauvegarde" danger={false}
        confirmLabel="Restaurer"
        message={pending
          ? `Sauvegarde du ${formatDate(pending.createdAt)}${pending.stationName ? ` — ${pending.stationName}` : ''}.\n`
            + `${pending.totals.rows} ligne(s) sur ${pending.totals.tables} table(s) seront réécrites.\n\n`
            + "Rien ne sera effacé : ce qui a été créé depuis cette sauvegarde reste en place."
          : ''}
        onConfirm={restore} onCancel={() => setPending(null)} />
    </div>
  );
}

// ─── Briques ──────────────────────────────────────────────────────────────────

function Card({ title, hint, action, children }: {
  title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="card-glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621]">{title}</h3>
          {hint && <p className="text-[11px] text-[#A39588] mt-1 leading-relaxed max-w-2xl">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg bg-[#FAF6F1] px-2 py-1.5 text-center">
    <p className="text-[13px] font-black tabular-nums text-[#2A2018]">{value}</p>
    <p className="text-[8.5px] font-black uppercase tracking-wide text-[#A39588]">{label}</p>
  </div>
);
