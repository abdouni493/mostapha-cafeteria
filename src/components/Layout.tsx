/**
 * ─── Coquille de l'application ─────────────────────────────────────────────────
 * Barre latérale + barre supérieure + zone de travail. Elle monte aussi la
 * palette de commandes (Ctrl + K) et les raccourcis globaux : ils doivent
 * fonctionner sur TOUS les écrans, donc ils vivent ici et nulle part ailleurs.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import CommandPalette from "./CommandPalette";
import { useAppState } from "../store/AppContext";
import { useCafeterias } from "../store/BizContext";
import { routeBaseOf } from "../lib/bizConfig";

/** Clé du réglage « barre latérale masquée » sur poste fixe. */
const SIDEBAR_HIDDEN_KEY = "altech.sidebarHidden";

const Layout = ({
  children, onRouteChange, onLogout,
}: {
  children: React.ReactNode;
  onRouteChange?: (route: string) => void;
  onLogout?: () => void;
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);   // tiroir mobile
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUserRole, currentUserId, currentModuleWorker } = useAppState();
  const cafeterias = useCafeterias();

  // Sur poste fixe, masquer la barre latérale réduit sa colonne à zéro. Le
  // choix est mémorisé : quelqu'un qui travaille en pleine largeur s'attend à
  // la retrouver ainsi au prochain démarrage.
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? "1" : "0"); } catch { /* mode privé */ }
  }, [sidebarHidden]);

  // Le bouton de la barre supérieure pilote une barre différente selon la
  // largeur (lg = 1024px) : tiroir sur mobile, colonne sur poste fixe.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleSidebar = () => {
    if (isDesktop) setSidebarHidden(h => !h);
    else setSidebarOpen(o => !o);
  };

  useEffect(() => { onRouteChange?.(location.pathname); }, [location.pathname, onRouteChange]);

  /**
   * ─── RACCOURCIS GLOBAUX ────────────────────────────────────────────────────
   * Ils sont pensés pour un comptoir : on encaisse d'une main. `Alt` plutôt que
   * `Ctrl` parce que les combinaisons `Ctrl` sont déjà prises par le navigateur
   * (Ctrl+P imprime, Ctrl+S enregistre la page) et qu'un caissier ne doit
   * jamais déclencher l'un en visant l'autre.
   *
   *   Alt + V   point de VENTE          Alt + S   STOCK
   *   Alt + A   ACHATS                  Alt + C   CAISSE
   *   Alt + R   RAPPORTS                Alt + B   masquer/afficher la barre
   *   Alt + 1…9 basculer de cafétéria (en gardant l'écran ouvert)
   *
   * Le raccourci est ignoré pendant une saisie : taper « a » dans un champ de
   * recherche ne doit pas quitter la page en cours.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      const match = location.pathname.match(/^\/c\/([^/]+)(?:\/([^/]+))?/);
      const currentCaf = match?.[1];
      const currentIface = match?.[2];

      const visible = currentUserRole === 'module_worker'
        ? cafeterias.filter(c => c.id === currentModuleWorker?.moduleKey)
        : cafeterias.filter(c => !c.archived);

      // Une cafétéria de repli : celle où l'on est, sinon la première visible.
      const target = currentCaf || visible[0]?.id;

      const jump = (iface: string) => {
        if (!target) return;
        e.preventDefault();
        navigate(`${routeBaseOf(target)}/${iface}`);
      };

      switch (e.key.toLowerCase()) {
        case 'v': return jump('pos');
        case 's': return jump('stock');
        case 'a': return jump('purchases');
        case 'c': return jump('caisse');
        case 'r': return jump('reports');
        case 'b': e.preventDefault(); return toggleSidebar();
        default: break;
      }

      // Alt + chiffre : la même interface, dans une autre cafétéria. C'est le
      // geste du gérant qui compare deux comptoirs — il garde l'écran et change
      // seulement de lieu.
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9 && visible[n - 1]) {
        e.preventDefault();
        navigate(`${routeBaseOf(visible[n - 1].id)}/${currentIface || 'pos'}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, cafeterias, currentUserRole, currentModuleWorker, navigate, isDesktop]);

  const sidebarProps = {
    activePath: location.pathname,
    onNavigate: (path: string) => navigate(path),
    onLogout,
    userRole: currentUserRole,
    userId: currentUserId,
    moduleWorker: currentModuleWorker,
  };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-surface)" }}>
      {/* Barre latérale — visible dès lg, sauf si masquée depuis la barre du haut */}
      <div
        className="hidden lg:block transition-[width] duration-300 ease-in-out"
        style={{ width: sidebarHidden ? 0 : "var(--sidebar-width)", flexShrink: 0 }}
      >
        <Sidebar isOpen={!sidebarHidden} onClose={() => {}} {...sidebarProps} />
      </div>

      {/* Tiroir mobile */}
      <div className="lg:hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} {...sidebarProps} />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <Navbar
          onMenuToggle={toggleSidebar}
          sidebarOpen={isDesktop ? !sidebarHidden : sidebarOpen}
          activePath={location.pathname}
        />
        <main className="flex-1 p-4 lg:p-6 overflow-auto custom-scrollbar">{children}</main>
      </div>

      {/* Recherche rapide — montée ici pour être disponible partout. */}
      <CommandPalette />
    </div>
  );
};

export default Layout;
