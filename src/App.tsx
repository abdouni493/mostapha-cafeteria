/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Layout from "./components/Layout";
import { AppProvider, useAppState, useAppDispatch } from "./store/AppContext";
import { ToastContainer } from "./components/Toast";
import { useAuth, type AuthPhase } from "./hooks/useAuth";
import { db, supabase, BUCKETS, getPublicUrl, getMyModuleWorker } from "./lib/supabase";
import { installAutoTranslate, sweep } from "./lib/autoTranslate";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import MySettings from "./pages/MySettings";
import GeneralCash from "./pages/GeneralCash";
import GeneralReports from "./pages/GeneralReports";

// ─── Les écrans d'une cafétéria ───────────────────────────────────────────────
import { BizProvider, useCafeterias } from "./store/BizContext";
import { ModuleKey, routeBaseOf } from "./lib/bizConfig";
import ModuleStock from "./pages/modules/ModuleStock";
import ModuleInventaire from "./pages/modules/ModuleInventaire";
import ModulePurchases from "./pages/modules/ModulePurchases";
import ModuleProduction from "./pages/modules/ModuleProduction";
import ModuleComptoir from "./pages/modules/ModuleComptoir";
import ModulePOS from "./pages/modules/ModulePOS";
import ModuleSales from "./pages/modules/ModuleSales";
import ModuleClients from "./pages/modules/ModuleClients";
import ModuleSuppliers from "./pages/modules/ModuleSuppliers";
import ModuleWorkers from "./pages/modules/ModuleWorkers";
import ModuleExpenses from "./pages/modules/ModuleExpenses";
import ModuleCaisse from "./pages/modules/ModuleCaisse";
import ModuleReports from "./pages/modules/ModuleReports";

/**
 * ─── UNE SEULE DÉFINITION DES ÉCRANS D'UNE CAFÉTÉRIA ──────────────────────────
 *
 * L'application montait autrefois une route par écran ET par activité, écrites
 * à la main. Avec des cafétérias créées à la volée, ce n'est plus possible : le
 * nombre de routes n'est connu qu'à l'exécution.
 *
 * Les écrans sont donc déclarés UNE fois, et la route est
 * `/c/:cafId/<interface>` : ajouter une cafétéria n'ajoute aucune route, la
 * même page se remonte avec une autre clé. `cafId` étant dans l'URL, chaque
 * onglet du navigateur peut être ouvert sur une cafétéria différente — un usage
 * courant quand le gérant surveille deux comptoirs à la fois.
 *
 * L'identifiant de chaque entrée est aussi celui de la PERMISSION : la table
 * ci-dessous, `MODULE_INTERFACES` (bizConfig) et la barre latérale parlent donc
 * forcément de la même chose.
 */
const MODULE_SCREENS: { iface: string; render: (key: ModuleKey) => React.ReactElement }[] = [
  { iface: 'stock',      render: k => <ModuleStock moduleKey={k} /> },
  { iface: 'inventaire', render: k => <ModuleInventaire moduleKey={k} /> },
  { iface: 'purchases',  render: k => <ModulePurchases moduleKey={k} /> },
  { iface: 'production', render: k => <ModuleProduction moduleKey={k} /> },
  { iface: 'comptoir',   render: k => <ModuleComptoir moduleKey={k} /> },
  { iface: 'pos',        render: k => <ModulePOS moduleKey={k} /> },
  { iface: 'sales',      render: k => <ModuleSales moduleKey={k} /> },
  { iface: 'clients',    render: k => <ModuleClients moduleKey={k} /> },
  { iface: 'suppliers',  render: k => <ModuleSuppliers moduleKey={k} /> },
  { iface: 'workers',    render: k => <ModuleWorkers moduleKey={k} /> },
  { iface: 'expenses',   render: k => <ModuleExpenses moduleKey={k} /> },
  { iface: 'caisse',     render: k => <ModuleCaisse moduleKey={k} /> },
  { iface: 'reports',    render: k => <ModuleReports moduleKey={k} /> },
];

