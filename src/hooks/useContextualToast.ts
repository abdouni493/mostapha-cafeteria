/**
 * ─── Messages courts, écrits une fois ──────────────────────────────────────────
 * Un raccourci pour afficher un bandeau sans recomposer l'action à la main, et
 * un catalogue de formulations pour que la même opération soit annoncée de la
 * même façon partout dans l'application.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { useCallback } from 'react';
import { useAppDispatch } from '../store/AppContext';

interface ToastOptions {
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  /** Durée en SECONDES. */
  duration?: number;
}

export function useContextualToast() {
  const dispatch = useAppDispatch();

  const show = useCallback((options: ToastOptions) => {
    const { type, title, message, duration } = options;
    dispatch({
      type: 'ADD_TOAST',
      // Une erreur reste deux fois plus longtemps qu'une confirmation : elle
      // demande une action, une confirmation ne demande qu'un coup d'œil.
      payload: { type, title, message, duration: duration ?? (type === 'error' ? 7 : 4) },
    });
  }, [dispatch]);

  return {
    show,
    success: (title: string, message?: string) => show({ type: 'success', title, message }),
    error:   (title: string, message?: string) => show({ type: 'error', title, message }),
    info:    (title: string, message?: string) => show({ type: 'info', title, message }),
    warning: (title: string, message?: string) => show({ type: 'warning', title, message }),
  };
}

/** Formulations partagées — la même opération se dit pareil partout. */
export const toastMessages = {
  created: (name: string) => `${name} a été ajouté(e)`,
  updated: (name: string) => `${name} a été mis(e) à jour`,
  deleted: (name: string) => `${name} a été supprimé(e)`,

  paymentRecorded: (name: string, amount: number) =>
    `Paiement de ${amount.toLocaleString('fr-DZ')} DA pour ${name} enregistré`,
  advanceRecorded: (name: string, amount: number) =>
    `Acompte de ${amount.toLocaleString('fr-DZ')} DA pour ${name} enregistré`,

  saveFailed: () => "L'enregistrement a échoué",
  deleteFailed: () => 'La suppression a échoué',
  networkError: () => 'Serveur injoignable — vérifiez la connexion du poste',
  validationError: (field: string) => `Renseignez le champ « ${field} »`,

  stockUpdated: (product: string, quantity: number) =>
    `Stock de ${product} : ${quantity} en réserve`,
  lowStock: (product: string) => `Stock faible pour ${product}`,
  sessionOpen: () => 'Ouvrez une session de caisse avant de vendre',
};
