/**
 * ─── Barre supérieure ──────────────────────────────────────────────────────────
 * Trois choses, et rien de plus : où l'on est, ce qui demande attention, qui
 * est connecté. Le titre est DÉDUIT de l'URL (`/c/<cafétéria>/<interface>`) au
 * lieu d'être listé dans une table figée — une cafétéria créée ce matin a donc
 * son titre sans qu'on ait rien déclaré.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Bell, Globe, ChevronRight, Coffee, PanelLeftClose, PanelLeftOpen,
  X, AlertTriangle, Info, Command, Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import { useAppState } from "../store/AppContext";
import { useBizAll, useCafeterias } from "../store/BizContext";
import { MODULE_INTERFACES, getModuleConfig } from "../lib/bizConfig";
import { useCafeteriaAlerts, useDismissedAlerts, CafAlert } from "../hooks/useCafeteriaAlerts";

interface NavbarProps {
  onMenuToggle: () => void;
  sidebarOpen: boolean;
  activePath: string;
}

/** Titres des écrans transversaux — les seuls qui ne se déduisent pas de l'URL. */
const GLOBAL_TITLES: Record<string, { title: string; subtitle: string; emoji: string }> = {
  "/dashboard":       { title: "Tableau de bord",   subtitle: "Vue d'ensemble de toutes les cafétérias", emoji: "📊" },
  "/general-cash":    { title: "Caisse générale",   subtitle: "Le coffre au-dessus des cafétérias",      emoji: "🏦" },
  "/general-reports": { title: "Rapports généraux", subtitle: "Bilan consolidé et comptabilité",         emoji: "📈" },
  "/settings":        { title: "Réglages",          subtitle: "Enseigne, cafétérias et base de données", emoji: "⚙️" },
  "/my-settings":     { title: "Mon profil",        subtitle: "Informations personnelles et connexion",  emoji: "👤" },
};

const IFACE_LABEL: Record<string, string> =
  Object.fromEntries(MODULE_INTERFACES.map(i => [i.id, i.label]));

