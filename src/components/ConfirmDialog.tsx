import React from "react";
import { AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ModalPortal } from "./biz/Kit";
import { useMotionPrefs } from "../lib/motion";

interface Props {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
  isOpen?: boolean;
}

/**
 * ─── Une confirmation autonome ─────────────────────────────────────────────────
 * Même mouvement que `Confirm` du kit : elle se pose en s'agrandissant, et — ce
 * qui manquait — elle REPART en s'effaçant au lieu de disparaître d'une image à
 * l'autre. `AnimatePresence` retient le démontage le temps de la sortie ; sans
 * lui, `if (!isOpen) return null` arrache l'élément avant toute animation.
 * ──────────────────────────────────────────────────────────────────────────────
 */
const ConfirmDialog = ({ title, message, onConfirm, onCancel, confirmLabel = "Confirmer", danger = true, isOpen = true }: Props) => {
  const m = useMotionPrefs();
  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <div className="modal-shell z-[60]">
            <motion.div
              variants={m.backdrop} initial="hidden" animate="show" exit="out"
              onClick={onCancel} className="absolute inset-0 bg-[#1C110B]/55 backdrop-blur-sm"
            />
            <motion.div
              variants={m.confirm} initial="hidden" animate="show" exit="out"
              className="modal-box max-w-sm relative z-10" onClick={e => e.stopPropagation()}
              role="alertdialog" aria-modal="true"
            >
              <div className="p-6">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${danger ? "bg-red-100" : "bg-amber-100"}`}>
                  <AlertTriangle className={`w-6 h-6 ${danger ? "text-red-600" : "text-amber-600"}`} />
                </div>
                <h3 className="text-base font-black text-[#4B3621] mb-2">{title}</h3>
                <p className="text-sm text-[#7A6A5C] whitespace-pre-line">{message}</p>
              </div>
              <div className="p-6 pt-0 flex gap-3">
                <motion.button onClick={onCancel} className="btn-ghost flex-1" {...m.pressSubtle}>
                  Annuler
                </motion.button>
                <motion.button onClick={onConfirm} {...m.press}
                  className={`flex-1 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-500 hover:bg-amber-600"}`}>
                  {confirmLabel}
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
};

export default ConfirmDialog;
