/**
 * ─── Mon profil ────────────────────────────────────────────────────────────────
 *
 * La seule page que TOUT LE MONDE voit, administrateur comme employé de
 * comptoir. Elle répond à trois questions et s'arrête là :
 *   • qui suis-je dans cette application, et à quelle cafétéria ;
 *   • qu'ai-je le droit d'ouvrir ;
 *   • comment change-t-on mon mot de passe.
 *
 * Elle ne montre AUCUN chiffre d'affaires ni aucune donnée d'une autre
 * cafétéria : un employé qui ouvre son profil ne doit rien y apprendre du
 * comptoir voisin.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  UserCircle, KeyRound, Eye, EyeOff, Loader2, Save, ShieldCheck, Coffee,
  Image as ImageIcon, Check, X, Keyboard, Command,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '@/src/lib/utils';
import { useAppState, useAppDispatch } from '@/src/store/AppContext';
import { useCafeterias } from '@/src/store/BizContext';
import { supabase, uploadFile, BUCKETS, db } from '@/src/lib/supabase';
import { MODULE_INTERFACES, INTERFACE_ACTIONS, getModuleConfig } from '@/src/lib/bizConfig';
import { PageHeader, Field, Input, Badge } from '@/src/components/biz/Kit';

const ACTION_LABEL: Record<string, string> = {
  voir: 'Voir', creer: 'Créer', modifier: 'Modifier', supprimer: 'Supprimer',
};

/** Les raccourcis de l'application, rappelés là où on peut les relire au calme. */
const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Recherche rapide (écran, produit, client…)' },
  { keys: ['Alt', 'V'], label: 'Point de vente' },
  { keys: ['Alt', 'S'], label: 'Gestion de stock' },
  { keys: ['Alt', 'A'], label: 'Achats' },
  { keys: ['Alt', 'C'], label: 'Caisse' },
  { keys: ['Alt', 'R'], label: 'Rapports' },
  { keys: ['Alt', 'B'], label: 'Masquer / afficher le menu' },
  { keys: ['Alt', '1…9'], label: 'Même écran, autre cafétéria' },
];

