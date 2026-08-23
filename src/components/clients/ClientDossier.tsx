/**
 * ─── Le dossier d'un client ────────────────────────────────────────────────────
 *
 * Tout ce que la cafétéria sait d'un client, dans UNE fenêtre : son identité, ce
 * qu'il doit, ce qu'il a versé, et le journal complet de son compte.
 *
 * TROIS PARTIS PRIS, et chacun règle un vrai problème de comptoir :
 *
 *  1. LA DETTE NETTE EST LA VÉDETTE. Un client qui doit 3 000 DA mais qui a
 *     déposé 5 000 DA d'avance ne doit RIEN. Afficher les deux chiffres côte à
 *     côte sans les rapprocher, c'est réclamer de l'argent à quelqu'un qui a
 *     déjà payé — l'erreur la plus embarrassante qu'un comptoir puisse faire.
 *
 *  2. LE JOURNAL SE DÉPLIE. Chaque ligne peut s'ouvrir sur le détail article par
 *     article : c'est là qu'on répond à « qu'est-ce que j'ai pris ce jour-là ? »
 *     sans aller rouvrir la vente dans un autre écran.
 *
 *  3. UN VERSEMENT SE CORRIGE. Un montant tapé de travers restait au compte pour
 *     toujours. Chaque règlement porte donc ses actions — corriger, supprimer,
 *     réimprimer le reçu — et l'appelant décide lesquelles il autorise.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  X, FileBarChart, Printer, Wallet, ChevronDown, ChevronRight, Pencil, Trash2,
  Receipt, TrendingUp, TrendingDown, PiggyBank, CircleDollarSign, History,
  IdCard, AlertTriangle, Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { money, formatDate, Badge } from '@/src/components/biz/Kit';
import { ClientStatement, StatementPayment, StatementLine, KIND_COLOR } from '@/src/lib/clientStatement';

/** Une rubrique d'identité : un titre, une icône, des lignes libellé → valeur. */
export interface DossierGroup {
  title: string;
  icon: React.ElementType;
  rows: { label: string; value?: string | number; hint?: string }[];
}

/** Un onglet supplémentaire fourni par l'appelant. */
export interface DossierSection {
  id: string;
  label: string;
  icon: React.ElementType;
  count?: number;
  hint?: string;
  render: () => React.ReactNode;
}

interface OpeningInfo {
  debt: number;
  advance: number;
  date: string;
  notes?: string;
  /** Ce qui a déjà été encaissé SUR la reprise. */
  paid: number;
  onEdit?: () => void;
}

interface AdvanceInfo {
  available: number;
  recharged: number;
  used: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  statement: ClientStatement;
  identity: DossierGroup[];
  extraSections?: DossierSection[];
  initialSection?: string;
  opening?: OpeningInfo;
  advance?: AdvanceInfo;
  badges?: React.ReactNode;
  onReport?: () => void;
  onPayDebt?: () => void;
  onPrintStatement?: () => void;
  onEditPayment?: (p: StatementPayment) => void;
  onDeletePayment?: (p: StatementPayment) => void;
  onPrintPayment?: (p: StatementPayment) => void;
  /** La feuille A4 hors écran, clonée à l'impression. */
  children?: React.ReactNode;
}

type BuiltIn = 'resume' | 'journal' | 'reglements';

