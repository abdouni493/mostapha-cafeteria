/**
 * ─── Écran de connexion ────────────────────────────────────────────────────────
 *
 * ─── LA CRÉATION DU PREMIER ADMINISTRATEUR ────────────────────────────────────
 * Une base fraîche ne contient AUCUN compte : sans porte d'entrée, l'application
 * serait inutilisable tant que quelqu'un n'aurait pas créé un utilisateur à la
 * main dans Supabase. D'où le bouton « Créer un compte administrateur ».
 *
 * Il DISPARAÎT dès qu'un administrateur existe, et c'est le point important :
 * s'il restait, n'importe qui tombant sur l'adresse de l'application pourrait
 * s'octroyer un compte administrateur. La question est posée au SERVEUR
 * (`admin_exists()`), pas au navigateur — un indicateur local se contournerait
 * en vidant le cache. La fonction de création refuse elle aussi côté serveur
 * quand un administrateur existe déjà : même si l'écran se trompait, la base ne
 * se tromperait pas.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Coffee, Globe, User, Lock, ArrowRight, ShieldCheck, Zap,
  BarChart3, Clock, Eye, EyeOff, UserPlus, Mail, AtSign, X,
  CheckCircle2, AlertCircle, Store, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  signIn, signUpAdmin, signOut, adminExists, probeBackend, BACKEND_STATUS_MESSAGE,
} from "../lib/supabase";
import { useAppState } from "../store/AppContext";

type UserRole = 'admin' | 'module_worker';
type View = 'login' | 'signup';

interface LoginProps {
  onLogin: (role: UserRole, userId?: string) => void;
}

const features = [
  { icon: Store,     title: "Plusieurs cafétérias",  desc: "Chacune avec son stock, sa caisse et ses employés" },
  { icon: Zap,       title: "Caisse rapide",         desc: "Encaissement au comptoir, code-barres et raccourcis" },
  { icon: BarChart3, title: "Comptabilité claire",   desc: "Marges, dépenses et rapports par période" },
];

const Login = ({ onLogin }: LoginProps) => {
  const { t, i18n } = useTranslation();
  const { settings } = useAppState();
  const brand   = settings?.name?.trim() || 'Altech Cafétéria';
  const logo    = settings?.logoUrl || settings?.logo || null;
  const address = settings?.address || '';

  const [view, setView] = useState<View>('login');

  // ── Connexion ──────────────────────────────────────────────────────────
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Création du compte administrateur ──────────────────────────────────
  const [suName, setSuName] = useState("");
  const [suUsername, setSuUsername] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suConfirm, setSuConfirm] = useState("");
  const [showSuPass, setShowSuPass] = useState(false);
  const [suError, setSuError] = useState<string | null>(null);
  const [suSuccess, setSuSuccess] = useState(false);
  const [suLoading, setSuLoading] = useState(false);

  /**
   * `null` = on ne sait pas encore. On n'affiche le bouton NI dans ce cas NI
   * quand un administrateur existe : montrer puis retirer un bouton d'une
   * demi-seconde à l'autre est un scintillement qui fait douter — et si le
   * serveur ne répond pas, cacher est le choix prudent.
   */
  const [canCreateAdmin, setCanCreateAdmin] = useState<boolean | null>(null);

  const refreshAdminExists = React.useCallback(async () => {
    const exists = await adminExists();
    setCanCreateAdmin(!exists);
    return exists;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const exists = await adminExists();
      if (alive) setCanCreateAdmin(!exists);
    })();
    return () => { alive = false; };
  }, []);

  const toggleLanguage = () => {
    const next = i18n.language === "fr" ? "ar" : "fr";
    i18n.changeLanguage(next);
    document.documentElement.dir = i18n.dir();
  };

  // ── Connexion ──────────────────────────────────────────────────────────
  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoginError(null);

    if (!identifier.trim() || !password.trim()) {
      setLoginError("Renseignez votre identifiant et votre mot de passe.");
      return;
    }

    setLoading(true);
    const result = await signIn(identifier.trim(), password.trim());

    if ('error' in result && result.error) {
      // Seul un vrai refus d'identifiants doit dire « identifiants invalides » :
      // annoncer cela sur une panne réseau envoie l'utilisateur chercher un
      // problème de mot de passe qui n'existe pas.
      if (result.reason === 'rate_limited') {
        setLoading(false);
        setLoginError("Trop de tentatives depuis ce réseau. Patientez une minute puis réessayez.");
        return;
      }
      if (result.reason === 'network') {
        const status = await probeBackend();
        setLoading(false);
        setLoginError(BACKEND_STATUS_MESSAGE[status === 'ok' ? 'database' : status]);
        return;
      }
      setLoading(false);
      setLoginError("Identifiant ou mot de passe incorrect.");
      return;
    }

    const role = (result as any).role as UserRole | null;
    if (!role) {
      // Le mot de passe est bon mais le compte n'est rattaché à rien : ni
      // administrateur, ni employé d'une cafétéria. On refuse plutôt que
      // d'ouvrir une application vide dont on ne saurait pas quoi faire.
      await signOut();
      setLoading(false);
      setLoginError("Accès refusé : ce compte n'est rattaché à aucune cafétéria.");
      return;
    }
    setLoading(false);
    onLogin(role, result.user?.id);
  };

  // ── Création du compte ─────────────────────────────────────────────────
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuError(null);

    if (!suName.trim())     { setSuError("Le nom est requis."); return; }
    if (!suUsername.trim()) { setSuError("Le nom d'utilisateur est requis."); return; }
    if (!/^[a-z0-9._-]{3,}$/i.test(suUsername.trim())) {
      setSuError("Le nom d'utilisateur ne doit contenir que des lettres, chiffres, points, tirets (3 caractères minimum).");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(suEmail.trim())) { setSuError("Adresse e-mail invalide."); return; }
    if (suPassword.length < 6) { setSuError("Le mot de passe doit faire au moins 6 caractères."); return; }
    if (suPassword !== suConfirm) { setSuError("Les deux mots de passe ne correspondent pas."); return; }

    setSuLoading(true);
    const result = await signUpAdmin({
      name: suName.trim(),
      username: suUsername.trim().toLowerCase(),
      email: suEmail.trim().toLowerCase(),
      password: suPassword,
    });

    if ('error' in result && result.error) {
      setSuLoading(false);
      setSuError(result.error);
      // La création a peut-être échoué PARCE QU'un administrateur vient d'être
      // créé ailleurs : on redemande au serveur, ce qui retire le bouton.
      void refreshAdminExists();
      return;
    }

    // Le compte existe : le bouton disparaît pour de bon.
    setCanCreateAdmin(false);
    setSuSuccess(true);

    // Enchaîner sur la connexion évite de retaper ce qui vient d'être saisi.
    const signed = await signIn(suEmail.trim().toLowerCase(), suPassword);
    setSuLoading(false);
    if (!('error' in signed) && (signed as any).role) {
      onLogin((signed as any).role as UserRole, (signed as any).user?.id);
      return;
    }
    // La connexion automatique n'a pas abouti (réseau) : on ramène l'écran de
    // connexion avec l'identifiant pré-rempli, il n'y a plus qu'à valider.
    setIdentifier(suEmail.trim().toLowerCase());
    setTimeout(() => setView('login'), 1400);
  };

  const resetSignup = () => {
    setSuName(""); setSuUsername(""); setSuEmail("");
    setSuPassword(""); setSuConfirm(""); setSuError(null); setSuSuccess(false);
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--cream-100)" }}>

      {/* ══ Panneau gauche ══════════════════════════════════════════════ */}
      <motion.div
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="hidden lg:flex flex-col w-[52%] relative overflow-hidden"
        style={{ background: "linear-gradient(155deg, #1C110B 0%, #2B1B12 32%, #4B3621 68%, #5C4033 100%)" }}
      >
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(212,163,115,0.18), transparent 65%)", transform: "translate(35%,-35%)" }} />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(184,118,62,0.25), transparent 65%)", transform: "translate(-40%,40%)" }} />
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: "linear-gradient(90deg,#D4A373,#B8763E)" }} />

        <div className="relative z-10 p-14 flex flex-col h-full">
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl overflow-hidden"
              style={{ background: "linear-gradient(135deg, #D4A373, #B8763E)", boxShadow: "0 8px 24px rgba(212,163,115,0.45)" }}>
              {logo
                ? <img src={logo} alt="" className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                : <Coffee className="w-7 h-7 text-[#2B1B12]" />}
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight">{brand}</h1>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#D4A373]/80">
                Gestion de cafétéria
              </p>
              {address && <p className="text-[10px] text-white/40 font-medium mt-0.5 truncate max-w-[220px]">{address}</p>}
            </div>
          </motion.div>

          <div className="flex-1 flex flex-col justify-center">
            <motion.div initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
              <p className="text-xs font-black uppercase tracking-[0.22em] mb-5 text-[#D4A373]/75">
                Altech Cafétéria
              </p>
              <h2 className="text-5xl font-black text-white leading-[1.12] mb-6">
                Tout votre comptoir,<br />
                <span style={{ color: "#D4A373" }}>d'un seul écran.</span>
              </h2>
              <p className="text-white/50 text-base max-w-sm leading-relaxed">
                Stock, achats, ventes, clients, employés et caisse — pour une cafétéria
                comme pour dix, chacune avec ses propres chiffres.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
              className="mt-12 space-y-3">
              {features.map((f, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className="flex items-center gap-4 p-4 rounded-2xl transition-all hover:bg-white/[0.08]"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(212,163,115,0.18)" }}>
                    <f.icon className="w-5 h-5" style={{ color: "#D4A373" }} />
                  </div>
                  <div>
                    <p className="text-white font-bold text-sm">{f.title}</p>
                    <p className="text-white/45 text-xs">{f.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>

          <div className="text-white/25 text-xs">© 2026 Altech Cafétéria</div>
        </div>
      </motion.div>

      {/* ══ Panneau droit ═══════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 relative overflow-y-auto">
        <button
          onClick={toggleLanguage}
          className="absolute top-6 right-6 flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold
                     text-[#7A6A5C] bg-white border border-[#EFE5DA] hover:border-[#D4A373] hover:text-[#6F4E37] transition"
        >
          <Globe className="w-3.5 h-3.5" />
          {i18n.language === "fr" ? "العربية" : "FR"}
        </button>

        <div className="w-full max-w-[26rem]">
          {/* Logo sur mobile (le panneau gauche est masqué) */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden"
              style={{ background: "linear-gradient(135deg, #D4A373, #B8763E)" }}>
              {logo ? <img src={logo} alt="" className="w-full h-full object-cover" />
                    : <Coffee className="w-6 h-6 text-[#2B1B12]" />}
            </div>
            <div>
              <p className="text-xl font-black text-[#2B1B12]">{brand}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8763E]">Gestion de cafétéria</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {view === 'login' ? (
              // ── FORMULAIRE DE CONNEXION ─────────────────────────────
              <motion.form
                key="login"
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
                onSubmit={handleLogin}
                className="bg-white rounded-3xl p-7 sm:p-8"
                style={{ border: "1px solid #EFE5DA", boxShadow: "var(--shadow-lg)" }}
              >
                <h2 className="text-2xl font-black text-[#2B1B12] mb-1">Connexion</h2>
                <p className="text-[13px] text-[#A39588] mb-6">Accédez à votre espace de gestion.</p>

                <label className="label-field">Identifiant ou e-mail</label>
                <div className="relative mb-4">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9B7A5]" />
                  <input
                    className="input-field pl-10"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder="admin ou vous@exemple.dz"
                    autoComplete="username"
                    autoFocus
                  />
                </div>

                <label className="label-field">Mot de passe</label>
                <div className="relative mb-2">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9B7A5]" />
                  <input
                    className="input-field pl-10 pr-10"
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C9B7A5] hover:text-[#6F4E37]">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <AnimatePresence>
                  {loginError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-start gap-2 mt-3 p-3 rounded-xl bg-red-50 border border-red-200">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[12px] text-red-700 leading-relaxed">{loginError}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button type="submit" disabled={loading} className="btn-primary w-full mt-5 py-3">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Se connecter <ArrowRight className="w-4 h-4" /></>}
                </button>

                {/* ── LE BOUTON QUI DISPARAÎT ────────────────────────────
                    Visible UNIQUEMENT tant qu'aucun administrateur n'existe.
                    `null` (réponse serveur pas encore revenue) ne l'affiche
                    pas : mieux vaut un bouton qui apparaît une seconde plus
                    tard qu'un bouton qu'on retire sous le curseur. */}
                {canCreateAdmin === true && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="flex-1 h-px bg-[#EFE5DA]" />
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[#C9B7A5]">
                        Première installation
                      </span>
                      <span className="flex-1 h-px bg-[#EFE5DA]" />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setLoginError(null); setView('signup'); }}
                      className="btn-outline w-full py-2.5"
                    >
                      <UserPlus className="w-4 h-4" />
                      Créer un compte administrateur
                    </button>
                    <p className="text-[11px] text-[#A39588] text-center mt-2.5 leading-relaxed">
                      Aucun administrateur n'existe encore. Ce bouton disparaîtra
                      définitivement une fois le compte créé.
                    </p>
                  </motion.div>
                )}
              </motion.form>
            ) : (
              // ── CRÉATION DU COMPTE ADMINISTRATEUR ───────────────────
              <motion.form
                key="signup"
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
                onSubmit={handleSignup}
                className="bg-white rounded-3xl p-7 sm:p-8"
                style={{ border: "1px solid #EFE5DA", boxShadow: "var(--shadow-lg)" }}
              >
                <div className="flex items-start justify-between mb-1">
                  <h2 className="text-2xl font-black text-[#2B1B12]">Compte administrateur</h2>
                  <button type="button" onClick={() => { resetSignup(); setView('login'); }}
                    className="p-1.5 rounded-lg text-[#C9B7A5] hover:bg-[#F3EBE2] hover:text-[#6F4E37]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[13px] text-[#A39588] mb-6">
                  Ce compte a tous les droits : il crée les cafétérias et les employés.
                </p>

                {suSuccess ? (
                  <div className="py-6 text-center">
                    <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
                    <p className="text-[15px] font-bold text-[#2B1B12]">Compte créé</p>
                    <p className="text-[12.5px] text-[#7A6A5C] mt-1">Connexion en cours…</p>
                  </div>
                ) : (
                  <>
                    <label className="label-field">Nom complet</label>
                    <div className="relative mb-3.5">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9B7A5]" />
                      <input className="input-field pl-10" value={suName} onChange={e => setSuName(e.target.value)}
                        placeholder="Mostapha Benali" autoFocus />
                    </div>

                    <label className="label-field">Nom d'utilisateur</label>
                    <div className="relative mb-3.5">
                      <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9B7A5]" />
                      <input className="input-field pl-10" value={suUsername}
                        onChange={e => setSuUsername(e.target.value.replace(/\s/g, ''))}
                        placeholder="admin" autoComplete="off" />
                    </div>
                    <p className="text-[10.5px] text-[#A39588] -mt-2.5 mb-3.5">
                      Il servira à se connecter, sans avoir à taper l'e-mail.
                    </p>

                    <label className="label-field">Adresse e-mail</label>
                    <div className="relative mb-3.5">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9B7A5]" />
                      <input className="input-field pl-10" type="email" value={suEmail}
                        onChange={e => setSuEmail(e.target.value)} placeholder="vous@exemple.dz" autoComplete="off" />
                    </div>

                    <label className="label-field">Mot de passe</label>
                    <div className="relative mb-3.5">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9B7A5]" />
                      <input className="input-field pl-10 pr-10" type={showSuPass ? "text" : "password"}
                        value={suPassword} onChange={e => setSuPassword(e.target.value)}
                        placeholder="6 caractères minimum" autoComplete="new-password" />
                      <button type="button" onClick={() => setShowSuPass(s => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C9B7A5] hover:text-[#6F4E37]">
                        {showSuPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    <label className="label-field">Confirmer le mot de passe</label>
                    <div className="relative">
                      <ShieldCheck className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9B7A5]" />
                      <input className="input-field pl-10" type={showSuPass ? "text" : "password"}
                        value={suConfirm} onChange={e => setSuConfirm(e.target.value)}
                        placeholder="••••••••" autoComplete="new-password" />
                    </div>

                    <AnimatePresence>
                      {suError && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-start gap-2 mt-3.5 p-3 rounded-xl bg-red-50 border border-red-200">
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-[12px] text-red-700 leading-relaxed">{suError}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button type="submit" disabled={suLoading} className="btn-primary w-full mt-5 py-3">
                      {suLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Créer le compte <UserPlus className="w-4 h-4" /></>}
                    </button>

                    <button type="button" onClick={() => { resetSignup(); setView('login'); }}
                      className="btn-ghost w-full mt-2">
                      Retour à la connexion
                    </button>
                  </>
                )}
              </motion.form>
            )}
          </AnimatePresence>

          <p className="text-center text-[11px] text-[#C9B7A5] mt-6 flex items-center justify-center gap-1.5">
            <Clock className="w-3 h-3" /> Vos données sont enregistrées en ligne, en continu.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
