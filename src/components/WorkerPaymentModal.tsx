/**
 * ─── Payer un employé ──────────────────────────────────────────────────────────
 *
 * Un salaire n'est pas un montant qu'on tape : c'est un CALCUL qu'on doit
 * pouvoir relire. Cette fenêtre le déroule en entier, ligne par ligne, et
 * n'accepte que ce que l'utilisateur a explicitement coché.
 *
 *   base (jours ou mois cochés)
 *   − acomptes déjà remis en main propre
 *   − absences retenues
 *   − retenue sur manquants d'inventaire (si elle est ACTIVÉE)
 *   + prime
 *   = net à payer
 *
 * DEUX PRÉCAUTIONS QUI ÉVITENT DE PAYER DEUX FOIS :
 *
 *  1. Un jour, un mois, un acompte ou un inventaire DÉJÀ réglé par un paiement
 *     antérieur n'apparaît plus dans la liste. C'est l'appelant qui fournit ce
 *     qui reste dû — la fenêtre ne va rien rechercher toute seule.
 *
 *  2. CONSTATER un manquant et le RETENIR sont deux gestes séparés. Cocher un
 *     inventaire l'enregistre sur la fiche de paie (il ne sera plus proposé) ;
 *     activer la retenue est une décision de plus. Sans cette séparation, on ne
 *     pouvait pas dire « je constate le décalage mais je ne le lui fais pas
 *     payer ce mois-ci » — et le manquant revenait indéfiniment.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet, X, Calendar, CalendarDays, CalendarMinus, Banknote, ClipboardList,
  Gift, Check, AlertTriangle, History, Info, EyeOff,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { money, formatDate, Field, Input, Select, Switch } from './biz/Kit';
import {
  PayAcompte, PayAbsence, PayInventaire, PayWork, PrimeType,
  WEEKDAYS, computeUnpaidWorkingDays, computeUnpaidMonths, dayLabel, monthLabel,
  primeAmount, computeNet,
} from '../lib/workerPay';

export interface WorkerPaymentResult {
  net: number;
  date: string;
  mode: string;
  notes?: string;
  selectedDays: string[];
  selectedMonths: string[];
  selectedAcompteIds: string[];
  selectedAbsenceIds: string[];
  selectedWorkIds: string[];
  worksTotal: number;
  selectedInventaireIds: string[];
  inventaireTotal: number;
  inventaireDeduction: number;
  inventaireDeductionActive: boolean;
  inventaireDeductionType: PrimeType;
  inventaireDeductionValue: number;
  prime?: { type: PrimeType; value: number; amount: number };
}

interface WorkerLite {
  name: string;
  role?: string;
  salaryType: 'jour' | 'mois';
  salaryAmount: number;
  percentage?: number;
  workDays?: number[];
  startDate?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  worker: WorkerLite;
  acomptes: PayAcompte[];
  absences: PayAbsence[];
  works?: PayWork[];
  inventaires?: PayInventaire[];
  savedInventaireIds?: string[];
  onDismissInventaire?: (id: string) => void;
  onSaveInventaireSelection?: (ids: string[]) => void;
  /** Manquants constatés sur d'anciennes paies mais jamais retenus. */
  inventaireDebt?: number;
  paidDays?: string[];
  paidMonths?: string[];
  history?: { label: string; date: string; amount: number }[];
  onConfirm: (result: WorkerPaymentResult) => void;
  onShowWorkDetails?: () => void;
}

const PAY_MODES = ['Espèces', 'Virement', 'Chèque'];