// ─── Route réservée à l'administrateur ────────────────────────────────────────
/** Les écrans transversaux (caisse générale, rapports généraux, réglages). */
function AdminOnlyRoute({ element }: { element: React.ReactElement }): React.ReactElement {
  const { currentUserRole } = useAppState();
  if (currentUserRole === 'module_worker') return <Navigate to="/dashboard" replace />;
  return element;
}

// ─── Garde d'un écran de cafétéria ────────────────────────────────────────────
/**
 * Décide si l'utilisateur connecté a le droit d'ouvrir CET écran de CETTE
 * cafétéria. Trois refus, et ils sont distincts :
 *
 *   • la cafétéria de l'URL n'existe pas (lien périmé, cafétéria supprimée) ;
 *   • l'employé demande une cafétéria qui n'est pas la sienne ;
 *   • l'employé demande une interface qu'on ne lui a pas cochée.
 *
 * Le cas « session pas encore résolue » ne refuse RIEN : il attend. Rediriger
 * pendant la résolution renverrait l'employé au tableau de bord à chaque
 * rafraîchissement de page, alors qu'il a bien le droit d'être là.
 */
function ModuleScreen({ iface, render }: { iface: string; render: (key: ModuleKey) => React.ReactElement }) {
  const { cafId = '' } = useParams();
  const navigate = useNavigate();
  const cafeterias = useCafeterias();
  const { currentUserRole, currentModuleWorker } = useAppState();
  const dispatch = useAppDispatch();

  const exists = cafeterias.some(c => c.id === cafId);
  const isWorker = currentUserRole === 'module_worker';
  const pending = isWorker && !currentModuleWorker;

  const allowed =
    exists && (
      !isWorker ||
      (!!currentModuleWorker &&
        currentModuleWorker.moduleKey === cafId &&
        !!currentModuleWorker.permissions?.[`${iface}.voir`])
    );

  useEffect(() => {
    if (pending || allowed) return;
    dispatch({
      type: 'ADD_TOAST',
      payload: {
        type: 'error',
        title: 'Accès refusé',
        message: exists
          ? "Vous n'avez pas accès à cette interface."
          : "Cette cafétéria n'existe plus.",
        duration: 4,
      },
    });
    navigate('/dashboard', { replace: true });
  }, [pending, allowed, exists, dispatch, navigate]);

  if (pending) return <></>;
  if (!allowed) return <Navigate to="/dashboard" replace />;
  return render(cafId);
}

// ─── Écran de chargement ──────────────────────────────────────────────────────
/**
 * Il ne tourne jamais en silence. Un rouet muet est indiscernable d'une
 * application morte : au bout de quelques secondes l'utilisateur recharge, ce
 * qui REMET À ZÉRO les délais de `useAuth` et l'empêche justement d'aboutir.
 * D'où ces trois choses : dire ce qu'on attend, signaler que le lien est lent,
 * et offrir une porte de sortie manuelle.
 */