export default function MySettings() {
  const { currentUserId, currentUserName, currentUserAvatarUrl, currentUserRole, currentModuleWorker } = useAppState();
  const dispatch = useAppDispatch();
  const cafeterias = useCafeterias();
  const isAdmin = currentUserRole !== 'module_worker';

  const [name, setName] = useState(currentUserName || '');
  const [avatar, setAvatar] = useState(currentUserAvatarUrl || '');
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);

  useEffect(() => {
    setName(currentUserName || currentModuleWorker?.name || '');
    setAvatar(currentUserAvatarUrl || '');
  }, [currentUserName, currentUserAvatarUrl, currentModuleWorker]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || ''));
  }, []);

  const myCafeteria = useMemo(
    () => cafeterias.find(c => c.id === currentModuleWorker?.moduleKey) || null,
    [cafeterias, currentModuleWorker]);

  /** Ce qu'on m'a réellement coché — la seule vérité sur mes accès. */
  const grants = useMemo(() => {
    if (isAdmin) return null;
    const p = currentModuleWorker?.permissions || {};
    return MODULE_INTERFACES
      .map(i => ({
        ...i,
        actions: INTERFACE_ACTIONS.filter(a => !!p[`${i.id}.${a}`]),
      }))
      .filter(i => i.actions.includes('voir'));
  }, [isAdmin, currentModuleWorker]);

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const url = await uploadFile(BUCKETS.WORKER_PHOTOS, `me-${currentUserId}-${Date.now()}.${ext}`, file);
      if (url) setAvatar(url);
      else toast.error("La photo n'a pas pu être envoyée.");
    } finally { setUploading(false); }
  };

  const saveProfile = async () => {
    if (!name.trim()) { toast.error('Le nom est requis'); return; }
    setSavingProfile(true);
    try {
      // Seul un administrateur a une ligne dans `admin_profiles`. Pour un
      // employé, la fiche vit dans sa cafétéria : l'écran met à jour ce qui est
      // affiché, et l'administrateur reste le seul à pouvoir renommer un
      // employé pour de bon.
      if (isAdmin && currentUserId) {
        await db.updateAdminProfile(currentUserId, { name: name.trim(), avatar_url: avatar || null });
      }
      dispatch({
        type: 'SET_CURRENT_USER',
        payload: { role: currentUserRole, id: currentUserId, name: name.trim(), avatarUrl: avatar || undefined },
      });
      toast.success('Profil enregistré');
    } catch (err: any) {
      toast.error(`Non enregistré : ${err?.message || 'erreur inconnue'}`);
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
    toast.success(password ? 'Mot de passe modifié' : 'Adresse e-mail modifiée');
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader icon={UserCircle} title="Mon profil" subtitle="Informations personnelles, accès et connexion" />

      {/* ── Qui je suis ─────────────────────────────────────────────── */}
      <section className="card-glass p-5">
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
            <Field label="Nom affiché" required>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Votre nom" />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={isAdmin ? 'primary' : 'info'}>
                {isAdmin ? 'Administrateur' : (currentModuleWorker?.roleName || 'Employé')}
              </Badge>
              {myCafeteria && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-bold text-white"
                  style={{ background: myCafeteria.color || '#6F4E37' }}>
                  {myCafeteria.emoji || '☕'} {myCafeteria.name}
                </span>
              )}
              {isAdmin && (
                <span className="text-[11px] text-[#A39588]">
                  Accès à {cafeterias.length} cafétéria(s)
                </span>
              )}
            </div>

            <button className="btn-primary" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      </section>

      {/* ── Mes accès ───────────────────────────────────────────────── */}
      <section className="card-glass p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-[#8A5A2B]" />
          <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621]">Mes accès</h3>
        </div>

        {isAdmin ? (
          <p className="text-[12.5px] text-[#7A6A5C] leading-relaxed">
            Vous êtes <b>administrateur</b> : toutes les cafétérias, tous les écrans, tous les
            réglages. Vous êtes aussi la seule personne à pouvoir créer des cafétérias et des
            comptes d'employés.
          </p>
        ) : (
          <>
            <p className="text-[12px] text-[#A39588] leading-relaxed mb-3">
              Voici exactement ce que votre administrateur vous a ouvert dans
              <b> {myCafeteria?.name || 'votre cafétéria'}</b>. Les autres cafétérias ne vous sont
              pas accessibles.
            </p>
            {grants && grants.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {grants.map(g => (
                  <div key={g.id} className="rounded-xl border border-[#EFE5DA] bg-white px-3.5 py-2.5">
                    <p className="text-[12.5px] font-bold text-[#2A2018]">{g.label}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {g.actions.map(a => (
                        <span key={a} className="px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wide bg-[#F5E7D8] text-[#8A5A2B]">
                          {ACTION_LABEL[a] || a}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                Aucun écran ne vous a encore été ouvert. Demandez à votre administrateur de
                programmer vos permissions.
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Connexion ───────────────────────────────────────────────── */}
      <section className="card-glass p-5">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-[#8A5A2B]" />
          <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621]">Connexion</h3>
        </div>
        <p className="text-[11px] text-[#A39588] mb-4 leading-relaxed">
          Laissez le mot de passe vide pour ne modifier que l'adresse e-mail.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          Mettre à jour
        </button>
      </section>

      {/* ── Raccourcis ──────────────────────────────────────────────── */}
      <section className="card-glass p-5">
        <div className="flex items-center gap-2 mb-3">
          <Keyboard className="w-4 h-4 text-[#8A5A2B]" />
          <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621]">Raccourcis clavier</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {SHORTCUTS.map(s => (
            <div key={s.label} className="flex items-center justify-between gap-3 py-1.5 border-b border-[#F3EBE2] last:border-b-0">
              <span className="text-[12px] text-[#7A6A5C]">{s.label}</span>
              <span className="flex items-center gap-1 flex-shrink-0">
                {s.keys.map(k => <span key={k} className="kbd">{k}</span>)}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10.5px] text-[#A39588] mt-3 leading-relaxed">
          Les raccourcis <b>Alt</b> sont ignorés pendant une saisie : taper « a » dans un champ
          de recherche ne quitte jamais la page en cours.
        </p>
      </section>
    </div>
  );
}