export default function WorkerPaymentModal({
  open, onClose, worker, acomptes, absences, inventaires = [], savedInventaireIds,
  onDismissInventaire, onSaveInventaireSelection, inventaireDebt = 0,
  paidDays = [], paidMonths = [], history = [], onConfirm,
}: Props) {
  const isDaily = worker.salaryType === 'jour';

  // ── Ce qui reste à payer ────────────────────────────────────────────────
  const absenceDays = useMemo(() => absences.map(a => a.date.slice(0, 10)), [absences]);

  const unpaidDays = useMemo(() => (isDaily
    ? computeUnpaidWorkingDays({
      workDays: worker.workDays,
      startDate: worker.startDate,
      paidDays,
      absenceDays,
    })
    : []), [isDaily, worker.workDays, worker.startDate, paidDays, absenceDays]);

  const unpaidMonths = useMemo(() => (isDaily
    ? []
    : computeUnpaidMonths({ startDate: worker.startDate, paidMonths })),
  [isDaily, worker.startDate, paidMonths]);

  // ── Sélections ──────────────────────────────────────────────────────────
  const [days, setDays] = useState<string[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [acIds, setAcIds] = useState<string[]>([]);
  const [abIds, setAbIds] = useState<string[]>([]);
  const [invIds, setInvIds] = useState<string[]>(savedInventaireIds || []);

  const [invActive, setInvActive] = useState(false);
  const [invType, setInvType] = useState<PrimeType>('amount');
  const [invValue, setInvValue] = useState(0);

  const [primeType, setPrimeType] = useState<PrimeType>('amount');
  const [primeValue, setPrimeValue] = useState(0);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState(PAY_MODES[0]);
  const [notes, setNotes] = useState('');

  /**
   * À l'ouverture, tout ce qui reste dû est PRÉ-COCHÉ : c'est le geste attendu
   * neuf fois sur dix (« je paie tout ce qu'il me doit »). Décocher reste
   * possible, mais on ne demande pas à l'utilisateur de cocher trente jours à
   * la main pour la paie du mois.
   */
  useEffect(() => {
    if (!open) return;
    setDays(unpaidDays);
    setMonths(unpaidMonths.slice(-1));   // le mois courant, pas toute l'année
    setAcIds(acomptes.map(a => a.id));
    setAbIds(absences.map(a => a.id));
    setInvIds(savedInventaireIds || []);
    setInvActive(false);
    setInvValue(0);
    setPrimeValue(0);
    setDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  // ── Le calcul ───────────────────────────────────────────────────────────
  const base = isDaily
    ? days.length * (Number(worker.salaryAmount) || 0)
    : months.length * (Number(worker.salaryAmount) || 0);

  const acomptesTotal = acomptes.filter(a => acIds.includes(a.id)).reduce((s, a) => s + a.amount, 0);
  const absencesTotal = absences.filter(a => abIds.includes(a.id)).reduce((s, a) => s + a.cost, 0);

  const selectedInv = inventaires.filter(i => invIds.includes(i.id));
  const inventaireTotal = selectedInv.reduce((s, i) => s + i.lossValue, 0);
  const inventaireDeduction = invActive ? primeAmount(inventaireTotal, invType, invValue) : 0;

  const prime = primeAmount(base, primeType, primeValue);

  const net = computeNet({
    base,
    acomptes: acomptesTotal,
    absences: absencesTotal,
    decalageBonus: 0,
    decalageRetenue: 0,
    prime,
    inventaire: inventaireDeduction,
  });

  const confirm = () => {
    onConfirm({
      net, date, mode, notes: notes || undefined,
      selectedDays: days, selectedMonths: months,
      selectedAcompteIds: acIds, selectedAbsenceIds: abIds,
      selectedWorkIds: [], worksTotal: 0,
      selectedInventaireIds: invIds,
      inventaireTotal,
      inventaireDeduction,
      inventaireDeductionActive: invActive,
      inventaireDeductionType: invType,
      inventaireDeductionValue: invValue,
      prime: prime > 0 ? { type: primeType, value: primeValue, amount: prime } : undefined,
    });
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="modal-box w-full max-w-3xl"
      >
        <header className="modal-header">
          <div className="flex items-center gap-3 min-w-0">
            <span className="modal-title-icon"><Wallet size={18} /></span>
            <div className="min-w-0">
              <h3 className="modal-title text-base font-black truncate">Payer {worker.name}</h3>
              <p className="modal-subtitle text-[11px]">
                {worker.role || 'Employé'} · {isDaily ? 'Salaire journalier' : 'Salaire mensuel'} — {money(worker.salaryAmount)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={15} /></button>
        </header>

        <div className="modal-body p-5 space-y-5">
          {/* ── La base ─────────────────────────────────────────────── */}
          {isDaily ? (
            <Block icon={CalendarDays} title={`Jours à payer (${days.length}/${unpaidDays.length})`}
              hint="Seuls les jours travaillés non encore réglés sont proposés — les repos et les absences en sont retirés.">
              {unpaidDays.length === 0
                ? <Empty text="Aucun jour en attente de règlement" />
                : (
                  <>
                    <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto custom-scrollbar">
                      {unpaidDays.map(d => (
                        <Chip key={d} on={days.includes(d)} onClick={() => toggle(days, setDays, d)}>
                          {dayLabel(d)}
                        </Chip>
                      ))}
                    </div>
                    <BulkRow
                      onAll={() => setDays(unpaidDays)}
                      onNone={() => setDays([])}
                      label={`${days.length} jour(s) × ${money(worker.salaryAmount)}`}
                    />
                  </>
                )}
            </Block>
          ) : (
            <Block icon={Calendar} title={`Mois à payer (${months.length}/${unpaidMonths.length})`}
              hint="Un mois déjà réglé par un paiement précédent n'est plus proposé.">
              {unpaidMonths.length === 0
                ? <Empty text="Aucun mois en attente de règlement" />
                : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {unpaidMonths.map(m => (
                        <Chip key={m} on={months.includes(m)} onClick={() => toggle(months, setMonths, m)}>
                          {monthLabel(m)}
                        </Chip>
                      ))}
                    </div>
                    <BulkRow
                      onAll={() => setMonths(unpaidMonths)}
                      onNone={() => setMonths([])}
                      label={`${months.length} mois × ${money(worker.salaryAmount)}`}
                    />
                  </>
                )}
            </Block>
          )}

          {/* ── Acomptes ────────────────────────────────────────────── */}
          {acomptes.length > 0 && (
            <Block icon={Banknote} title={`Acomptes à déduire (${acIds.length}/${acomptes.length})`}
              hint="De l'argent déjà remis en main propre : il est sorti du tiroir le jour où il a été donné.">
              <div className="space-y-1.5">
                {acomptes.map(a => (
                  <LineToggle key={a.id} on={acIds.includes(a.id)} onClick={() => toggle(acIds, setAcIds, a.id)}
                    left={<>{formatDate(a.date)}{a.description ? ` — ${a.description}` : ''}</>}
                    right={`−${money(a.amount)}`} tone="red" />
                ))}
              </div>
            </Block>
          )}

          {/* ── Absences ────────────────────────────────────────────── */}
          {absences.length > 0 && (
            <Block icon={CalendarMinus} title={`Absences à retenir (${abIds.length}/${absences.length})`}>
              <div className="space-y-1.5">
                {absences.map(a => (
                  <LineToggle key={a.id} on={abIds.includes(a.id)} onClick={() => toggle(abIds, setAbIds, a.id)}
                    left={<>{formatDate(a.date)}{a.description ? ` — ${a.description}` : ''}</>}
                    right={`−${money(a.cost)}`} tone="red" />
                ))}
              </div>
            </Block>
          )}

          {/* ── Inventaires ─────────────────────────────────────────── */}
          {inventaires.length > 0 && (
            <Block icon={ClipboardList} title={`Manquants d'inventaire (${invIds.length}/${inventaires.length})`}
              hint="Cocher CONSTATE le décalage sur cette paie. La retenue est une décision séparée, ci-dessous.">
              <div className="space-y-1.5">
                {inventaires.map(i => (
                  <div key={i.id} className="flex items-center gap-2">
                    <LineToggle on={invIds.includes(i.id)} onClick={() => toggle(invIds, setInvIds, i.id)}
                      left={<>{i.label} <span className="text-[10.5px] text-[#A39588]">· {i.sublabel}</span></>}
                      right={`−${money(i.lossValue)}`} tone="red" grow />
                    {onDismissInventaire && (
                      <button onClick={() => onDismissInventaire(i.id)} title="Ne plus proposer cet inventaire"
                        className="p-1.5 rounded-lg text-[#C9B7A5] hover:bg-[#F3EBE2] hover:text-[#7A6A5C]">
                        <EyeOff size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {inventaireTotal > 0 && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-bold text-amber-900">
                      Retenir sur ce salaire ? ({money(inventaireTotal)} constatés)
                    </span>
                    <Switch checked={invActive} onChange={setInvActive} />
                  </div>
                  {invActive && (
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={invType} onChange={e => setInvType(e.target.value as PrimeType)}>
                        <option value="amount">Montant fixe (DA)</option>
                        <option value="percent">Pourcentage du manquant</option>
                      </Select>
                      <Input type="number" className="text-right" value={invValue}
                        onChange={e => setInvValue(Number(e.target.value) || 0)} />
                    </div>
                  )}
                  <p className="text-[10.5px] text-amber-900/75 leading-relaxed">
                    {invActive
                      ? <>Retenue appliquée : <b>{money(inventaireDeduction)}</b>.</>
                      : <>Aucune retenue : le décalage est <b>constaté</b> sur cette paie et reste à la charge de l'enseigne.</>}
                  </p>
                </div>
              )}

              {onSaveInventaireSelection && (
                <button onClick={() => onSaveInventaireSelection(invIds)}
                  className="btn-ghost mt-2 text-[11px]">Mémoriser cette sélection</button>
              )}
            </Block>
          )}

          {inventaireDebt > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-[11.5px] text-amber-900 leading-relaxed">
                <b>{money(inventaireDebt)}</b> de manquants constatés sur ses paies précédentes n'ont jamais été retenus.
              </p>
            </div>
          )}

          {/* ── Prime ───────────────────────────────────────────────── */}
          <Block icon={Gift} title="Prime">
            <div className="grid grid-cols-2 gap-2">
              <Select value={primeType} onChange={e => setPrimeType(e.target.value as PrimeType)}>
                <option value="amount">Montant fixe (DA)</option>
                <option value="percent">Pourcentage de la base</option>
              </Select>
              <Input type="number" className="text-right" value={primeValue}
                onChange={e => setPrimeValue(Number(e.target.value) || 0)} />
            </div>
            {prime > 0 && <p className="text-[11px] text-emerald-700 font-bold mt-1.5">+{money(prime)}</p>}
          </Block>

          {/* ── Le décompte ─────────────────────────────────────────── */}
          <div className="rounded-2xl border-2 border-[#D4A373] bg-[#F5E7D8]/60 p-4 space-y-1.5">
            <Row label={isDaily ? `Base — ${days.length} jour(s)` : `Base — ${months.length} mois`} value={money(base)} />
            {acomptesTotal > 0 && <Row label="Acomptes déduits" value={`−${money(acomptesTotal)}`} tone="red" />}
            {absencesTotal > 0 && <Row label="Absences retenues" value={`−${money(absencesTotal)}`} tone="red" />}
            {inventaireDeduction > 0 && <Row label="Retenue inventaire" value={`−${money(inventaireDeduction)}`} tone="red" />}
            {prime > 0 && <Row label="Prime" value={`+${money(prime)}`} tone="green" />}
            <div className="pt-2 mt-1 border-t-2 border-[#D4A373]/50 flex items-center justify-between">
              <span className="text-[13px] font-black uppercase tracking-wide text-[#4B3621]">Net à payer</span>
              <span className="text-2xl font-black tabular-nums text-[#4B3621]">{money(net)}</span>
            </div>
          </div>

          {/* ── Le versement ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Date du paiement"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Mode">
              <Select value={mode} onChange={e => setMode(e.target.value)}>
                {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Note"><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Facultatif" /></Field>
          </div>

          {/* ── Les derniers paiements ──────────────────────────────── */}
          {history.length > 0 && (
            <Block icon={History} title="Derniers paiements">
              <div className="space-y-1">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-[11.5px] px-2 py-1.5 rounded-lg bg-[#FAF6F1]">
                    <span className="text-[#7A6A5C]">{h.label} · {formatDate(h.date)}</span>
                    <span className="font-bold tabular-nums text-[#2A2018]">{money(h.amount)}</span>
                  </div>
                ))}
              </div>
            </Block>
          )}
        </div>

        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={confirm} disabled={net <= 0 && base <= 0}>
            <Check className="w-4 h-4" /> Enregistrer le paiement
          </button>
        </footer>
      </motion.div>
    </div>
  );
}

// ─── Briques ──────────────────────────────────────────────────────────────────

const Block = ({ icon: Icon, title, hint, children }: {
  icon: React.ElementType; title: string; hint?: string; children: React.ReactNode;
}) => (
  <section className="rounded-2xl border border-[#EFE5DA] bg-white p-4">
    <div className="flex items-center gap-2 mb-1">
      <Icon className="w-4 h-4 text-[#8A5A2B]" />
      <h4 className="text-[11.5px] font-black uppercase tracking-wider text-[#4B3621]">{title}</h4>
    </div>
    {hint && <p className="text-[10.5px] text-[#A39588] leading-relaxed mb-2.5">{hint}</p>}
    {children}
  </section>
);

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick}
    className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition border',
      on ? 'bg-[#6F4E37] text-white border-[#6F4E37]' : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}>
    {children}
  </button>
);

const BulkRow = ({ onAll, onNone, label }: { onAll: () => void; onNone: () => void; label: string }) => (
  <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-[#F3EBE2]">
    <span className="text-[11px] font-bold text-[#7A6A5C]">{label}</span>
    <span className="flex gap-2">
      <button onClick={onAll} className="text-[11px] font-bold text-[#8A5A2B] underline underline-offset-2">Tout</button>
      <button onClick={onNone} className="text-[11px] font-bold text-[#A39588] underline underline-offset-2">Aucun</button>
    </span>
  </div>
);

const LineToggle = ({ on, onClick, left, right, tone, grow }: {
  on: boolean; onClick: () => void; left: React.ReactNode; right: string;
  tone?: 'red' | 'green'; grow?: boolean;
}) => (
  <button onClick={onClick}
    className={cn('flex items-center gap-2.5 px-3 py-2 rounded-xl border transition text-left w-full',
      grow && 'flex-1',
      on ? 'bg-[#FAF6F1] border-[#D4A373]' : 'bg-white border-[#EFE5DA] hover:border-[#E2D3C4]')}>
    <span className={cn('w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border',
      on ? 'bg-[#6F4E37] border-[#6F4E37]' : 'border-[#C9B7A5]')}>
      {on && <Check className="w-3 h-3 text-white" />}
    </span>
    <span className="flex-1 min-w-0 text-[11.5px] text-[#2A2018] truncate">{left}</span>
    <span className={cn('text-[11.5px] font-black tabular-nums',
      tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-[#2A2018]')}>
      {right}
    </span>
  </button>
);

const Row = ({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'green' }) => (
  <div className="flex items-center justify-between">
    <span className="text-[12px] text-[#7A6A5C]">{label}</span>
    <span className={cn('text-[12.5px] font-bold tabular-nums',
      tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-700' : 'text-[#2A2018]')}>
      {value}
    </span>
  </div>
);

const Empty = ({ text }: { text: string }) => (
  <p className="text-[12px] text-[#A39588] py-3 flex items-center gap-2">
    <Info className="w-3.5 h-3.5" /> {text}
  </p>
);