const Navbar = ({ onMenuToggle, sidebarOpen, activePath }: NavbarProps) => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const navigate = useNavigate();

  const { settings, currentUserAvatarUrl, currentUserName, currentUserRole, currentModuleWorker } = useAppState();
  const biz = useBizAll();
  const cafeterias = useCafeterias();

  const brand = settings?.name?.trim() || "Altech Cafétéria";

  // ── Où sommes-nous ? ─────────────────────────────────────────────────────
  const routeInfo = useMemo(() => {
    const m = activePath.match(/^\/c\/([^/]+)\/([^/]+)/);
    if (m) {
      const cfg = getModuleConfig(m[1]);
      return {
        emoji: cfg.emoji,
        title: IFACE_LABEL[m[2]] || cfg.label,
        subtitle: cfg.label,
        crumb: cfg.label,
      };
    }
    const g = GLOBAL_TITLES[activePath];
    return g ? { ...g, crumb: null } : { title: brand, subtitle: "", emoji: "☕", crumb: null };
  }, [activePath, brand]);

  // ── Alertes ──────────────────────────────────────────────────────────────
  /** Un employé n'est alerté que sur SA cafétéria. */
  const myCafeterias = useMemo(() => {
    if (currentUserRole !== 'module_worker') return cafeterias.filter(c => !c.archived);
    return cafeterias.filter(c => c.id === currentModuleWorker?.moduleKey);
  }, [currentUserRole, currentModuleWorker, cafeterias]);

  const { dismissedIds, dismiss } = useDismissedAlerts();
  const alerts = useCafeteriaAlerts(biz, myCafeterias, dismissedIds);

  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) setAlertsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const toggleLanguage = () => {
    const next = i18n.language === "fr" ? "ar" : "fr";
    i18n.changeLanguage(next);
    document.documentElement.dir = i18n.dir();
  };

  const displayName = currentUserName || currentModuleWorker?.name || "Utilisateur";
  const initials = (() => {
    const parts = displayName.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : displayName.slice(0, 2).toUpperCase();
  })();

  const urgent = alerts.filter(a => a.level === 'danger').length;

  return (
    <header
      className="h-16 flex items-center px-4 lg:px-6 gap-3 sticky top-0 z-30 shrink-0"
      style={{
        background: "rgba(253,251,248,0.94)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(239,229,218,0.9)",
        boxShadow: "0 1px 16px rgba(75,54,33,0.06)",
      }}
    >
      <button
        onClick={onMenuToggle}
        aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? "Masquer le menu" : "Afficher le menu"}
        title={sidebarOpen ? "Masquer le menu" : "Afficher le menu"}
        className="p-2 rounded-xl text-[#7A6A5C] hover:bg-[#F3EBE2] hover:text-[#6F4E37] transition flex-shrink-0"
      >
        {sidebarOpen
          ? <PanelLeftClose className="w-5 h-5" style={{ transform: isRtl ? "scaleX(-1)" : undefined }} />
          : <PanelLeftOpen className="w-5 h-5" style={{ transform: isRtl ? "scaleX(-1)" : undefined }} />}
      </button>

      {/* Fil d'Ariane + titre */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="hidden sm:flex items-center gap-1.5 text-[#A39588] text-xs font-medium">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "rgba(111,78,55,0.09)" }}>
            <Coffee className="w-3 h-3 text-[#6F4E37]" />
          </div>
          <span className="truncate max-w-[9rem]">{brand}</span>
          <ChevronRight className="w-3 h-3 text-[#D4A373]" />
          {routeInfo.crumb && (
            <>
              <span className="truncate max-w-[9rem]">{routeInfo.crumb}</span>
              <ChevronRight className="w-3 h-3 text-[#D4A373]" />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg hidden sm:block">{routeInfo.emoji}</span>
          <div className="min-w-0">
            <h2 className="text-sm font-black leading-none truncate text-[#4B3621]">{routeInfo.title}</h2>
            <p className="text-[10px] text-[#A39588] mt-0.5 hidden sm:block truncate">{routeInfo.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Rappel du raccourci de la palette — le seul endroit où on l'apprend. */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('altech:palette'))}
          title="Recherche rapide (Ctrl + K)"
          className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-[#7A6A5C]
                     bg-white border border-[#EFE5DA] hover:border-[#D4A373] hover:text-[#6F4E37] transition"
        >
          <Command className="w-3.5 h-3.5" />
          <span className="kbd">Ctrl</span><span className="kbd">K</span>
        </button>

        <button
          onClick={toggleLanguage}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-[#7A6A5C]
                     bg-white border border-[#EFE5DA] hover:text-[#6F4E37] hover:border-[#D4A373] transition"
        >
          <Globe className="w-3.5 h-3.5" />
          {i18n.language === "fr" ? "العربية" : "FR"}
        </button>

        {/* Cloche */}
        <div className="relative" ref={alertsRef}>
          <button
            onClick={() => setAlertsOpen(o => !o)}
            className="relative p-2 rounded-xl text-[#7A6A5C] hover:bg-[#F3EBE2] hover:text-[#6F4E37] transition"
            aria-label={`${alerts.length} alerte(s)`}
          >
            <Bell className="w-[18px] h-[18px]" />
            {alerts.length > 0 && (
              <span
                className={cn(
                  "absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-white text-[9px] font-black flex items-center justify-center",
                  urgent > 0 ? "bg-red-500" : "bg-[#B8763E]",
                )}
              >
                {alerts.length > 9 ? '9+' : alerts.length}
              </span>
            )}
          </button>

          <AnimatePresence>
            {alertsOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden z-50 bg-white"
                style={{ border: "1px solid #EFE5DA", boxShadow: "0 24px 60px rgba(75,54,33,0.22)" }}
              >
                <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--grad-coffee)" }}>
                  <p className="text-[12px] font-black text-white uppercase tracking-wider">
                    Alertes {alerts.length > 0 && `(${alerts.length})`}
                  </p>
                  <button onClick={() => setAlertsOpen(false)} className="modal-close"><X size={14} /></button>
                </div>

                <div className="max-h-[24rem] overflow-y-auto custom-scrollbar divide-y divide-[#F3EBE2]">
                  {alerts.length === 0 && (
                    <div className="px-4 py-10 text-center">
                      <Check className="w-7 h-7 mx-auto mb-2 text-emerald-500" />
                      <p className="text-[13px] font-bold text-[#4B3621]">Tout est en ordre</p>
                      <p className="text-[11px] text-[#A39588] mt-0.5">Aucun stock bas, aucune caisse ouverte.</p>
                    </div>
                  )}
                  {alerts.map(a => <AlertRow key={a.id} alert={a} onGo={(l) => { navigate(l); setAlertsOpen(false); }} onDismiss={dismiss} />)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Avatar */}
        <button
          onClick={() => navigate('/my-settings')}
          className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs cursor-pointer
                     text-[#2B1B12] transition-transform hover:scale-105 overflow-hidden"
          style={{ background: "linear-gradient(135deg, #D4A373, #B8763E)", boxShadow: "0 2px 8px rgba(184,118,62,0.4)" }}
          title={displayName}
        >
          {currentUserAvatarUrl
            ? <img src={currentUserAvatarUrl} alt={displayName} className="w-full h-full object-cover rounded-xl"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : initials}
        </button>
      </div>
    </header>
  );
};

/** Une ligne d'alerte : niveau, cafétéria concernée, et où aller la traiter. */
function AlertRow({ alert, onGo, onDismiss }: {
  alert: CafAlert;
  onGo: (link: string) => void;
  onDismiss: (id: string) => void;
}) {
  const tone = {
    danger:  { bg: '#FEE2E2', fg: '#991B1B', Icon: AlertTriangle },
    warning: { bg: '#FEF3C7', fg: '#92400E', Icon: AlertTriangle },
    info:    { bg: '#F5E7D8', fg: '#8A5A2B', Icon: Info },
  }[alert.level];

  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 hover:bg-[#FAF6F1] transition group">
      <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: tone.bg, color: tone.fg }}>
        <tone.Icon size={14} />
      </span>
      <button className="flex-1 min-w-0 text-left" onClick={() => onGo(alert.link)}>
        <p className="text-[12.5px] font-bold text-[#2A2018] leading-snug">{alert.title}</p>
        <p className="text-[11px] text-[#7A6A5C] truncate">{alert.detail}</p>
        {alert.cafeteriaName && (
          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide bg-[#F3EBE2] text-[#7A6A5C]">
            {alert.cafeteriaName}
          </span>
        )}
      </button>
      <button
        onClick={() => onDismiss(alert.id)}
        title="Écarter"
        className="p-1 rounded-lg text-[#C9B7A5] opacity-0 group-hover:opacity-100 hover:bg-[#F3EBE2] hover:text-[#7A6A5C] transition"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default Navbar;
