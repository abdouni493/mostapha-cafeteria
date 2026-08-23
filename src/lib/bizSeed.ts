/**
 * ─── FORME D'UN ÉTAT VIDE (aucune donnée constante) ────────────────────────────
 * Les cafétérias n'affichent QUE ce que contient la ligne `biz_store` de
 * Supabase. Ce fichier ne fournit donc que la FORME d'un état — toutes les
 * collections vides — pour que le store ait quelque chose à rendre avant que la
 * première lecture du serveur soit revenue.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleState, Cafeteria, defaultCafeteria, DEFAULT_CAFETERIA_ID } from './bizConfig';

/** Une cafétéria sans aucune ligne — toutes les collections de `ModuleState`. */
const emptyModule = (): ModuleState => ({
  categories: [], marques: [], roles: [], products: [], purchases: [], sales: [],
  clients: [], suppliers: [], workers: [], expenses: [], caisse: [], productions: [],
  fiches: [], comptoir: [], destructions: [], sessions: [], inventaires: [],
  posPinned: [],
});

/**
 * État de départ : UNE cafétéria, vide. Tout le reste vient de Supabase — et les
 * cafétérias suivantes se créent dans les Réglages.
 */
export function emptyBizState(): BizState {
  const first: Cafeteria = defaultCafeteria();
  return {
    cafeterias: [first],
    modules: { [DEFAULT_CAFETERIA_ID]: emptyModule() },
  };
}

export const EMPTY_MODULE = emptyModule;
