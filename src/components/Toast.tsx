/**
 * ─── Messages éphémères ────────────────────────────────────────────────────────
 * Une pile en haut à droite. Chaque message porte un TITRE (ce qui s'est passé)
 * et, facultativement, un DÉTAIL (pourquoi, ou quoi faire) : un bandeau qui dit
 * seulement « Erreur » oblige à deviner, et on finit par ne plus les lire.
 *
 * La durée est en SECONDES et vient de l'émetteur : une confirmation passe vite,
 * un échec d'enregistrement reste le temps d'être lu.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  /** Durée d'affichage en SECONDES (4 par défaut). */
  duration?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
}

const TONE: Record<ToastType, { Icon: React.ElementType; ring: string; fg: string; bg: string }> = {
  success: { Icon: CheckCircle2,  ring: 'border-emerald-200', fg: 'text-emerald-700', bg: 'bg-emerald-50' },
  error:   { Icon: AlertCircle,   ring: 'border-red-200',     fg: 'text-red-700',     bg: 'bg-red-50' },
  warning: { Icon: AlertTriangle, ring: 'border-amber-200',   fg: 'text-amber-700',   bg: 'bg-amber-50' },
  info:    { Icon: Info,          ring: 'border-[#E7C9A9]',   fg: 'text-[#8A5A2B]',   bg: 'bg-[#F5E7D8]' },
};

const ToastItem: React.FC<{ toast: ToastMessage; onClose: (id: string) => void }> = ({ toast, onClose }) => {
  useEffect(() => {
    // Un message d'erreur qui disparaît avant d'être lu ne sert à rien : la
    // durée est celle demandée par l'émetteur, jamais une constante unique.
    const ms = Math.max(1, toast.duration ?? 4) * 1000;
    const timer = setTimeout(() => onClose(toast.id), ms);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onClose]);

  const tone = TONE[toast.type] || TONE.info;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      className={cn(
        'pointer-events-auto flex items-start gap-3 p-3.5 pr-2.5 rounded-2xl border bg-white',
        'min-w-[18rem] max-w-[26rem]',
        tone.ring,
      )}
      style={{ boxShadow: '0 18px 45px rgba(75,54,33,0.18)' }}
      role="status"
    >
      <span className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', tone.bg, tone.fg)}>
        <tone.Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[13px] font-bold text-[#2A2018] leading-snug">{toast.title}</p>
        {toast.message && (
          <p className="text-[11.5px] text-[#7A6A5C] leading-relaxed mt-0.5 break-words">{toast.message}</p>
        )}
      </div>
      <button
        onClick={() => onClose(toast.id)}
        aria-label="Fermer"
        className="p-1.5 rounded-lg text-[#C9B7A5] hover:bg-[#F3EBE2] hover:text-[#7A6A5C] transition flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
};

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onClose }) => (
  <div className="fixed top-20 right-4 z-[80] flex flex-col gap-2.5 pointer-events-none">
    <AnimatePresence initial={false}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} onClose={onClose} />)}
    </AnimatePresence>
  </div>
);

export default ToastContainer;
