/**
 * ─── La caisse générale ────────────────────────────────────────────────────────
 *
 * Le coffre AU-DESSUS des cafétérias. Chaque comptoir a son tiroir ; ici on voit
 * l'argent de l'enseigne — celui qui remonte des comptoirs, celui qu'on y
 * réinjecte, et les charges communes qui en sortent.
 *
 * TROIS RÈGLES QUI RENDENT CE SOLDE FIABLE :
 *
 *  1. UNE OPÉRATION, UNE SEULE LIGNE. Un transfert saisi dans une cafétéria
 *     écrit son miroir ici, avec la référence de l'original. Les deux écrans
 *     lisent la même opération — impossible de la compter deux fois, impossible
 *     que les deux montants divergent.
 *
 *  2. LES TIROIRS NE SONT PAS DANS LE COFFRE. Le solde affiché ici est celui du
 *     coffre SEUL. La trésorerie totale de l'enseigne (coffre + tous les
 *     tiroirs) est donnée à part, parce que ce sont deux questions
 *     différentes : « que puis-je sortir aujourd'hui ? » et « combien
 *     l'enseigne détient-elle en espèces ? ».
 *
 *  3. UNE LIGNE MIROIR NE SE SUPPRIME PAS ICI. Effacer la contrepartie d'un
 *     transfert laisserait le tiroir du comptoir amputé sans explication : on
 *     renvoie à la cafétéria d'origine, là où l'opération a été saisie.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Vault, Plus, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, CreditCard,
  TrendingUp, TrendingDown, Wallet, Coffee, Filter, Trash2, ExternalLink, Info,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { newId, matchesSearch, cn } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, GeneralCashTx, GeneralCashKind,
  generalCashBalance, generalCashEffect,
} from '@/src/store/AppContext';
import { useBizAll, useCafeterias } from '@/src/store/BizContext';
import { moduleCaisseBalance } from '@/src/lib/bizReporting';
import { routeBaseOf } from '@/src/lib/bizConfig';
import {
  PageHeader, StatCard, Badge, SearchInput, Table, EmptyState, Modal, Field,
  Input, Textarea, Select, Confirm, money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';

const KIND_META: Record<GeneralCashKind, { label: string; icon: React.ElementType; tone: string }> = {
  deposit:      { label: 'Dépôt',              icon: ArrowDownCircle, tone: '#059669' },
  withdraw:     { label: 'Retrait',            icon: ArrowUpCircle,   tone: '#dc2626' },
  transfer_in:  { label: 'Remontée de fonds',  icon: ArrowLeftRight,  tone: '#6F4E37' },
  transfer_out: { label: 'Apport à un comptoir', icon: ArrowLeftRight, tone: '#B8763E' },
  expense:      { label: 'Dépense',            icon: CreditCard,      tone: '#b91c1c' },
};

export default function GeneralCash() {
  const app = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const biz = useBizAll();
  const cafeterias = useCafeterias();

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [cafFilter, setCafFilter] = useState<string>('all');
  const [form, setForm] = useState<'new' | null>(null);
  const [toDelete, setToDelete] = useState<GeneralCashTx | null>(null);

  const balance = useMemo(() => generalCashBalance(app.generalCash), [app.generalCash]);

  /** Le tiroir de chaque cafétéria, calculé comme sur son propre écran Caisse. */
  const drawers = useMemo(() => cafeterias.map(c => ({
    cafeteria: c,
    balance: biz.modules[c.id] ? moduleCaisseBalance(biz.modules[c.id], c.id) : 0,
  })), [cafeterias, biz]);

  const drawersTotal = drawers.reduce((s, d) => s + d.balance, 0);

  const rows = useMemo(() => app.generalCash
    .filter(t => inPeriod(t.date, period, from, to))
    .filter(t => cafFilter === 'all' || t.cafeteriaId === cafFilter)
    .filter(t => matchesSearch(search, t.label, t.category, t.notes))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [app.generalCash, period, from, to, cafFilter, search]);

  const flow = useMemo(() => {
    const inSum = rows.filter(t => generalCashEffect(t) > 0).reduce((s, t) => s + t.amount, 0);
    const outSum = rows.filter(t => generalCashEffect(t) < 0).reduce((s, t) => s + t.amount, 0);
    return { in: inSum, out: outSum, net: inSum - outSum };
  }, [rows]);

  const del = () => {
    if (!toDelete) return;
    dispatch({ type: 'DELETE_GENERAL_TX', payload: toDelete.id });
    toast.success('Ligne supprimée');
    setToDelete(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Vault} title="Caisse générale"
        subtitle="Le coffre de l'enseigne, au-dessus des cafétérias"
        actions={
          <button className="btn-primary" onClick={() => setForm('new')}>
            <Plus className="w-4 h-4" /> Mouvement
          </button>
        } />

      {/* ── Les deux soldes qu'il ne faut jamais confondre ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5 text-white lg:col-span-1"
          style={{ background: balance < 0 ? 'linear-gradient(135deg,#7f1d1d,#b91c1c)' : 'var(--grad-coffee)' }}>
          <div className="flex items-center gap-2 text-white/70">
            <Vault className="w-4 h-4" />
            <span className="text-[11px] font-black uppercase tracking-wider">Solde du coffre</span>
          </div>
          <p className="text-4xl font-black tabular-nums mt-2" style={{ color: balance < 0 ? '#fff' : '#D4A373' }}>
            {money(balance)}
          </p>
          <p className="text-[11px] text-white/60 mt-1">
            {app.generalCash.length} opération(s) depuis l'ouverture
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatCard icon={TrendingUp} label="Entrées (période)" value={money(flow.in)} tone="green" />
          <StatCard icon={TrendingDown} label="Sorties (période)" value={money(flow.out)} tone="red" />
          <StatCard icon={Wallet} label="Total des tiroirs" value={money(drawersTotal)} tone="amber"
            sub={`${drawers.length} cafétéria(s)`} />
          <StatCard icon={Coffee} label="Trésorerie de l'enseigne" value={money(balance + drawersTotal)}
            tone="purple" sub="coffre + tous les tiroirs" />
        </div>
      </div>

      {/* ── Le tiroir de chaque cafétéria ──────────────────────────────── */}
      <section className="card-glass p-4">
        <div className="flex items-center gap-2 mb-3">
          <Coffee className="w-4 h-4 text-[#8A5A2B]" />
          <h3 className="text-[11px] font-black uppercase tracking-widest text-[#7A6A5C]">
            Les tiroirs, cafétéria par cafétéria
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {drawers.map(d => (
            <button key={d.cafeteria.id}
              onClick={() => navigate(`${routeBaseOf(d.cafeteria.id)}/caisse`)}
              className="caf-tint rounded-2xl border border-[#EFE5DA] bg-white p-4 text-left hover:shadow-lg transition"
              style={{ ['--caf-color' as any]: d.cafeteria.color || '#6F4E37' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-black text-[#2A2018] truncate">
                  {d.cafeteria.emoji || '☕'} {d.cafeteria.name}
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-[#C9B7A5] flex-shrink-0" />
              </div>
              <p className={cn('text-xl font-black tabular-nums mt-1.5',
                d.balance < 0 ? 'text-red-600' : 'text-[#4B3621]')}>
                {money(d.balance)}
              </p>
              <p className="text-[10px] text-[#A39588] mt-0.5">
                {d.balance < 0 ? 'tiroir à découvert' : 'en caisse au comptoir'}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Filtres ───────────────────────────────────────────────────── */}
      <div className="card-glass p-4 space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Libellé, catégorie, note…" />
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-[#A39588]" />
          <FilterChip on={cafFilter === 'all'} onClick={() => setCafFilter('all')}>Toutes</FilterChip>
          {cafeterias.map(c => (
            <FilterChip key={c.id} on={cafFilter === c.id} onClick={() => setCafFilter(c.id)} color={c.color}>
              {c.emoji || '☕'} {c.name}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* ── Le journal ────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <EmptyState icon={Vault} title="Aucun mouvement sur cette période"
          message="Les remontées de fonds saisies dans une cafétéria apparaissent ici automatiquement." />
      ) : (
        <Table head={<>
          <th className="table-head">Date</th>
          <th className="table-head">Nature</th>
          <th className="table-head">Libellé</th>
          <th className="table-head">Cafétéria</th>
          <th className="table-head text-right">Montant</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {rows.map(t => {
            const meta = KIND_META[t.kind] || KIND_META.deposit;
            const effect = generalCashEffect(t);
            const caf = cafeterias.find(c => c.id === t.cafeteriaId);
            const mirrored = !!t.linkedTxId;
            return (
              <tr key={t.id}>
                <td className="table-cell whitespace-nowrap">{formatDate(t.date)}</td>
                <td className="table-cell">
                  <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: meta.tone }}>
                    <meta.icon className="w-3.5 h-3.5" /> {meta.label}
                  </span>
                </td>
                <td className="table-cell">
                  <span className="font-semibold">{t.label}</span>
                  {t.category && <Badge tone="neutral">{t.category}</Badge>}
                  {t.notes && <span className="block text-[10.5px] text-[#A39588]">{t.notes}</span>}
                </td>
                <td className="table-cell">
                  {caf ? <span className="text-[11.5px]">{caf.emoji || '☕'} {caf.name}</span>
                    : <span className="text-[#C9B7A5]">—</span>}
                </td>
                <td className={cn('table-cell text-right tabular-nums font-black',
                  effect > 0 ? 'text-emerald-700' : 'text-red-600')}>
                  {effect > 0 ? '+' : '−'}{money(t.amount)}
                </td>
                <td className="table-cell text-right">
                  {mirrored ? (
                    <span title="Contrepartie d'une opération saisie dans une cafétéria — corrigez-la là-bas"
                      className="inline-flex items-center gap-1 text-[10.5px] text-[#A39588]">
                      <Info className="w-3 h-3" /> liée
                    </span>
                  ) : (
                    <button onClick={() => setToDelete(t)} title="Supprimer"
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {form && <GeneralTxForm onClose={() => setForm(null)} />}
      <Confirm open={!!toDelete} title="Supprimer ce mouvement"
        message={toDelete ? `Supprimer « ${toDelete.label} » (${money(toDelete.amount)}) ? Le solde du coffre sera recalculé.` : ''}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

/**
 * Saisie d'un mouvement du coffre.
 *
 * Les TRANSFERTS ne se saisissent pas ici mais depuis la caisse de la cafétéria
 * concernée : c'est là que l'argent change réellement de main, et c'est là que
 * la double écriture est faite. Proposer les deux endroits inviterait à saisir
 * la même remontée deux fois.
 */
function GeneralTxForm({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch();
  const app = useAppState();
  const [kind, setKind] = useState<'deposit' | 'withdraw' | 'expense'>('deposit');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');

  const balance = useMemo(() => generalCashBalance(app.generalCash), [app.generalCash]);
  const after = kind === 'deposit' ? balance + amount : balance - amount;

  const save = () => {
    if (!label.trim()) { toast.error('Libellé requis'); return; }
    if (amount <= 0) { toast.error('Montant requis'); return; }
    dispatch({
      type: 'ADD_GENERAL_TX',
      payload: {
        id: newId(),
        kind,
        amount,
        date: new Date(date).toISOString(),
        label: label.trim(),
        category: category || undefined,
        notes: notes || undefined,
        createdBy: app.currentUserName || undefined,
        createdAt: new Date().toISOString(),
      },
    });
    toast.success('Mouvement enregistré');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Vault} size="md" formScale
      title="Mouvement du coffre" subtitle="Caisse générale"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!label.trim() || amount <= 0}>Valider</button>
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {([
            ['deposit', 'Dépôt', ArrowDownCircle, '#059669'],
            ['withdraw', 'Retrait', ArrowUpCircle, '#dc2626'],
            ['expense', 'Dépense', CreditCard, '#b91c1c'],
          ] as const).map(([id, lbl, Icon, tone]) => (
            <button key={id} onClick={() => setKind(id)}
              className={cn('flex-1 min-w-[7rem] py-2.5 rounded-xl font-bold text-[12.5px] flex items-center justify-center gap-1.5 transition',
                kind === id ? 'text-white shadow' : 'bg-[#F3EBE2] text-[#7A6A5C] hover:bg-[#E2D3C4]')}
              style={kind === id ? { background: tone } : undefined}>
              <Icon className="w-4 h-4" /> {lbl}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-[#E7C9A9] bg-[#F5E7D8]/60 px-3.5 py-2.5 text-[11.5px] text-[#8A5A2B] leading-relaxed">
          Pour faire remonter l'argent d'un comptoir ou lui en apporter, passez par
          l'écran <b>Caisse</b> de la cafétéria : les deux caisses sont alors mises à jour
          d'une seule saisie.
        </div>

        <Field label="Libellé" required>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex : Loyer du local, apport en capital…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)" required>
            <Input type="number" className="text-right" value={amount} onChange={e => setAmount(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Catégorie">
          <Select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">— Sans catégorie —</option>
            {(app.settings.expenseCategories || []).map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Note"><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Facultatif" /></Field>

        {amount > 0 && (
          <p className={cn('text-[11.5px] font-semibold', after < 0 ? 'text-red-600' : 'text-[#7A6A5C]')}>
            Solde du coffre après ce mouvement : {money(after)}
            {after < 0 && ' — le coffre passera à découvert.'}
          </p>
        )}
      </div>
    </Modal>
  );
}

const FilterChip = ({ on, onClick, color, children }: {
  on: boolean; onClick: () => void; color?: string; children: React.ReactNode;
}) => (
  <button onClick={onClick}
    className={cn('px-3 py-1.5 rounded-lg text-[11.5px] font-bold transition border',
      on ? 'text-white shadow border-transparent' : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}
    style={on ? { background: color || '#6F4E37' } : undefined}>
    {children}
  </button>
);