export default function ClientDossier({
  open, onClose, statement: st, identity, extraSections = [], initialSection,
  opening, advance, badges,
  onReport, onPayDebt, onPrintStatement,
  onEditPayment, onDeletePayment, onPrintPayment,
  children,
}: Props) {
  const [tab, setTab] = useState<string>(initialSection || 'resume');
  const [openLine, setOpenLine] = useState<string | null>(null);

  const tabs = useMemo(() => ([
    { id: 'resume' as BuiltIn, label: "Vue d'ensemble", icon: IdCard, count: undefined as number | undefined },
    { id: 'journal' as BuiltIn, label: 'Journal du compte', icon: History, count: st.allLines.length },
    { id: 'reglements' as BuiltIn, label: 'Règlements', icon: Receipt, count: st.payments.length },
    ...extraSections.map(s => ({ id: s.id, label: s.label, icon: s.icon, count: s.count })),
  ]), [st, extraSections]);

  if (!open) return null;

  /** Ce que le client doit RÉELLEMENT, avance déduite. */
  const owes = st.netDebt > 0.004;
  const holds = st.advanceLeft > 0.004;

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, y: -14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="modal-box modal-box-full w-full max-w-5xl"
      >
        {/* ── En-tête ──────────────────────────────────────────────── */}
        <header className="modal-header">
          <div className="flex items-center gap-3 min-w-0">
            <span className="modal-title-icon"><IdCard size={18} /></span>
            <div className="min-w-0">
              <h3 className="modal-title text-base font-black truncate">{st.client.name}</h3>
              <p className="modal-subtitle text-[11px] flex items-center gap-2 flex-wrap">
                <span>{st.partLabel}</span>
                {st.client.phone && <span>· {st.client.phone}</span>}
                {badges}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {onPrintStatement && (
              <button onClick={onPrintStatement} title="Imprimer le relevé" className="modal-close"><Printer size={15} /></button>
            )}
            {onReport && (
              <button onClick={onReport} title="Rapport du client" className="modal-close"><FileBarChart size={15} /></button>
            )}
            <button onClick={onClose} title="Fermer" className="modal-close"><X size={15} /></button>
          </div>
        </header>

        <div className="modal-body">
          {/* ── Les trois chiffres qui comptent ─────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 pb-0">
            <Tile
              icon={owes ? TrendingDown : CircleDollarSign}
              tone={owes ? 'red' : 'green'}
              label="Reste dû (net)"
              value={money(Math.max(0, st.netDebt))}
              sub={owes ? 'après imputation de son avance' : 'compte soldé'}
            />
            <Tile
              icon={PiggyBank}
              tone={holds ? 'amber' : 'slate'}
              label="Avance disponible"
              value={money(Math.max(0, st.advanceLeft))}
              sub={advance ? `${money(advance.recharged)} déposés · ${money(advance.used)} utilisés` : 'aucun dépôt'}
            />
            <Tile
              icon={TrendingUp}
              tone="coffee"
              label="Total consommé"
              value={money(st.totals.charged)}
              sub={`${st.totals.documents} document(s) · ${money(st.totals.paid)} encaissés`}
            />
          </div>

          {onPayDebt && owes && (
            <div className="px-4 pt-3">
              <button className="btn-primary w-full sm:w-auto" onClick={onPayDebt}>
                <Wallet className="w-4 h-4" /> Encaisser un règlement
              </button>
            </div>
          )}

          {/* ── Onglets ─────────────────────────────────────────────── */}
          <div className="px-4 pt-4 sticky top-0 z-10 bg-white">
            <div className="tab-bar overflow-x-auto custom-scrollbar">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={cn('tab-item flex items-center gap-1.5', tab === t.id && 'tab-item-active')}>
                  <t.icon size={13} />
                  {t.label}
                  {typeof t.count === 'number' && (
                    <span className="text-[10px] opacity-60">({t.count})</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 space-y-5">
            {/* ── Vue d'ensemble ───────────────────────────────────── */}
            {tab === 'resume' && (
              <>
                {opening && (opening.debt > 0 || opening.advance > 0) && (
                  <OpeningCard info={opening} />
                )}
                {identity.map(g => (
                  <section key={g.title} className="rounded-2xl border border-[#EFE5DA] bg-white overflow-hidden">
                    <header className="flex items-center gap-2.5 px-4 py-2.5 bg-[#FAF6F1] border-b border-[#EFE5DA]">
                      <g.icon className="w-4 h-4 text-[#8A5A2B]" />
                      <h4 className="text-[11px] font-black uppercase tracking-wider text-[#4B3621]">{g.title}</h4>
                    </header>
                    <div className="divide-y divide-[#F3EBE2]">
                      {g.rows.filter(r => r.value !== undefined && r.value !== '').map(r => (
                        <div key={r.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                          <span className="text-[12px] text-[#7A6A5C] font-medium">{r.label}</span>
                          <span className="text-[12.5px] font-bold text-[#2A2018] text-right">
                            {r.value}
                            {r.hint && <span className="block text-[10px] font-medium text-[#A39588]">{r.hint}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}

                {/* Par nature d'opération — d'où vient ce qu'il doit. */}
                {st.byKind.length > 0 && (
                  <section className="rounded-2xl border border-[#EFE5DA] bg-white overflow-hidden">
                    <header className="flex items-center gap-2.5 px-4 py-2.5 bg-[#FAF6F1] border-b border-[#EFE5DA]">
                      <Receipt className="w-4 h-4 text-[#8A5A2B]" />
                      <h4 className="text-[11px] font-black uppercase tracking-wider text-[#4B3621]">Par nature</h4>
                    </header>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead><tr>
                          <th className="table-head">Nature</th>
                          <th className="table-head text-right">Nb</th>
                          <th className="table-head text-right">Consommé</th>
                          <th className="table-head text-right">Payé</th>
                          <th className="table-head text-right">Reste</th>
                        </tr></thead>
                        <tbody>
                          {st.byKind.map(k => (
                            <tr key={k.kind}>
                              <td className="table-cell font-semibold" style={{ color: KIND_COLOR[k.kind] }}>{k.label}</td>
                              <td className="table-cell text-right tabular-nums">{k.count}</td>
                              <td className="table-cell text-right tabular-nums">{money(k.charged)}</td>
                              <td className="table-cell text-right tabular-nums">{money(k.paid)}</td>
                              <td className={cn('table-cell text-right tabular-nums font-bold', k.rest > 0 && 'text-red-600')}>
                                {money(k.rest)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}

            {/* ── Journal ──────────────────────────────────────────── */}
            {tab === 'journal' && (
              st.allLines.length === 0
                ? <Empty text="Aucune opération sur ce compte" />
                : (
                  <div className="rounded-2xl border border-[#EFE5DA] bg-white overflow-hidden">
                    {st.allLines.map(line => (
                      <JournalRow
                        key={line.id}
                        line={line}
                        open={openLine === line.id}
                        onToggle={() => setOpenLine(openLine === line.id ? null : line.id)}
                      />
                    ))}
                  </div>
                )
            )}

            {/* ── Règlements ───────────────────────────────────────── */}
            {tab === 'reglements' && (
              st.payments.length === 0
                ? <Empty text="Aucun règlement encaissé" />
                : (
                  <div className="rounded-2xl border border-[#EFE5DA] bg-white overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        <th className="table-head">Date</th>
                        <th className="table-head">Origine</th>
                        <th className="table-head">Mode</th>
                        <th className="table-head">Référence</th>
                        <th className="table-head text-right">Montant</th>
                        <th className="table-head text-right">Actions</th>
                      </tr></thead>
                      <tbody>
                        {st.payments.map(p => (
                          <tr key={p.id}>
                            <td className="table-cell whitespace-nowrap">{formatDate(p.date)}</td>
                            <td className="table-cell">
                              <span className="font-semibold">{p.label}</span>
                              {p.inferred && (
                                <span title="Reconstruit d'un ancien document sans versement daté"
                                  className="ml-1.5 inline-flex items-center"><Info className="w-3 h-3 text-amber-500" /></span>
                              )}
                            </td>
                            <td className="table-cell"><Badge tone="neutral">{p.mode || '—'}</Badge></td>
                            <td className="table-cell text-[#A39588]">{p.reference || '—'}</td>
                            <td className="table-cell text-right tabular-nums font-black text-emerald-700">{money(p.amount)}</td>
                            <td className="table-cell">
                              <div className="flex items-center justify-end gap-1">
                                {onPrintPayment && (
                                  <IconBtn title="Reçu" onClick={() => onPrintPayment(p)}><Printer size={13} /></IconBtn>
                                )}
                                {onEditPayment && (
                                  <IconBtn title="Corriger" onClick={() => onEditPayment(p)}><Pencil size={13} /></IconBtn>
                                )}
                                {onDeletePayment && (
                                  <IconBtn title="Supprimer" danger onClick={() => onDeletePayment(p)}><Trash2 size={13} /></IconBtn>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#FAF6F1]">
                          <td className="table-cell font-black" colSpan={4}>Total encaissé</td>
                          <td className="table-cell text-right tabular-nums font-black">
                            {money(st.payments.reduce((s, p) => s + p.amount, 0))}
                          </td>
                          <td className="table-cell" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
            )}

            {/* ── Onglets fournis par l'appelant ───────────────────── */}
            {extraSections.filter(s => s.id === tab).map(s => (
              <React.Fragment key={s.id}>{s.render()}</React.Fragment>
            ))}
          </div>
        </div>

        {/* La feuille A4 hors écran — jamais visible, clonée à l'impression. */}
        {children}
      </motion.div>
    </div>
  );
}

// ─── Briques ──────────────────────────────────────────────────────────────────

const TONES: Record<string, { bg: string; fg: string }> = {
  red:    { bg: '#FEE2E2', fg: '#991B1B' },
  green:  { bg: '#DCFCE7', fg: '#166534' },
  amber:  { bg: '#FEF3C7', fg: '#92400E' },
  coffee: { bg: '#F5E7D8', fg: '#8A5A2B' },
  slate:  { bg: '#F3EBE2', fg: '#7A6A5C' },
};

function Tile({ icon: Icon, tone, label, value, sub }: {
  icon: React.ElementType; tone: keyof typeof TONES | string; label: string; value: string; sub?: string;
}) {
  const t = TONES[tone] || TONES.slate;
  return (
    <div className="rounded-2xl border border-[#EFE5DA] bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: t.bg, color: t.fg }}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="text-[10px] font-black uppercase tracking-wider text-[#A39588]">{label}</span>
      </div>
      <p className="text-xl font-black tabular-nums mt-2 text-[#2A2018]">{value}</p>
      {sub && <p className="text-[10.5px] text-[#A39588] mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * La reprise du compte, montrée pour ce qu'elle est : une ardoise reprise d'un
 * carnet, pas une vente. C'est le premier endroit où l'on regarde quand un solde
 * ne tombe pas juste.
 */
function OpeningCard({ info }: { info: OpeningInfo }) {
  const rest = Math.max(0, info.debt - info.paid);
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <h4 className="text-[11px] font-black uppercase tracking-wider text-amber-800">
            Reprise à l'ouverture du compte
          </h4>
        </div>
        {info.onEdit && (
          <button onClick={info.onEdit} className="text-[11px] font-bold text-amber-800 underline underline-offset-2">
            Corriger
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Mini label="Dette reprise" value={money(info.debt)} />
        <Mini label="Déjà réglé dessus" value={money(info.paid)} />
        <Mini label="Reste sur la reprise" value={money(rest)} strong={rest > 0} />
        <Mini label="Avance reprise" value={money(info.advance)} />
      </div>
      <p className="text-[10.5px] text-amber-900/70 mt-2.5 leading-relaxed">
        Reprise au {info.date ? formatDate(info.date) : '—'}. Ces soldes ont été contractés
        <b> avant</b> que l'application ne tienne ce compte : ils n'ont fait bouger aucun tiroir.
        {info.notes ? ` — ${info.notes}` : ''}
      </p>
    </section>
  );
}

const Mini = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div>
    <p className="text-[9.5px] font-black uppercase tracking-wide text-amber-700/70">{label}</p>
    <p className={cn('text-[13px] font-black tabular-nums', strong ? 'text-red-700' : 'text-amber-900')}>{value}</p>
  </div>
);

/** Une ligne du journal, dépliable sur le détail article par article. */
function JournalRow({ line, open, onToggle }: {
  line: StatementLine; open: boolean; onToggle: () => void;
}) {
  const hasDetail = !!line.items?.length || !!line.notes;
  const color = KIND_COLOR[line.kind] || '#7A6A5C';

  return (
    <div className="border-b border-[#F3EBE2] last:border-b-0">
      <button
        onClick={hasDetail ? onToggle : undefined}
        className={cn('w-full flex items-center gap-3 px-4 py-3 text-left transition',
          hasDetail ? 'hover:bg-[#FAF6F1] cursor-pointer' : 'cursor-default')}
      >
        <span className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-bold text-[#2A2018] truncate">
            {line.label}
            {line.ref && <span className="ml-1.5 text-[10.5px] font-medium text-[#A39588]">{line.ref}</span>}
          </p>
          <p className="text-[10.5px] text-[#A39588]">
            {formatDate(line.date)}
            <span className="mx-1">·</span>
            <span style={{ color }}>{line.kindLabel}</span>
            {line.qtyLabel && <><span className="mx-1">·</span>{line.qtyLabel}</>}
            {line.mode && <><span className="mx-1">·</span>{line.mode}</>}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          {line.charged > 0 && <p className="text-[12.5px] font-black tabular-nums text-[#2A2018]">{money(line.charged)}</p>}
          {line.paid > 0 && <p className="text-[11px] font-bold tabular-nums text-emerald-700">−{money(line.paid)}</p>}
          {line.rest > 0 && <p className="text-[10px] font-bold tabular-nums text-red-600">reste {money(line.rest)}</p>}
        </div>
        {hasDetail && (open
          ? <ChevronDown className="w-4 h-4 text-[#C9B7A5] flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-[#C9B7A5] flex-shrink-0" />)}
      </button>

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden"
          >
            <div className="px-4 pb-3 pl-8">
              {line.notes && <p className="text-[11px] text-[#7A6A5C] italic mb-2">{line.notes}</p>}
              {!!line.items?.length && (
                <div className="rounded-xl border border-[#EFE5DA] overflow-hidden">
                  <table className="w-full">
                    <thead><tr>
                      <th className="table-head">Article</th>
                      <th className="table-head text-right">Qté</th>
                      <th className="table-head text-right">P.U.</th>
                      <th className="table-head text-right">Total</th>
                    </tr></thead>
                    <tbody>
                      {line.items!.map((it, i) => (
                        <tr key={i}>
                          <td className="table-cell">{it.name}</td>
                          <td className="table-cell text-right tabular-nums">{it.qty}</td>
                          <td className="table-cell text-right tabular-nums">{money(it.unitPrice)}</td>
                          <td className="table-cell text-right tabular-nums font-bold">{money(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const IconBtn = ({ children, title, onClick, danger }: {
  children: React.ReactNode; title: string; onClick: () => void; danger?: boolean;
}) => (
  <button onClick={onClick} title={title}
    className={cn('p-1.5 rounded-lg transition',
      danger ? 'text-red-500 hover:bg-red-50' : 'text-[#A39588] hover:bg-[#F3EBE2] hover:text-[#6F4E37]')}>
    {children}
  </button>
);

const Empty = ({ text }: { text: string }) => (
  <div className="py-14 text-center">
    <History className="w-8 h-8 mx-auto text-[#E2D3C4] mb-2" />
    <p className="text-[13px] text-[#A39588]">{text}</p>
  </div>
);
