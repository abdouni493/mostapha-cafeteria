/**
 * ─── La fiche d'un employé ─────────────────────────────────────────────────────
 *
 * Son identité, ses salaires versés, ses acomptes, ses absences, et — quand il
 * répond des manquants — son ardoise d'inventaire.
 *
 * TOUT Y EST MODIFIABLE, ET C'EST LE POINT. Un acompte de 5 000 DA saisi à
 * 50 000 DA restait au dossier pour toujours : il fallait supprimer l'employé
 * pour s'en débarrasser. Chaque ligne porte donc ses deux actions — corriger et
 * supprimer — et l'appelant décide lesquelles il autorise (`canEdit`,
 * `canDelete`), parce qu'un employé qui consulte sa propre fiche ne doit
 * évidemment pas pouvoir effacer une absence.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import {
  X, UserCircle, Wallet, Banknote, CalendarMinus, ClipboardList, IdCard,
  Pencil, Trash2, Check, AlertTriangle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { money, formatDate, Badge, Field, Input, Modal, Confirm } from './biz/Kit';

type Tone = 'green' | 'red' | 'slate' | 'amber';

export interface DetailPayment {
  id: string;
  date: string;
  amount: number;
  title: string;
  subtitle?: string;
  notes?: string;
  breakdown?: { label: string; value: string; tone?: Tone }[];
}

export interface DetailAcompte {
  id: string; date: string; amount: number; description?: string; paid?: boolean;
}

export interface DetailAbsence {
  id: string; date: string; cost: number; description?: string; paid?: boolean;
}

export interface InventoryLedger {
  liable: boolean;
  /** Manquants constatés et jamais retenus. */
  debt: number;
  /** Ce qui a réellement été retenu sur ses salaires. */
  deducted: number;
  pendingCount: number;
  pendingLoss: number;
  rows: {
    id: string; ref: string; date: string;
    loss: number; deducted: number;
    settledOn?: string;
    status: 'retenu' | 'constate' | 'en attente';
  }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  name: string;
  role?: string;
  subtitle?: string;
  statusLabel?: string;
  statusTone?: Tone;
  info: { label: string; value?: string }[];
  payments: DetailPayment[];
  acomptes: DetailAcompte[];
  absences: DetailAbsence[];
  inventory?: InventoryLedger | null;
  canEdit?: boolean;
  canDelete?: boolean;
  onSaveAcompte?: (a: { id: string; date: string; amount: number; description?: string }) => void;
  onDeleteAcompte?: (id: string) => void;
  onSaveAbsence?: (a: { id: string; date: string; cost: number; description?: string }) => void;
  onDeleteAbsence?: (id: string) => void;
  onSavePayment?: (p: { id: string; date: string; amount: number; notes?: string }) => void;
  onDeletePayment?: (id: string) => void;
}

type Tab = 'identite' | 'salaires' | 'acomptes' | 'absences' | 'inventaire';

/** Ce qui est en cours d'édition — une seule ligne à la fois. */
type Editing =
  | { kind: 'acompte'; id: string; date: string; amount: number; description: string }
  | { kind: 'absence'; id: string; date: string; amount: number; description: string }
  | { kind: 'payment'; id: string; date: string; amount: number; description: string }
  | null;

