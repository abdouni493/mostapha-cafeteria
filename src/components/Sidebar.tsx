/**
 * ─── Barre latérale — la carte de l'application ────────────────────────────────
 *
 * Elle est bâtie ENTIÈREMENT à partir du registre des cafétérias : une section
 * par cafétéria, chacune dépliable, avec les interfaces qu'elle contient. Créer
 * une cafétéria dans les Réglages la fait apparaître ici sans qu'une ligne de
 * code change.
 *
 * Ce qu'un employé voit : SA cafétéria, et uniquement les interfaces qu'on lui a
 * cochées. Pas de section « toutes les cafétérias », pas de caisse générale, pas
 * de réglages — ces entrées n'existent tout simplement pas dans son rendu, elles
 * ne sont pas seulement grisées.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Boxes, ClipboardList, Truck, ChefHat, Croissant,
  ScanLine, ReceiptText, Users, Handshake, UserCog, Wallet, BarChart3,
  Settings as SettingsIcon, UserCircle, LogOut, ChevronDown, X, Coffee,
  Vault, FileSpreadsheet, Store, Search, AlertTriangle,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { useAppState, AppUserRole, ModuleWorkerSession } from "../store/AppContext";
import { useBizAll, useCafeterias } from "../store/BizContext";
import { MODULE_INTERFACES, routeBaseOf, ModuleKey, Cafeteria } from "../lib/bizConfig";
import { useMotionPrefs } from "../lib/motion";

// ─── Icône de chaque interface ────────────────────────────────────────────────
/**
 * Une icône par interface, choisies dans le vocabulaire d'une cafétéria plutôt
 * que dans celui d'un logiciel de gestion : un croissant pour le comptoir, une
 * toque pour la production. La liste est indexée par le MÊME identifiant que
 * les permissions et les routes — impossible d'ajouter un écran en oubliant son
 * icône, il apparaîtrait sans, et ça se voit.
 */
const IFACE_ICON: Record<string, React.ElementType> = {
  stock: Boxes,
  inventaire: ClipboardList,
  purchases: Truck,
  production: ChefHat,
  comptoir: Croissant,
  pos: ScanLine,
  sales: ReceiptText,
  clients: Users,
  suppliers: Handshake,
  workers: UserCog,
  expenses: Wallet,
  caisse: Vault,
  reports: BarChart3,
};

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activePath: string;
  onNavigate: (path: string) => void;
  onLogout?: () => void;
  userRole: AppUserRole;
  userId?: string;
  moduleWorker?: ModuleWorkerSession;
}

const roleBadge: Record<AppUserRole, { label: string; bg: string; text: string }> = {
  admin:         { label: "Administrateur", bg: "rgba(212,163,115,0.20)", text: "#D4A373" },
  module_worker: { label: "Employé",        bg: "rgba(139,195,143,0.18)", text: "#9BD1A0" },
};

/** Clé de mémorisation des sections dépliées. */
const OPEN_KEY = "altech.sidebar.open";

