/**
 * ─── Palette de commandes (Ctrl + K) ───────────────────────────────────────────
 *
 * POURQUOI ELLE EXISTE
 * Avec plusieurs cafétérias, la barre latérale porte vite quarante entrées :
 * treize interfaces multipliées par le nombre de comptoirs. Chercher « le stock
 * de la cafétéria de la gare » à la souris devient un parcours à trois clics,
 * plusieurs fois par heure.
 *
 * La palette rend TOUT atteignable en tapant trois lettres : les écrans de
 * chaque cafétéria, mais aussi les produits, les clients et les fournisseurs —
 * un produit trouvé ici ouvre directement la Gestion de stock de SA cafétéria.
 *
 * Elle n'affiche jamais ce que l'utilisateur n'a pas le droit de voir : la
 * liste est bâtie à partir des mêmes permissions que la barre latérale.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, X, Boxes, ClipboardList, Truck, ChefHat, Croissant, ScanLine,
  ReceiptText, Users, Handshake, UserCog, Wallet, BarChart3, Vault,
  LayoutDashboard, Store, UserCircle, FileSpreadsheet, Package, CornerDownLeft,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useAppState } from '../store/AppContext';
import { useBizAll, useCafeterias } from '../store/BizContext';
import { MODULE_INTERFACES, routeBaseOf } from '../lib/bizConfig';

const IFACE_ICON: Record<string, React.ElementType> = {
  stock: Boxes, inventaire: ClipboardList, purchases: Truck, production: ChefHat,
  comptoir: Croissant, pos: ScanLine, sales: ReceiptText, clients: Users,
  suppliers: Handshake, workers: UserCog, expenses: Wallet, caisse: Vault, reports: BarChart3,
};

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  group: string;
  Icon: React.ElementType;
  path: string;
}

/** Comparaison insensible à la casse ET aux accents (« crème » trouve « creme »). */
const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { currentUserRole, currentModuleWorker } = useAppState();
  const cafeterias = useCafeterias();
  const biz = useBizAll();
  const isAdmin = currentUserRole !== 'module_worker';

  // ── Ce que CET utilisateur peut atteindre ────────────────────────────────
  const commands = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];

    if (isAdmin) {
      out.push(
        { id: 'g-dash',   label: 'Tableau de bord',   group: 'Général', Icon: LayoutDashboard,  path: '/dashboard' },
        { id: 'g-cash',   label: 'Caisse générale',   group: 'Général', Icon: Vault,            path: '/general-cash' },
        { id: 'g-report', label: 'Rapports généraux', group: 'Général', Icon: FileSpreadsheet,  path: '/general-reports' },
        { id: 'g-set',    label: 'Réglages',          group: 'Général', Icon: Store,            path: '/settings' },
      );
    }
    out.push({ id: 'g-me', label: 'Mon profil', group: 'Général', Icon: UserCircle, path: '/my-settings' });

    const visible = isAdmin
      ? cafeterias.filter(c => !c.archived)
      : cafeterias.filter(c => c.id === currentModuleWorker?.moduleKey);

    for (const caf of visible) {
      const base = routeBaseOf(caf.id);
      const ifaces = isAdmin
        ? MODULE_INTERFACES
        : MODULE_INTERFACES.filter(i => !!currentModuleWorker?.permissions?.[`${i.id}.voir`]);

      for (const i of ifaces) {
        out.push({
          id: `${caf.id}:${i.id}`,
          label: i.label,
          hint: caf.name,
          group: `${caf.emoji || '☕'} ${caf.name}`,
          Icon: IFACE_ICON[i.id] || Boxes,
          path: `${base}/${i.id}`,
        });
      }

      // ── Les DONNÉES, pas seulement les écrans ────────────────────────────
      // Chercher « crème fraîche » et tomber sur la fiche produit vaut mieux que
      // d'ouvrir la Gestion de stock puis de refaire la recherche à l'intérieur.
      const mod = biz.modules[caf.id];
      if (!mod) continue;
      const canSee = (iface: string) =>
        isAdmin || !!currentModuleWorker?.permissions?.[`${iface}.voir`];

      if (canSee('stock')) {
        for (const p of mod.products.slice(0, 400)) {
          out.push({
            id: `p:${caf.id}:${p.id}`,
            label: p.name,
            hint: `${caf.name} · ${p.currentQty ?? 0} en stock`,
            group: 'Produits',
            Icon: Package,
            path: `${base}/stock`,
          });
        }
      }
      if (canSee('clients')) {
        for (const c of mod.clients.slice(0, 300)) {
          out.push({
            id: `c:${caf.id}:${c.id}`, label: c.name, hint: caf.name,
            group: 'Clients', Icon: Users, path: `${base}/clients`,
          });
        }
      }
      if (canSee('suppliers')) {
        for (const f of mod.suppliers.slice(0, 300)) {
          out.push({
            id: `f:${caf.id}:${f.id}`, label: f.name, hint: caf.name,
            group: 'Fournisseurs', Icon: Handshake, path: `${base}/suppliers`,
          });
        }
      }
    }

    return out;
  }, [isAdmin, cafeterias, currentModuleWorker, biz]);

  const results = useMemo(() => {
    const q = fold(search.trim());
    // Sans recherche, on ne déverse pas des centaines de produits : seuls les
    // écrans, qui sont ce qu'on vient chercher neuf fois sur dix.
    if (!q) return commands.filter(c => c.group !== 'Produits' && c.group !== 'Clients' && c.group !== 'Fournisseurs').slice(0, 40);
    return commands
      .filter(c => fold(c.label).includes(q) || fold(c.hint || '').includes(q) || fold(c.group).includes(q))
      // Un libellé qui COMMENCE par la recherche passe devant : taper « st »
      // doit proposer « Stock » avant « Gestion de stock d'une autre partie ».
      .sort((a, b) => Number(fold(b.label).startsWith(q)) - Number(fold(a.label).startsWith(q)))
      .slice(0, 60);
  }, [search, commands]);

  // ── Ouverture / fermeture ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onAsk = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('altech:palette', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('altech:palette', onAsk);
    };
  }, []);

  useEffect(() => {
    if (!open) { setSearch(''); setIndex(0); return; }
    // Le focus doit attendre l'animation d'entrée, sinon il est perdu.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => { setIndex(0); }, [search]);

  // La ligne sélectionnée reste visible quand on descend au clavier.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (cmd: Cmd) => { navigate(cmd.path); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[index]) { e.preventDefault(); run(results[index]); }
  };

  let lastGroup = '';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[#1C110B]/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-xl rounded-2xl overflow-hidden bg-white"
            style={{ boxShadow: '0 32px 80px rgba(28,17,11,0.4)', border: '1px solid #EFE5DA' }}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#F3EBE2]">
              <Search className="w-4 h-4 text-[#A39588] flex-shrink-0" />
              <input
                ref={inputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Écran, produit, client, fournisseur…"
                className="flex-1 bg-transparent outline-none text-[14px] font-medium text-[#2A2018] placeholder:text-[#C9B7A5]"
              />
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg text-[#C9B7A5] hover:bg-[#F3EBE2]">
                <X size={15} />
              </button>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto custom-scrollbar py-1.5">
              {results.length === 0 && (
                <p className="px-4 py-10 text-center text-[13px] text-[#A39588]">Aucun résultat.</p>
              )}
              {results.map((c, i) => {
                const head = c.group !== lastGroup ? c.group : null;
                lastGroup = c.group;
                return (
                  <React.Fragment key={c.id}>
                    {head && (
                      <p className="px-4 pt-3 pb-1 text-[9.5px] font-black uppercase tracking-[0.16em] text-[#C9B7A5]">
                        {head}
                      </p>
                    )}
                    <button
                      data-idx={i}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => run(c)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition',
                        i === index ? 'bg-[#F5E7D8]' : 'hover:bg-[#FAF6F1]',
                      )}
                    >
                      <c.Icon size={16} className={i === index ? 'text-[#8A5A2B]' : 'text-[#A39588]'} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-semibold text-[#2A2018] truncate">{c.label}</span>
                        {c.hint && <span className="block text-[10.5px] text-[#A39588] truncate">{c.hint}</span>}
                      </span>
                      {i === index && <CornerDownLeft size={13} className="text-[#8A5A2B] flex-shrink-0" />}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-[#F3EBE2] bg-[#FAF6F1] text-[10.5px] text-[#A39588]">
              <span className="flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> naviguer</span>
              <span className="flex items-center gap-1"><span className="kbd">↵</span> ouvrir</span>
              <span className="flex items-center gap-1"><span className="kbd">Esc</span> fermer</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default CommandPalette;