export default function WorkerDetailsModal({
  open, onClose, name, role, subtitle, statusLabel, statusTone = 'slate',
  info, payments, acomptes, absences, inventory,
  canEdit, canDelete,
  onSaveAcompte, onDeleteAcompte, onSaveAbsence, onDeleteAbsence, onSavePayment, onDeletePayment,
}: Props) {
  const [tab, setTab] = useState<Tab>('identite');
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<{ kind: Editing extends null ? never : string; id: string; label: string } | null>(null);

  if (!open) return null;

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const unpaidAcomptes = acomptes.filter(a => !a.paid).reduce((s, a) => s + a.amount, 0);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'identite', label: 'Identité' },
    { id: 'salaires', label: 'Salaires', count: payments.length },
    { id: 'acomptes', label: 'Acomptes', count: acomptes.length },
    { id: 'absences', label: 'Absences', count: absences.length },
    ...(inventory?.liable ? [{ id: 'inventaire' as Tab, label: 'Inventaires', count: inventory.rows.length }] : []),
  ];

  const commitEdit = () => {
    if (!editing) return;
    if (editing.kind === 'acompte') {
      onSaveAcompte?.({ id: editing.id, date: editing.date, amount: editing.amount, description: editing.description });
    } else if (editing.kind === 'absence') {
      onSaveAbsence?.({ id: editing.id, date: editing.date, cost: editing.amount, description: editing.description });
    } else {
      onSavePayment?.({ id: editing.id, date: editing.date, amount: editing.amount, notes: editing.description });
    }
    setEditing(null);
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    if (toDelete.kind === 'acompte') onDeleteAcompte?.(toDelete.id);
    else if (toDelete.kind === 'absence') onDeleteAbsence?.(toDelete.id);
    else onDeletePayment?.(toDelete.id);
    setToDelete(null);
  };

  return (
    <>
      <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="modal-box w-full max-w-3xl"
        >
          <header className="modal-header">
            <div className="flex items-center gap-3 min-w-0">
              <span className="modal-title-icon"><UserCircle size={18} /></span>
              <div className="min-w-0">
                <h3 className="modal-title text-base font-black truncate">{name}</h3>
                <p className="modal-subtitle text-[11px] truncate">
                  {[role, subtitle].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusLabel && (
                <span className={cn('px-2 py-0.5 rounded-full text-[9.5px] font-black uppercase tracking-wide',
                  statusTone === 'green' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/70')}>
                  {statusLabel}
                </span>
              )}
              <button onClick={onClose} className="modal-close"><X size={15} /></button>
            </div>
          </header>

          <div className="modal-body">
            {/* Les trois chiffres du dossier */}
            <div className="grid grid-cols-3 gap-2.5 p-4 pb-0">
              <Tile icon={Wallet} label="Salaires versés" value={money(totalPaid)} tone="green" />
              <Tile icon={Banknote} label="Acomptes non réglés" value={money(unpaidAcomptes)} tone={unpaidAcomptes > 0 ? 'amber' : 'slate'} />
              <Tile icon={ClipboardList} label="Dette inventaire"
                value={money(inventory?.debt || 0)} tone={(inventory?.debt || 0) > 0 ? 'red' : 'slate'} />
            </div>

            <div className="px-4 pt-4">
              <div className="tab-bar overflow-x-auto custom-scrollbar">
                {tabs.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={cn('tab-item', tab === t.id && 'tab-item-active')}>
                    {t.label}{typeof t.count === 'number' ? ` (${t.count})` : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* ── Identité ───────────────────────────────────────── */}
              {tab === 'identite' && (
                <div className="rounded-2xl border border-[#EFE5DA] bg-white overflow-hidden">
                  <header className="flex items-center gap-2.5 px-4 py-2.5 bg-[#FAF6F1] border-b border-[#EFE5DA]">
                    <IdCard className="w-4 h-4 text-[#8A5A2B]" />
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-[#4B3621]">Informations</h4>
                  </header>
                  <div className="divide-y divide-[#F3EBE2]">
                    {info.filter(r => r.value).map(r => (
                      <div key={r.label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                        <span className="text-[12px] text-[#7A6A5C] font-medium">{r.label}</span>
                        <span className="text-[12.5px] font-bold text-[#2A2018] text-right">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Salaires ───────────────────────────────────────── */}
              {tab === 'salaires' && (
                payments.length === 0 ? <Empty text="Aucun salaire versé" /> : (
                  <div className="space-y-2">
                    {payments.map(p => (
                      <div key={p.id} className="rounded-2xl border border-[#EFE5DA] bg-white p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[13px] font-black text-[#2A2018]">{p.title}</p>
                            <p className="text-[10.5px] text-[#A39588]">
                              {formatDate(p.date)}{p.subtitle ? ` · ${p.subtitle}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-black tabular-nums text-emerald-700">{money(p.amount)}</span>
                            <Actions
                              canEdit={canEdit && !!onSavePayment}
                              canDelete={canDelete && !!onDeletePayment}
                              onEdit={() => setEditing({ kind: 'payment', id: p.id, date: p.date.slice(0, 10), amount: p.amount, description: p.notes || '' })}
                              onDelete={() => setToDelete({ kind: 'payment' as any, id: p.id, label: `${p.title} — ${money(p.amount)}` })}
                            />
                          </div>
                        </div>
                        {!!p.breakdown?.length && (
                          <div className="mt-2.5 pt-2.5 border-t border-[#F3EBE2] space-y-1">
                            {p.breakdown.map((b, i) => (
                              <div key={i} className="flex items-center justify-between text-[11px]">
                                <span className="text-[#7A6A5C]">{b.label}</span>
                                <span className={cn('font-bold tabular-nums',
                                  b.tone === 'red' ? 'text-red-600' : b.tone === 'green' ? 'text-emerald-600' : 'text-[#7A6A5C]')}>
                                  {b.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {p.notes && <p className="text-[11px] text-[#A39588] italic mt-2">{p.notes}</p>}
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* ── Acomptes ───────────────────────────────────────── */}
              {tab === 'acomptes' && (
                acomptes.length === 0 ? <Empty text="Aucun acompte" /> : (
                  <div className="rounded-2xl border border-[#EFE5DA] bg-white overflow-hidden divide-y divide-[#F3EBE2]">
                    {acomptes.map(a => (
                      <LineRow key={a.id}
                        title={a.description || 'Acompte'}
                        sub={formatDate(a.date)}
                        amount={money(a.amount)}
                        badge={a.paid ? <Badge tone="success">Réglé</Badge> : <Badge tone="warning">En attente</Badge>}
                        canEdit={canEdit && !!onSaveAcompte}
                        canDelete={canDelete && !!onDeleteAcompte}
                        onEdit={() => setEditing({ kind: 'acompte', id: a.id, date: a.date.slice(0, 10), amount: a.amount, description: a.description || '' })}
                        onDelete={() => setToDelete({ kind: 'acompte' as any, id: a.id, label: `Acompte de ${money(a.amount)}` })}
                      />
                    ))}
                  </div>
                )
              )}

              {/* ── Absences ───────────────────────────────────────── */}
              {tab === 'absences' && (
                absences.length === 0 ? <Empty text="Aucune absence" /> : (
                  <div className="rounded-2xl border border-[#EFE5DA] bg-white overflow-hidden divide-y divide-[#F3EBE2]">
                    {absences.map(a => (
                      <LineRow key={a.id}
                        title={a.description || 'Absence'}
                        sub={formatDate(a.date)}
                        amount={money(a.cost)}
                        badge={a.paid ? <Badge tone="success">Retenue faite</Badge> : <Badge tone="warning">À retenir</Badge>}
                        canEdit={canEdit && !!onSaveAbsence}
                        canDelete={canDelete && !!onDeleteAbsence}
                        onEdit={() => setEditing({ kind: 'absence', id: a.id, date: a.date.slice(0, 10), amount: a.cost, description: a.description || '' })}
                        onDelete={() => setToDelete({ kind: 'absence' as any, id: a.id, label: `Absence de ${money(a.cost)}` })}
                      />
                    ))}
                  </div>
                )
              )}

              {/* ── Inventaires ────────────────────────────────────── */}
              {tab === 'inventaire' && inventory && (
                <>
                  {inventory.pendingCount > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-[11.5px] text-amber-900 leading-relaxed">
                        <b>{inventory.pendingCount}</b> inventaire(s) en attente, pour <b>{money(inventory.pendingLoss)}</b>
                        {' '}de manquants — ils seront proposés à sa prochaine paie.
                      </p>
                    </div>
                  )}
                  {inventory.rows.length === 0 ? <Empty text="Aucun inventaire le concernant" /> : (
                    <div className="rounded-2xl border border-[#EFE5DA] bg-white overflow-x-auto">
                      <table className="w-full">
                        <thead><tr>
                          <th className="table-head">Inventaire</th>
                          <th className="table-head">Date</th>
                          <th className="table-head text-right">Manquant</th>
                          <th className="table-head text-right">Retenu</th>
                          <th className="table-head">État</th>
                        </tr></thead>
                        <tbody>
                          {inventory.rows.map(r => (
                            <tr key={r.id}>
                              <td className="table-cell font-semibold">{r.ref}</td>
                              <td className="table-cell whitespace-nowrap">{formatDate(r.date)}</td>
                              <td className="table-cell text-right tabular-nums text-red-600">{money(r.loss)}</td>
                              <td className="table-cell text-right tabular-nums">{r.deducted > 0 ? money(r.deducted) : '—'}</td>
                              <td className="table-cell">
                                {r.status === 'retenu' ? <Badge tone="danger">Retenu</Badge>
                                  : r.status === 'constate' ? <Badge tone="neutral">Constaté</Badge>
                                    : <Badge tone="warning">En attente</Badge>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Correction d'une ligne ─────────────────────────────────── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} icon={Pencil} size="md" formScale
        zClass="z-[100]"
        title={editing?.kind === 'payment' ? 'Corriger le salaire'
          : editing?.kind === 'acompte' ? "Corriger l'acompte" : "Corriger l'absence"}
        subtitle={name}
        footer={<>
          <button className="btn-ghost" onClick={() => setEditing(null)}>Annuler</button>
          <button className="btn-primary" onClick={commitEdit} disabled={!editing || editing.amount <= 0}>
            <Check className="w-4 h-4" /> Enregistrer
          </button>
        </>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" value={editing.date}
                  onChange={e => setEditing({ ...editing, date: e.target.value })} />
              </Field>
              <Field label="Montant (DA)">
                <Input type="number" className="text-right" value={editing.amount}
                  onChange={e => setEditing({ ...editing, amount: Number(e.target.value) || 0 })} />
              </Field>
            </div>
            <Field label="Description">
              <Input value={editing.description} placeholder="Facultatif"
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Confirm open={!!toDelete} title="Supprimer cette ligne"
        message={toDelete ? `Supprimer « ${toDelete.label} » ? Cette ligne disparaîtra du dossier de ${name}.` : ''}
        onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </>
  );
}

// ─── Briques ──────────────────────────────────────────────────────────────────

const TONE_BG: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: '#DCFCE7', fg: '#166534' },
  red:   { bg: '#FEE2E2', fg: '#991B1B' },
  amber: { bg: '#FEF3C7', fg: '#92400E' },
  slate: { bg: '#F3EBE2', fg: '#7A6A5C' },
};

const Tile = ({ icon: Icon, label, value, tone }: {
  icon: React.ElementType; label: string; value: string; tone: Tone;
}) => {
  const t = TONE_BG[tone];
  return (
    <div className="rounded-xl border border-[#EFE5DA] bg-white p-3">
      <div className="flex items-center gap-1.5">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: t.bg, color: t.fg }}>
          <Icon className="w-3 h-3" />
        </span>
        <span className="text-[9.5px] font-black uppercase tracking-wide text-[#A39588] leading-tight">{label}</span>
      </div>
      <p className="text-[15px] font-black tabular-nums mt-1.5 text-[#2A2018]">{value}</p>
    </div>
  );
};

const Actions = ({ canEdit, canDelete, onEdit, onDelete }: {
  canEdit?: boolean; canDelete?: boolean; onEdit: () => void; onDelete: () => void;
}) => (
  <div className="flex items-center gap-0.5">
    {canEdit && (
      <button onClick={onEdit} title="Corriger"
        className="p-1.5 rounded-lg text-[#A39588] hover:bg-[#F3EBE2] hover:text-[#6F4E37]">
        <Pencil size={13} />
      </button>
    )}
    {canDelete && (
      <button onClick={onDelete} title="Supprimer"
        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600">
        <Trash2 size={13} />
      </button>
    )}
  </div>
);

const LineRow = ({ title, sub, amount, badge, canEdit, canDelete, onEdit, onDelete }: {
  title: string; sub: string; amount: string; badge?: React.ReactNode;
  canEdit?: boolean; canDelete?: boolean; onEdit: () => void; onDelete: () => void;
}) => (
  <div className="flex items-center gap-3 px-4 py-3">
    <div className="min-w-0 flex-1">
      <p className="text-[12.5px] font-bold text-[#2A2018] truncate">{title}</p>
      <p className="text-[10.5px] text-[#A39588]">{sub}</p>
    </div>
    {badge}
    <span className="text-[13px] font-black tabular-nums text-[#2A2018]">{amount}</span>
    <Actions canEdit={canEdit} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} />
  </div>
);

const Empty = ({ text }: { text: string }) => (
  <div className="py-12 text-center">
    <CalendarMinus className="w-7 h-7 mx-auto text-[#E2D3C4] mb-2" />
    <p className="text-[13px] text-[#A39588]">{text}</p>
  </div>
);
