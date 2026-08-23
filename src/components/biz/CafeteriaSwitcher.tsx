/**
 * ─── Le sélecteur de cafétéria ─────────────────────────────────────────────────
 *
 * Une barre unique, posée en tête de chaque écran de cafétéria, qui répond à la
 * question la plus fréquente d'un gérant multi-comptoirs : « et dans l'autre ? ».
 *
 * DEUX CHOSES QUI COMPTENT :
 *
 *  1. ELLE CHANGE D'URL, PAS D'ÉTAT LOCAL. Basculer sur une autre cafétéria
 *     navigue vers `/c/<autre>/<le même écran>`. Le lien est donc partageable,
 *     le bouton « précédent » du navigateur fonctionne, et deux onglets peuvent
 *     rester ouverts sur deux comptoirs — ce que ferait perdre un simple état
 *     de composant.
 *
 *  2. ELLE N'EXISTE PAS POUR UN EMPLOYÉ. Il n'a qu'une cafétéria : lui montrer
 *     une barre grisée avec le nom des autres serait déjà lui apprendre ce
 *     qu'il n'a pas à savoir. Le composant ne rend alors rien du tout.
 *
 * `onCompare` est facultatif : quand l'écran sait afficher une vue « toutes
 * cafétérias » (stock, ventes), un bouton de plus la propose.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layers, Coffee } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAppState } from '@/src/store/AppContext';
import { useActiveCafeterias } from '@/src/store/BizContext';
import { ModuleKey, routeBaseOf } from '@/src/lib/bizConfig';

interface Props {
  /** La cafétéria actuellement ouverte. */
  current: ModuleKey;
  /**
   * Quand l'écran sait agréger toutes les cafétérias, il passe ici l'état de
   * cette vue et de quoi la basculer. Absent ⇒ pas de bouton « Toutes ».
   */
  compare?: { active: boolean; onChange: (v: boolean) => void; label?: string };
}

export default function CafeteriaSwitcher({ current, compare }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const cafeterias = useActiveCafeterias();
  const { currentUserRole } = useAppState();

  // Un employé n'a qu'une cafétéria ; une enseigne à comptoir unique n'a rien à
  // basculer. Dans les deux cas, la barre serait du bruit.
  if (currentUserRole === 'module_worker' || cafeterias.length < 2) return null;

  /** L'interface ouverte, pour la retrouver dans la cafétéria de destination. */
  const iface = location.pathname.match(/^\/c\/[^/]+\/([^/]+)/)?.[1] || 'stock';

  const go = (id: ModuleKey) => {
    compare?.onChange(false);
    navigate(`${routeBaseOf(id)}/${iface}`);
  };

  return (
    <div className="card-glass p-3 flex flex-wrap items-center gap-1.5">
      <Layers className="w-4 h-4 text-[#8A5A2B] ml-1 flex-shrink-0" />
      <span className="text-[10px] font-black uppercase tracking-widest text-[#A39588] mr-1">
        Cafétéria
      </span>

      {compare && (
        <button
          onClick={() => compare.onChange(!compare.active)}
          className={cn('px-3 py-1.5 rounded-lg text-[12px] font-bold transition border',
            compare.active ? 'bg-[#4B3621] text-white border-[#4B3621]'
              : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}>
          🏢 {compare.label || 'Toutes les cafétérias'}
        </button>
      )}

      {cafeterias.map(c => {
        const on = !compare?.active && c.id === current;
        return (
          <button key={c.id} onClick={() => go(c.id)}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-bold transition border',
              on ? 'text-white border-transparent shadow'
                : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}
            style={on ? { background: c.color || '#6F4E37' } : undefined}>
            {c.emoji || '☕'} {c.name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Une pastille de couleur qui rappelle à quelle cafétéria appartient une ligne,
 * dans les vues qui en mélangent plusieurs.
 */
export function CafeteriaTag({ id }: { id: ModuleKey }) {
  const cafeterias = useActiveCafeterias();
  const caf = cafeterias.find(c => c.id === id);
  if (!caf) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9.5px] font-black uppercase tracking-wide whitespace-nowrap"
      style={{ background: `${caf.color || '#6F4E37'}1f`, color: caf.color || '#6F4E37' }}>
      {caf.emoji || <Coffee className="w-2.5 h-2.5" />} {caf.short || caf.name}
    </span>
  );
}