export default function Sidebar({
  isOpen, onClose, activePath, onNavigate, onLogout, userRole, moduleWorker,
}: SidebarProps) {
  const { settings, currentUserName, currentUserAvatarUrl } = useAppState();
  const cafeterias = useCafeterias();
  const m = useMotionPrefs();
  /**
   * `Layout` monte DEUX barres latérales : la colonne du poste fixe et le
   * tiroir mobile. Un `layoutId` en dur ferait de leurs deux pastilles une
   * seule aux yeux de Motion, qui l'animerait de l'une à l'autre — sur une
   * tablette, où les deux existent, la pastille traverserait l'écran à chaque
   * navigation. Chaque instance a donc la sienne.
   */
  const pillId = React.useId();
  const biz = useBizAll();
  const isAdmin = userRole !== 'module_worker';

  const brand = settings?.name?.trim() || "Altech Cafétéria";

  // ── Ce que CET utilisateur a le droit de voir ────────────────────────────
  /**
   * Un employé ne descend jamais jusqu'à une autre cafétéria : la liste est
   * réduite à la sienne AVANT tout rendu. C'est ici, et pas dans un `hidden`
   * CSS, parce qu'une entrée cachée reste dans le DOM — et un nom de cafétéria
   * concurrente dans le code source d'une page est déjà une fuite.
   */
  const visible: Cafeteria[] = useMemo(() => {
    if (isAdmin) return cafeterias.filter(c => !c.archived);
    const mine = moduleWorker?.moduleKey;
    return cafeterias.filter(c => c.id === mine);
  }, [isAdmin, cafeterias, moduleWorker]);

  const ifacesOf = useMemo(() => (key: ModuleKey) => {
    if (isAdmin) return MODULE_INTERFACES;
    const p = moduleWorker?.permissions || {};
    return MODULE_INTERFACES.filter(i => !!p[`${i.id}.voir`]);
  }, [isAdmin, moduleWorker]);

  // ── Sections dépliées ────────────────────────────────────────────────────
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* mode privé */ }
  }, [open]);

  // La cafétéria de la page courante s'ouvre d'elle-même : arriver par un lien
  // direct ne doit pas obliger à retrouver la section à la main.
  const activeCaf = useMemo(() => {
    const m = activePath.match(/^\/c\/([^/]+)/);
    return m ? m[1] : null;
  }, [activePath]);
  useEffect(() => {
    if (activeCaf) setOpen(o => (o[activeCaf] ? o : { ...o, [activeCaf]: true }));
  }, [activeCaf]);

  // Une seule cafétéria : la déplier d'office, replier n'aurait aucun intérêt.
  useEffect(() => {
    if (visible.length === 1) setOpen(o => ({ ...o, [visible[0].id]: true }));
  }, [visible]);

  // ── Recherche d'écran ────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const go = (path: string) => { onNavigate(path); onClose(); };

  /**
   * Combien de produits sont sous leur seuil, par cafétéria. C'est la seule
   * pastille de la barre : une rupture de stock est ce qui coûte une vente tout
   * de suite, et c'est l'information que le gérant veut voir sans cliquer.
   */
  const lowStock = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of visible) {
      const products = biz.modules[c.id]?.products || [];
      out[c.id] = products.filter(p => (p.currentQty ?? 0) <= (p.minQty ?? 0)).length;
    }
    return out;
  }, [visible, biz]);

  const badge = roleBadge[userRole] || roleBadge.module_worker;

  return (
    <>
      {/* Voile mobile */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={m.backdrop} initial="hidden" animate="show" exit="out"
            onClick={onClose}
            className="fixed inset-0 bg-[#1C110B]/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 h-screen z-50 flex flex-col transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        style={{
          width: "var(--sidebar-width)",
          background: "linear-gradient(180deg, #1C110B 0%, #2B1B12 45%, #3B2519 100%)",
          borderRight: "1px solid rgba(212,163,115,0.14)",
        }}
      >
        {/* ── En-tête ─────────────────────────────────────────────────── */}
        <div className="px-4 pt-5 pb-4 border-b border-[#D4A373]/12 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden"
              style={{ background: "linear-gradient(135deg, #D4A373, #B8763E)", boxShadow: "0 6px 18px rgba(212,163,115,0.35)" }}
            >
              {settings?.logoUrl
                ? <img src={settings.logoUrl} alt="" className="w-full h-full object-cover" />
                : <Coffee size={22} className="text-[#2B1B12]" strokeWidth={2.4} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-black text-white leading-tight truncate">{brand}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4A373]/80">
                {visible.length > 1 ? `${visible.length} cafétérias` : 'Gestion de cafétéria'}
              </p>
            </div>
            <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg text-white/60 hover:bg-white/10">
              <X size={18} />
            </button>
          </div>

          {/* Recherche d'écran — plus rapide que de déplier trois sections. */}
          <div className="relative mt-3.5">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#D4A373]/60" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher un écran…"
              className="w-full pl-9 pr-3 py-2 rounded-xl text-[12.5px] font-medium bg-white/[0.06] border border-white/10
                         text-white placeholder:text-white/35 outline-none focus:border-[#D4A373]/50 focus:bg-white/[0.09] transition"
            />
          </div>
        </div>

        {/* ── Navigation ──────────────────────────────────────────────── */}
        {/* `LayoutGroup` : la pastille active glisse aussi ENTRE deux
            sections (du tableau de bord vers un écran de cafétéria), pas
            seulement à l'intérieur de l'une d'elles. */}
        <LayoutGroup>
        <nav className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 space-y-5">
          {/* Vue d'ensemble — l'administrateur seul la voit. */}
          {isAdmin && (
            <Section title="Vue d'ensemble">
              <Item icon={LayoutDashboard} label="Tableau de bord" path="/dashboard"
                active={activePath === '/dashboard'} onClick={go} q={q} pillId={pillId} />
              <Item icon={Vault} label="Caisse générale" path="/general-cash"
                active={activePath === '/general-cash'} onClick={go} q={q} pillId={pillId} />
              <Item icon={FileSpreadsheet} label="Rapports généraux" path="/general-reports"
                active={activePath === '/general-reports'} onClick={go} q={q} pillId={pillId} />
            </Section>
          )}

          {/* Une section par cafétéria. */}
          {visible.map(caf => {
            const base = routeBaseOf(caf.id);
            const list = ifacesOf(caf.id);
            const isOpenSec = !!open[caf.id] || !!q;
            const alerts = lowStock[caf.id] || 0;
            if (!list.length) return null;

            return (
              <div key={caf.id}>
                <motion.button
                  onClick={() => setOpen(o => ({ ...o, [caf.id]: !o[caf.id] }))}
                  whileTap={m.reduce ? undefined : { scale: 0.985 }}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/[0.06] transition group"
                >
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] flex-shrink-0"
                    style={{ background: `${caf.color || '#6F4E37'}33`, border: `1px solid ${caf.color || '#6F4E37'}66` }}
                  >
                    {caf.emoji || '☕'}
                  </span>
                  <span className="flex-1 text-left min-w-0">
                    <span className="block text-[11px] font-black uppercase tracking-[0.13em] text-white/85 truncate">
                      {caf.name}
                    </span>
                  </span>
                  {alerts > 0 && (
                    <span
                      title={`${alerts} produit(s) sous le seuil`}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-black bg-red-500/20 text-red-300 border border-red-500/30"
                    >
                      <AlertTriangle size={9} />{alerts}
                    </span>
                  )}
                  {/* Le chevron tourne AVEC la section, pas avant ni après :
                      c'est ce qui le fait lire comme la poignée du panneau. */}
                  <motion.span
                    animate={{ rotate: isOpenSec ? 180 : 0 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="flex-shrink-0 text-white/40"
                  >
                    <ChevronDown size={14} />
                  </motion.span>
                </motion.button>

                {/* ─── LE DÉPLIAGE ────────────────────────────────────────
                    La section s'ouvre en hauteur, puis ses écrans arrivent EN
                    CASCADE (`menuList` / `menuItem`). Le décalage est minuscule
                    — 28 ms — mais c'est lui qui donne le sens de lecture : on
                    voit la liste se remplir de haut en bas au lieu d'apparaître
                    d'un bloc, et l'œil sait où recommencer à lire. */}
                <AnimatePresence initial={false}>
                  {isOpenSec && (
                    <motion.div
                      variants={m.collapse} initial="hidden" animate="show" exit="out"
                      className="overflow-hidden"
                    >
                      <motion.div
                        variants={m.menuList} initial="hidden" animate="show"
                        className="mt-1 ml-3.5 pl-3 space-y-0.5 border-l"
                        style={{ borderColor: `${caf.color || '#6F4E37'}55` }}
                      >
                        {list.map(i => {
                          const path = `${base}/${i.id}`;
                          return (
                            <Item
                              key={i.id}
                              icon={IFACE_ICON[i.id] || Boxes}
                              label={i.label}
                              path={path}
                              active={activePath === path}
                              onClick={go}
                              q={q}
                              accent={caf.color}
                              variants={m.menuItem}
                              pillId={pillId}
                            />
                          );
                        })}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {isAdmin && (
            <Section title="Application">
              <Item icon={Store} label="Réglages" path="/settings"
                active={activePath === '/settings'} onClick={go} q={q} pillId={pillId} />
            </Section>
          )}

          <Section title="Mon compte">
            <Item icon={UserCircle} label="Mon profil" path="/my-settings"
              active={activePath === '/my-settings'} onClick={go} q={q} pillId={pillId} />
          </Section>
        </nav>
        </LayoutGroup>

        {/* ── Pied : qui est connecté ─────────────────────────────────── */}
        <div className="px-3 py-3 border-t border-[#D4A373]/12 flex-shrink-0">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/[0.05]">
            <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#6F4E37,#4B3621)" }}>
              {currentUserAvatarUrl
                ? <img src={currentUserAvatarUrl} alt="" className="w-full h-full object-cover" />
                : <UserCircle size={19} className="text-[#D4A373]" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-bold text-white truncate">
                {currentUserName || moduleWorker?.name || 'Utilisateur'}
              </p>
              <span
                className="inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider"
                style={{ background: badge.bg, color: badge.text }}
              >
                {moduleWorker?.roleName || badge.label}
              </span>
            </div>
            {onLogout && (
              <motion.button
                onClick={onLogout}
                title="Déconnexion"
                {...m.press}
                className="p-2 rounded-lg text-white/50 hover:text-red-300 hover:bg-red-500/15 transition"
              >
                <LogOut size={16} />
              </motion.button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Briques ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <div>
      <p className="px-2 mb-1.5 text-[9.5px] font-black uppercase tracking-[0.18em] text-[#D4A373]/55">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/**
 * Une entrée. `q` est la recherche en cours : une entrée qui n'y répond pas
 * n'est pas rendue du tout. Le filtre vit ici plutôt que dans le parent pour
 * qu'aucune liste ne puisse l'oublier — une section qui filtrerait à moitié
 * afficherait des écrans sans rapport avec ce qui est tapé.
 */
function Item({
  icon: Icon, label, path, active, onClick, q, accent, variants, pillId,
}: {
  icon: React.ElementType;
  label: string;
  path: string;
  active: boolean;
  onClick: (p: string) => void;
  q?: string;
  accent?: string;
  variants?: any;
  /** Propre à CETTE barre latérale — voir `pillId` dans `Sidebar`. */
  pillId: string;
}) {
  const m = useMotionPrefs();
  if (q && !label.toLowerCase().includes(q)) return null;

  /**
   * ─── LA PASTILLE QUI SUIT ────────────────────────────────────────────────
   * Le fond de l'entrée active n'est pas peint sur le bouton : c'est UN SEUL
   * élément (`layoutId`) que Motion déplace d'une entrée à l'autre. On voit
   * donc la sélection GLISSER vers l'écran qu'on vient d'ouvrir, au lieu de
   * s'éteindre ici et de se rallumer là-bas.
   *
   * C'est ce détail qui relie visuellement le clic et le changement de page :
   * la barre latérale explique la transition au lieu de la subir.
   */
  return (
    <motion.button
      variants={variants}
      onClick={() => onClick(path)}
      whileTap={m.reduce ? undefined : { scale: 0.97 }}
      whileHover={m.reduce || active ? undefined : { x: 3 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn("sidebar-link relative", active ? "sidebar-link-active" : "sidebar-link-inactive")}
      style={active ? { background: 'transparent', boxShadow: 'none' } : undefined}
    >
      {active && (
        <motion.span
          layoutId={pillId}
          transition={{ type: 'spring', stiffness: 480, damping: 36 }}
          className="absolute inset-0 rounded-[0.8rem] -z-10"
          style={{
            background: accent
              ? `linear-gradient(135deg, ${accent}, ${accent}cc)`
              : 'var(--grad-caramel)',
            boxShadow: '0 4px 14px rgba(184,118,62,0.35)',
          }}
        />
      )}
      <Icon size={17} strokeWidth={active ? 2.5 : 2} className="flex-shrink-0 relative" />
      <span className="truncate relative">{label}</span>
    </motion.button>
  );
}