const AppLoader = ({ phase, onSkip }: { phase?: AuthPhase; onSkip?: () => void }) => {
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setWaited(w => w + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const step =
    phase === 'session' ? "Vérification de la session…" :
    phase === 'role'    ? "Vérification des autorisations…" :
    "Chargement d'Altech Cafétéria…";

  return (
    <div className="flex items-center justify-center min-h-screen px-6"
      style={{ background: "linear-gradient(135deg, #1C110B 0%, #4B3621 55%, #6F4E37 100%)" }}>
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="relative">
          {/* La vapeur qui monte de la tasse : le seul indice que l'écran est vivant. */}
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-1">
            {[0, 0.4, 0.8].map((d, i) => (
              <span key={i} className="block w-1 h-3 rounded-full bg-white/40 animate-steam"
                style={{ animationDelay: `${d}s` }} />
            ))}
          </div>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #D4A373, #B8763E)", boxShadow: "0 8px 24px rgba(212,163,115,0.4)" }}>
            <span className="text-2xl">☕</span>
          </div>
        </div>
        <div className="w-10 h-10 border-4 border-white/15 border-t-[#D4A373] rounded-full animate-spin" />
        <p className="text-[#F5E7D8]/70 font-semibold text-sm">{step}</p>

        {waited >= 4 && (
          <p className="text-[#F5E7D8]/45 text-xs max-w-xs leading-relaxed">
            La connexion au serveur est lente ({waited}s). L'application entrera toute seule —
            <span className="text-[#D4A373]/80"> inutile de recharger</span>, un rechargement
            fait repartir l'attente de zéro.
          </p>
        )}

        {waited >= 6 && onSkip && (
          <button
            onClick={onSkip}
            className="mt-1 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.2em] transition-all hover:scale-[1.03]"
            style={{ background: "linear-gradient(135deg, #D4A373, #B8763E)", color: "#2B1B12", boxShadow: "0 4px 20px rgba(212,163,115,0.35)" }}
          >
            Entrer maintenant
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Voile de chargement des données ──────────────────────────────────────────
const DbLoader = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#FAF6F1]/85 backdrop-blur-sm">
    <div className="flex flex-col items-center gap-4 p-8 bg-white rounded-3xl shadow-2xl">
      <div className="w-12 h-12 border-4 border-[#F5E7D8] border-t-[#6F4E37] rounded-full animate-spin" />
      <p className="text-[#4B3621] font-semibold text-sm">Chargement des données…</p>
      <p className="text-[#A39588] text-xs">Connexion à la base de données</p>
    </div>
  </div>
);

export default function App() {
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.dir = i18n.dir();
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  // Traduction FR→AR à l'exécution des libellés écrits en dur.
  useEffect(() => { installAutoTranslate(); }, []);
  useEffect(() => { if (i18n.language === 'ar') sweep(); });

  return (
    <Router>
      <AuthGate />
    </Router>
  );
}

// ─── Tout ce qui est derrière la connexion ────────────────────────────────────
function AuthGate() {
  const auth = useAuth();

  if (auth.isLoading) return <AppLoader phase={auth.phase} onSkip={auth.releaseNow} />;

  // La `key` lie la durée de vie du store à l'utilisateur connecté. Sans elle,
  // React réutiliserait la même instance d'un compte à l'autre et les données
  // de la session précédente resteraient en mémoire pour la suivante.
  if (!auth.isAuthenticated) {
    return (
      <AppProvider key="anon">
        <Login onLogin={(role, userId) => auth.setManualAuth(role, userId)} />
      </AppProvider>
    );
  }

  return (
    <AppProvider key={auth.userId ?? 'session'}>
      <BizProvider>
        <AppContent
          userRole={auth.userRole}
          userId={auth.userId}
          onLogout={auth.logout}
        />
      </BizProvider>
    </AppProvider>
  );
}

// ─── Application interne (a besoin d'AppProvider) ─────────────────────────────
function AppContent({
  userRole, userId, onLogout,
}: {
  userRole: string;
  userId?: string;
  onLogout: () => void;
}) {
  const { toasts, isLoading } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Pour un employé, on ne pose PAS l'identifiant d'authentification comme
    // `currentUserId` tant que sa fiche n'est pas résolue : l'interface
    // chercherait un employé par cet identifiant et lui accorderait un accès
    // qu'il n'a pas.
    dispatch({
      type: 'SET_CURRENT_USER',
      payload: { role: userRole as any, id: userRole === 'admin' ? userId : undefined },
    });

    if (!userId) return;

    (async () => {
      try {
        if (userRole === 'admin') {
          const profile = await db.getAdminProfile(userId);
          if (profile) {
            const avatarUrl = profile.avatar_url
              ? (profile.avatar_url.startsWith('http')
                  ? profile.avatar_url
                  : getPublicUrl(BUCKETS.STORE_LOGOS, profile.avatar_url))
              : undefined;
            dispatch({
              type: 'SET_CURRENT_USER',
              payload: { role: 'admin', id: userId, name: profile.name, avatarUrl },
            });
          }
        } else {
          // Employé d'une cafétéria : son identité, SA cafétéria et ses droits
          // vivent dans `module_workers`, jamais dans le navigateur.
          const mw = await getMyModuleWorker();
          if (mw) {
            dispatch({
              type: 'SET_CURRENT_USER',
              payload: {
                role: 'module_worker',
                id: mw.id,
                name: mw.name,
                moduleWorker: {
                  id: mw.id,
                  moduleKey: mw.module_key,
                  name: mw.name,
                  roleName: mw.role_name ?? undefined,
                  permissions: (mw.permissions || {}) as Record<string, boolean>,
                },
              },
            });
          }
        }
      } catch {
        // Le chargement du profil est un « mieux si possible » : un échec ne
        // doit pas empêcher d'entrer dans l'application.
      }
    })();
  }, [userRole, userId, dispatch]);

  return (
    <>
      {isLoading && <DbLoader />}

      <ToastContainer
        toasts={toasts}
        onClose={(id) => dispatch({ type: 'REMOVE_TOAST', payload: id })}
      />

      <AppRoutes onLogout={onLogout} />
    </>
  );
}

// ─── Les routes ───────────────────────────────────────────────────────────────
function AppRoutes({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const cafeterias = useCafeterias();
  const { currentUserRole, currentModuleWorker } = useAppState();

  const handleLogout = async () => {
    await onLogout();
    navigate('/login', { replace: true });
  };

  /**
   * Où atterrir quand aucune route ne correspond. Un employé n'a pas de tableau
   * de bord transversal à voir : on l'envoie directement sur la première
   * interface qu'il a le droit d'ouvrir dans SA cafétéria — c'est presque
   * toujours le point de vente, et c'est ce qu'il attend en arrivant.
   */
  const home = useMemo(() => {
    if (currentUserRole !== 'module_worker' || !currentModuleWorker) return '/dashboard';
    const base = routeBaseOf(currentModuleWorker.moduleKey);
    const first = MODULE_SCREENS.find(s => currentModuleWorker.permissions?.[`${s.iface}.voir`]);
    return first ? `${base}/${first.iface}` : '/dashboard';
  }, [currentUserRole, currentModuleWorker]);

  return (
    <Layout onLogout={handleLogout}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Les écrans d'une cafétéria — une seule route par interface, la
            cafétéria voyage dans l'URL. */}
        {MODULE_SCREENS.map(s => (
          <Route
            key={s.iface}
            path={`/c/:cafId/${s.iface}`}
            element={<ModuleScreen iface={s.iface} render={s.render} />}
          />
        ))}

        {/* Écrans transversaux — administrateur uniquement. */}
        <Route path="/general-cash"    element={<AdminOnlyRoute element={<GeneralCash />} />} />
        <Route path="/general-reports" element={<AdminOnlyRoute element={<GeneralReports />} />} />
        <Route path="/settings"        element={<AdminOnlyRoute element={<Settings />} />} />

        {/* Compte personnel — accessible à tout le monde. */}
        <Route path="/my-settings" element={<MySettings />} />

        {/* Une cafétéria sans interface précisée ouvre son point de vente. */}
        <Route path="/c/:cafId" element={<RedirectToFirstScreen />} />

        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Layout>
  );
}

/** `/c/<id>` seul : on ouvre le point de vente de cette cafétéria. */
function RedirectToFirstScreen() {
  const { cafId = '' } = useParams();
  return <Navigate to={`${routeBaseOf(cafId)}/pos`} replace />;
}
