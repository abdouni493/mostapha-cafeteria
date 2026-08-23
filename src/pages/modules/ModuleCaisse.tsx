import React, { useMemo, useState } from 'react';
import {
  Wallet, PiggyBank, ArrowDownCircle, ArrowUpCircle, Plus, TrendingUp, TrendingDown, Layers,
  Edit2, Trash2, Boxes, ShoppingCart, CreditCard, Banknote, Beaker,
  Clock, UserCheck, PlayCircle, StopCircle, Scale, Eye, Flame,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizCaisseTx, BizSession, BizSale, netCashOfSale, bizExpensePaidInCash } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState, useAppDispatch, generalCashBalance } from '@/src/store/AppContext';
import { moduleCaisseMovements, caisseFlowOf } from '@/src/lib/bizReporting';
import { useBizSessions } from '@/src/hooks/useBizSessions';
import { CloseSessionModal } from './ModulePOS';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Switch, Confirm,
  Table, Tabs, EmptyState,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import CafeteriaSwitcher from '@/src/components/biz/CafeteriaSwitcher';

export default function ModuleCaisse({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'caisse');
  const app = useAppState();
  const { caisse, sales, purchases, expenses, workers, products, comptoir, destructions } = biz.state;

  const [tab, setTab] = useState<'tresorerie' | 'sessions'>('tresorerie');
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [form, setForm] = useState<BizCaisseTx | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<BizCaisseTx | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);

  // ── Global totals (for balance) ──
  //
  // Les DESTRUCTIONS (produits périmés, cassés, volés — enregistrées depuis la
  // Gestion de stock ou le Comptoir) ne sortent pas d'argent de la caisse : elles
  // détruisent de la MARCHANDISE. Leur coût est donc suivi à part et retranché du
  // résultat de la période, pas du solde d'espèces — la valeur du stock a déjà
  // baissé d'autant.
  /**
   * Les mouvements du tiroir — la SEULE définition, celle que lisent aussi le
   * rapport de la partie et l'écran Caisse Générale. Le calcul qui vivait ici
   * ignorait les interventions payées, les virements du grand livre et les
   * dépenses de la station imputées à cette partie, et retranchait en revanche
   * les dépenses réglées par la BANQUE — de l'argent jamais sorti du tiroir.
   * Trois écrans annonçaient donc trois soldes.
   */
  const movements = useMemo(
    () => (biz.state ? moduleCaisseMovements(biz.state, moduleKey) : []),
    [biz.state, moduleKey]);

  const totals = useMemo(() => {
    const deposits = caisse.filter(c => c.type === 'deposit').reduce((s, c) => s + c.amount, 0);
    const withdrawals = caisse.filter(c => c.type === 'withdraw').reduce((s, c) => s + c.amount, 0);
    // `netCashOfSale` : une vente retournée ne laisse dans le tiroir que ce qui
    // n'a pas été remboursé, une vente échangée rien du tout (son remplacement
    // porte l'encaissement). Compter `paid` brut gonflait la caisse d'un argent
    // déjà rendu au client.
    const salesPaid = sales.reduce((s, x) => s + netCashOfSale(x), 0);
    const purchasesPaid = purchases.reduce((s, x) => s + x.paid, 0);
    // Toutes les dépenses de la cafétéria comptent dans son résultat ; seules
    // celles réglées EN ESPÈCES ont vidé son tiroir (les autres sont sorties de
    // la caisse générale).
    const exp = expenses.reduce((s, x) => s + x.amount, 0);
    const expCash = expenses.filter(bizExpensePaidInCash).reduce((s, x) => s + x.amount, 0);
    const salaries = workers.reduce((s, w) => s + w.payments.reduce((a, p) => a + p.amount, 0), 0);
    const balance = movements.reduce((s, m) => s + m.amount, 0);
    const allFlow = caisseFlowOf(movements);
    const stockValue = products.reduce((s, p) => s + p.currentQty * p.purchasePrice, 0);
    const comptoirValue = comptoir.reduce((s, c) => s + c.qty * c.unitPrice, 0);
    const destroyed = (destructions || []).filter(d => !d.recovered).reduce((s, d) => s + d.value, 0);
    return {
      deposits, withdrawals, salesPaid, purchasesPaid, exp, expCash, salaries, balance,
      cashIn: allFlow.in, cashOut: allFlow.out,
      stockValue, comptoirValue, destroyed, tresorerie: balance + stockValue + comptoirValue,
    };
  }, [caisse, sales, purchases, expenses, workers, products, comptoir, destructions, movements]);

  // ── Period flows — lus sur les MÊMES mouvements que le solde ──
  const flow = useMemo(() => {
    const rows = movements.filter(m => inPeriod(m.date, period, from, to));
    const f = caisseFlowOf(rows);
    return { inTotal: f.in, outTotal: f.out, net: f.in - f.out };
  }, [movements, period, from, to]);

  // ── Destructions de la période (pertes de marchandise) ─────────────────────
  const destructionsInPeriod = useMemo(
    () => (destructions || [])
      .filter(d => !d.recovered && inPeriod(d.date, period, from, to))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [destructions, period, from, to]);
  const destroyedInPeriod = destructionsInPeriod.reduce((s, d) => s + d.value, 0);

  // ── Category breakdown ──
  const byCat = (type: 'deposit' | 'withdraw') => {
    const m: Record<string, number> = {};
    caisse.filter(c => c.type === type && inPeriod(c.date, period, from, to)).forEach(c => { const k = c.category || 'Autre'; m[k] = (m[k] || 0) + c.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const deposCats = byCat('deposit'); const withCats = byCat('withdraw');
  const maxDepo = Math.max(1, ...deposCats.map(x => x[1])); const maxWith = Math.max(1, ...withCats.map(x => x[1]));

  const txList = useMemo(() => [...caisse]
    .filter(c => inPeriod(c.date, period, from, to) && (!catFilter || (c.category || 'Autre') === catFilter))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [caisse, period, from, to, catFilter]);

  const del = () => { if (toDelete) { biz.remove('caisse', toDelete.id); toast.success('Transaction supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-6">
      <PageHeader icon={Wallet} title="Caisse" subtitle={`${cfg.label} — trésorerie, mouvements & sessions de travail`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Dépôt / Retrait</button> : undefined} />

      <CafeteriaSwitcher current={moduleKey} />

      <Tabs
        tabs={[
          { id: 'tresorerie', label: 'Trésorerie', icon: Wallet },
          { id: 'sessions', label: 'Sessions de travail', icon: Clock },
        ]}
        active={tab}
        onChange={id => setTab(id as 'tresorerie' | 'sessions')}
      />

      {tab === 'sessions' && <SessionsPanel moduleKey={moduleKey} />}

      {tab === 'tresorerie' && <>
      {/* Hero banners */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
          <div className="flex items-center gap-2 text-blue-200"><Wallet className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Solde de caisse</span></div>
          <p className="text-4xl font-black tabular-nums mt-2 text-[#FFB800]">{money(totals.balance)}</p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {/* Entrées et sorties lues sur les mouvements du tiroir : une dépense
                réglée par la banque n'y figure pas — elle n'en est jamais sortie. */}
            <div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase text-blue-200 font-bold">Encaissements</p><p className="font-black tabular-nums text-emerald-300">{money(totals.cashIn)}</p></div>
            <div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase text-blue-200 font-bold">Décaissements</p><p className="font-black tabular-nums text-red-300">{money(totals.cashOut)}</p></div>
          </div>
          <p className="text-[11px] text-blue-200 mt-3">
            Les dépenses réglées <strong>en espèces</strong> sortent de cette caisse — la caisse générale n'est
            jamais débitée à sa place.
          </p>
        </div>
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100"><PiggyBank className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Trésorerie globale</span></div>
          <p className="text-4xl font-black tabular-nums mt-2">{money(totals.tresorerie)}</p>
          <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Caisse</p><p className="font-black tabular-nums">{money(totals.balance)}</p></div>
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Comptoir</p><p className="font-black tabular-nums">{money(totals.comptoirValue)}</p></div>
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Stock</p><p className="font-black tabular-nums">{money(totals.stockValue)}</p></div>
          </div>
          {totals.destroyed > 0 && (
            <p className="text-[11px] text-emerald-100 mt-3">
              Dont <span className="font-black text-red-200">{money(totals.destroyed)}</span> de marchandise détruite,
              déjà retirée du stock.
            </p>
          )}
        </div>
      </div>

      {/* Period */}
      <div className="card-glass p-4"><PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} /></div>

      {/* Flow cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-emerald-600"><ArrowDownCircle className="w-5 h-5" /><span className="text-xs font-bold uppercase">Entrées</span></div><p className="text-2xl font-black tabular-nums text-emerald-600 mt-2">+{money(flow.inTotal)}</p></div>
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-red-600"><ArrowUpCircle className="w-5 h-5" /><span className="text-xs font-bold uppercase">Sorties</span></div><p className="text-2xl font-black tabular-nums text-red-600 mt-2">−{money(flow.outTotal)}</p></div>
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-[#003087]"><TrendingUp className="w-5 h-5" /><span className="text-xs font-bold uppercase">Flux net</span></div><p className={`text-2xl font-black tabular-nums mt-2 ${flow.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(flow.net)}</p></div>
        <div className="card-glass p-5">
          <div className="flex items-center gap-2 text-amber-600"><Flame className="w-5 h-5" /><span className="text-xs font-bold uppercase">Résultat après pertes</span></div>
          <p className={`text-2xl font-black tabular-nums mt-2 ${flow.net - destroyedInPeriod >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(flow.net - destroyedInPeriod)}</p>
          <p className="text-[11px] text-slate-400 mt-1">Flux net − {money(destroyedInPeriod)} de destructions</p>
        </div>
      </div>

      {/* Business stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={TrendingUp} label="Ventes encaissées" value={money(totals.salesPaid)} tone="green" />
        <StatCard icon={ShoppingCart} label="Achats payés" value={money(totals.purchasesPaid)} tone="purple" />
        <StatCard icon={CreditCard} label="Dépenses" value={money(totals.exp)} tone="red"
          sub={`dont ${money(totals.expCash)} en espèces`} />
        <StatCard icon={Banknote} label="Salaires versés" value={money(totals.salaries)} tone="amber" />
        <StatCard icon={Flame} label="Destructions" value={money(totals.destroyed)} tone="red" sub="marchandise perdue" />
      </div>

      {/* Destructions de la période — le détail de la marchandise perdue */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Flame className="w-5 h-5" /> Destructions de la période
          </h3>
          <span className="font-black tabular-nums text-red-600">−{money(destroyedInPeriod)}</span>
        </div>
        {destructionsInPeriod.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">Aucune destruction sur la période</p>
        ) : (
          <>
            <Table head={<>
              <th className="table-head">Date</th><th className="table-head">Produit</th>
              <th className="table-head">Provenance</th><th className="table-head">Quantité</th>
              <th className="table-head">Motif</th><th className="table-head">Agent</th>
              <th className="table-head text-right">Coût</th>
            </>}>
              {destructionsInPeriod.slice(0, 100).map(d => (
                <tr key={d.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(d.date)}</td>
                  <td className="table-cell font-bold text-slate-700">{d.productName}</td>
                  <td className="table-cell">
                    <Badge tone={d.source === 'stock' ? 'primary' : 'neutral'}>
                      {d.source === 'stock' ? 'Gestion de stock' : 'Comptoir'}
                    </Badge>
                  </td>
                  <td className="table-cell tabular-nums">{d.qty} <span className="text-xs text-slate-400">{d.unit}</span></td>
                  <td className="table-cell text-slate-500">{d.reason || '—'}</td>
                  <td className="table-cell text-slate-500">{d.createdBy || '—'}</td>
                  <td className="table-cell text-right tabular-nums font-bold text-red-600">{money(d.value)}</td>
                </tr>
              ))}
            </Table>
            <p className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-400">
              La marchandise détruite ne sort pas d'espèces de la caisse : elle diminue la valeur du stock et le
              résultat de la partie. Le détail complet est dans « Gestion de stock → Historique destructions ».
            </p>
          </>
        )}
      </div>

      {/* Category breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CategoryCard title="Dépôts par catégorie" icon={ArrowDownCircle} rows={deposCats} max={maxDepo} tone="emerald" onClick={setCatFilter} active={catFilter} />
        <CategoryCard title="Retraits par catégorie" icon={ArrowUpCircle} rows={withCats} max={maxWith} tone="red" onClick={setCatFilter} active={catFilter} />
      </div>

      {/* Transactions history */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><Layers className="w-5 h-5" /> Transactions de caisse</h3>
          {catFilter && <button onClick={() => setCatFilter(null)} className="text-xs text-slate-400 hover:text-red-500">Retirer filtre: {catFilter}</button>}
        </div>
        {txList.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">Aucune transaction sur la période</p> : (
          <div className="divide-y divide-slate-100">
            {txList.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tx.type === 'deposit' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                  {tx.type === 'deposit' ? <ArrowDownCircle className="w-5 h-5" /> : <ArrowUpCircle className="w-5 h-5" />}</div>
                <div className="flex-1 min-w-0"><p className="font-bold text-slate-700 truncate">{tx.description || (tx.type === 'deposit' ? 'Dépôt' : 'Retrait')}</p>
                  <p className="text-xs text-slate-400">{formatDate(tx.date)} {tx.category && <>• <Badge tone="neutral">{tx.category}</Badge></>}</p></div>
                <span className={`font-black tabular-nums ${tx.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>{tx.type === 'deposit' ? '+' : '−'}{money(tx.amount)}</span>
                <div className="flex items-center gap-1">
                  {perm.modifier && <button onClick={() => setForm(tx)} className="w-8 h-8 rounded-lg text-amber-600 hover:bg-amber-50 flex items-center justify-center"><Edit2 className="w-4 h-4" /></button>}
                  {perm.supprimer && <button onClick={() => setToDelete(tx)} className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Le solde, mouvement par mouvement — ventes encaissées, achats réglés,
          dépenses en espèces, salaires et virements. C'est la lecture complète
          du chiffre affiché en tête : un solde qu'on ne peut pas relire n'est
          pas un solde, c'est une affirmation. */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Wallet className="w-5 h-5" /> Détail du solde de caisse
          </h3>
          <span className={`font-black tabular-nums ${flow.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {money(flow.net)} sur la période
          </span>
        </div>
        {(() => {
          const rows = movements.filter(m => inPeriod(m.date, period, from, to));
          if (rows.length === 0) return <p className="text-center text-slate-400 text-sm py-8">Aucun mouvement sur la période</p>;
          return (
            <Table head={<>
              <th className="table-head">Date</th><th className="table-head">Nature</th>
              <th className="table-head">Description</th><th className="table-head text-right">Montant</th>
            </>}>
              {rows.slice(0, 200).map(m => (
                <tr key={m.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="table-cell"><Badge tone="neutral">{m.nature}</Badge></td>
                  <td className="table-cell text-slate-600">{m.label}</td>
                  <td className={`table-cell text-right tabular-nums font-bold ${m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}
                  </td>
                </tr>
              ))}
            </Table>
          );
        })()}
      </div>

      </>}

      {form && <TxForm moduleKey={moduleKey} initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
      <Confirm open={!!toDelete} title="Supprimer la transaction" message="Confirmer la suppression ?" onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Sessions de travail ───────────────────────────────────────────────────────
/**
 * History of every POS work session with, for each one: the cashier, the opening
 * float, the theoretical takings, what was actually declared at closing and the
 * resulting décalage. The opening float is deliberately excluded from the
 * theoretical figure — the worker owes only what they cashed in during the shift.
 *
 * Chaque session appartient à un employé : l'employé connecté ne voit ici que
 * les siennes, l'administrateur les voit toutes et peut clôturer celle qu'un
 * employé aurait oubliée.
 */
function SessionsPanel({ moduleKey }: { moduleKey: ModuleKey }) {
  const biz = useBiz(moduleKey);
  const { sales } = biz.state;
  const { visibleSessions: sessions, isAdmin, canClose } = useBizSessions(moduleKey);

  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [worker, setWorker] = useState('all');
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [viewing, setViewing] = useState<BizSession | null>(null);
  const [closing, setClosing] = useState<BizSession | null>(null);

  /** Live figures — a still-open session has no frozen numbers yet. */
  const figuresOf = (s: BizSession) => {
    const own = sales.filter(x => x.sessionId === s.id && x.status !== 'retournée');
    const total = own.reduce((a, x) => a + x.total, 0);
    const theoretical = s.theoretical ?? own.reduce((a, x) => a + x.paid, 0);
    const credit = s.credit ?? own.reduce((a, x) => a + x.rest, 0);
    const declared = s.closingCash;
    const decalage = s.decalage ?? (declared === undefined ? undefined : declared - theoretical);
    return { count: own.length, total, theoretical, credit, declared, decalage, sales: own };
  };

  const workerNames = useMemo(
    () => Array.from(new Set(sessions.map(s => s.workerName))).sort(),
    [sessions]);

  const filtered = useMemo(() => [...sessions]
    .filter(s =>
      inPeriod(s.openedAt, period, from, to) &&
      (worker === 'all' || s.workerName === worker) &&
      (status === 'all' || s.status === status) &&
      (sessionFilter === 'all' || s.id === sessionFilter))
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()),
    [sessions, period, from, to, worker, status, sessionFilter]);

  const totals = useMemo(() => filtered.reduce((acc, s) => {
    const f = figuresOf(s);
    acc.theoretical += f.theoretical;
    acc.declared += f.declared || 0;
    acc.credit += f.credit;
    acc.decalage += f.decalage || 0;
    acc.openingCash += s.openingCash;
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, { theoretical: 0, declared: 0, credit: 0, decalage: 0, openingCash: 0 }), [filtered, sales]);

  /** Per-worker recap over the filtered period. */
  const perWorker = useMemo(() => {
    const m: Record<string, { sessions: number; theoretical: number; declared: number; credit: number; decalage: number }> = {};
    filtered.forEach(s => {
      const f = figuresOf(s);
      (m[s.workerName] ||= { sessions: 0, theoretical: 0, declared: 0, credit: 0, decalage: 0 });
      m[s.workerName].sessions += 1;
      m[s.workerName].theoretical += f.theoretical;
      m[s.workerName].declared += f.declared || 0;
      m[s.workerName].credit += f.credit;
      m[s.workerName].decalage += f.decalage || 0;
    });
    return Object.entries(m).sort((a, b) => b[1].theoretical - a[1].theoretical);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sales]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Sessions" value={filtered.length} tone="blue" />
        <StatCard icon={TrendingUp} label="Théorique espèces" value={money(totals.theoretical)} tone="green" />
        <StatCard icon={Banknote} label="Déclaré à la fermeture" value={money(totals.declared)} tone="purple" />
        <StatCard icon={Scale} label="Décalage cumulé" value={money(totals.decalage)} tone={totals.decalage < 0 ? 'red' : 'amber'} />
      </div>

      <div className="card-glass p-4 space-y-3">
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <div className="flex flex-wrap items-center gap-3">
          <Select value={worker} onChange={e => setWorker(e.target.value)} className="!w-auto min-w-[170px]">
            <option value="all">Tous les employés</option>
            {workerNames.map(w => <option key={w} value={w}>{w}</option>)}
          </Select>
          <Select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} className="!w-auto min-w-[190px]">
            <option value="all">Toutes les sessions</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.ref} — {s.workerName} — {formatDate(s.openedAt)}</option>
            ))}
          </Select>
          <div className="flex gap-1.5">
            {(['all', 'open', 'closed'] as const).map(st => (
              <button key={st} onClick={() => setStatus(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status === st ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                {st === 'all' ? 'Toutes' : st === 'open' ? 'Ouvertes' : 'Clôturées'}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400 ml-auto">
            Fonds d'ouverture cumulés : {money(totals.openingCash)} (hors théorique)
          </span>
        </div>
      </div>

      {/* Per-worker recap */}
      {perWorker.length > 0 && (
        <div className="card-glass overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-black text-[#002d87] flex items-center gap-2"><UserCheck className="w-5 h-5" /> Récapitulatif par employé</h3>
          </div>
          <Table head={<>
            <th className="table-head">Employé</th><th className="table-head">Sessions</th>
            <th className="table-head">Théorique</th><th className="table-head">Déclaré</th>
            <th className="table-head">Crédits</th><th className="table-head text-right">Décalage</th>
          </>}>
            {perWorker.map(([name, v]) => (
              <tr key={name}>
                <td className="table-cell font-bold">{name}</td>
                <td className="table-cell tabular-nums">{v.sessions}</td>
                <td className="table-cell tabular-nums">{money(v.theoretical)}</td>
                <td className="table-cell tabular-nums">{money(v.declared)}</td>
                <td className="table-cell tabular-nums text-amber-600">{money(v.credit)}</td>
                <td className={`table-cell text-right tabular-nums font-bold ${v.decalage < 0 ? 'text-red-600' : v.decalage > 0 ? 'text-[#003087]' : 'text-emerald-600'}`}>
                  {money(v.decalage)}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {/* Session history */}
      {filtered.length === 0 ? (
        <EmptyState icon={Clock} title="Aucune session"
          message="Les sessions ouvertes depuis le point de vente apparaîtront ici avec tout leur détail." />
      ) : (
        <div className="card-glass overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-black text-[#002d87] flex items-center gap-2"><Layers className="w-5 h-5" /> Historique des sessions</h3>
          </div>
          <Table head={<>
            <th className="table-head">Session</th><th className="table-head">Employé</th>
            <th className="table-head">Ouverture</th><th className="table-head">Fermeture</th>
            <th className="table-head">Fond</th><th className="table-head">Ventes</th>
            <th className="table-head">Théorique</th><th className="table-head">Déclaré</th>
            <th className="table-head">Crédits</th><th className="table-head text-right">Décalage</th>
            <th className="table-head text-right">—</th>
          </>}>
            {filtered.map(s => {
              const f = figuresOf(s);
              return (
                <tr key={s.id}>
                  <td className="table-cell font-bold">{s.ref}</td>
                  <td className="table-cell">{s.workerName}</td>
                  <td className="table-cell whitespace-nowrap text-xs">{new Date(s.openedAt).toLocaleString('fr-DZ')}</td>
                  <td className="table-cell whitespace-nowrap text-xs">
                    {s.closedAt ? new Date(s.closedAt).toLocaleString('fr-DZ') : <Badge tone="warning">Ouverte</Badge>}
                  </td>
                  <td className="table-cell tabular-nums text-slate-400">{money(s.openingCash)}</td>
                  <td className="table-cell tabular-nums">{f.count}</td>
                  <td className="table-cell tabular-nums">{money(f.theoretical)}</td>
                  <td className="table-cell tabular-nums">{f.declared === undefined ? '—' : money(f.declared)}</td>
                  <td className="table-cell tabular-nums text-amber-600">{money(f.credit)}</td>
                  <td className={`table-cell text-right tabular-nums font-bold ${f.decalage === undefined ? 'text-slate-300' : f.decalage < 0 ? 'text-red-600' : f.decalage > 0 ? 'text-[#003087]' : 'text-emerald-600'}`}>
                    {f.decalage === undefined ? '—' : money(f.decalage)}
                  </td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Clôture : le propriétaire de la session, ou l'admin
                          quand l'employé est parti sans clôturer. */}
                      {s.status === 'open' && canClose(s) && (
                        <button onClick={() => setClosing(s)} title="Clôturer cette session"
                          className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center">
                          <StopCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => setViewing(s)} title="Détails"
                        className="w-8 h-8 rounded-lg text-blue-600 hover:bg-blue-50 flex items-center justify-center">
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}

      {viewing && <SessionDetail session={viewing} figures={figuresOf(viewing)} onClose={() => setViewing(null)} />}
      {closing && <CloseSessionModal moduleKey={moduleKey} session={closing} onClose={() => setClosing(null)} />}

      {!isAdmin && (
        <p className="text-[11px] text-slate-400">
          Vous ne voyez que vos propres sessions de travail : celles de vos collègues ne vous
          appartiennent pas et ne peuvent pas être modifiées depuis votre poste.
        </p>
      )}
    </div>
  );
}

function SessionDetail({ session, figures, onClose }: {
  session: BizSession;
  figures: { count: number; total: number; theoretical: number; credit: number; declared?: number; decalage?: number; sales: BizSale[] };
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} icon={Clock} size="2xl"
      title={`Session ${session.ref}`} subtitle={`${session.workerName} — ${formatDate(session.openedAt)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Ouverte le</p><p className="font-bold text-slate-700 text-sm">{new Date(session.openedAt).toLocaleString('fr-DZ')}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Clôturée le</p><p className="font-bold text-slate-700 text-sm">{session.closedAt ? new Date(session.closedAt).toLocaleString('fr-DZ') : '—'}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Fond d'ouverture</p><p className="font-bold text-slate-700 text-sm tabular-nums">{money(session.openingCash)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Statut</p><p className="font-bold text-slate-700 text-sm">{session.status === 'open' ? 'Ouverte' : 'Clôturée'}</p></div>
        </div>

        {/* Traçabilité : qui a ouvert la caisse, qui l'a effectivement clôturée. */}
        {(session.openedByName || session.closedByName) && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">Ouverte par</p>
              <p className="font-bold text-slate-700 text-sm">{session.openedByName || session.workerName}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">Clôturée par</p>
              <p className="font-bold text-slate-700 text-sm">{session.closedByName || '—'}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Chiffre d'affaires</p><p className="font-black text-slate-700 tabular-nums">{money(figures.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Théorique espèces</p><p className="font-black text-emerald-600 tabular-nums">{money(figures.theoretical)}</p></div>
          <div className="rounded-xl bg-purple-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Déclaré</p><p className="font-black text-purple-600 tabular-nums">{figures.declared === undefined ? '—' : money(figures.declared)}</p></div>
          <div className={`rounded-xl p-3 text-center ${(figures.decalage || 0) < 0 ? 'bg-red-50' : 'bg-blue-50'}`}>
            <p className="text-[10px] uppercase font-bold text-slate-400">Décalage</p>
            <p className={`font-black tabular-nums ${(figures.decalage || 0) < 0 ? 'text-red-600' : 'text-[#003087]'}`}>
              {figures.decalage === undefined ? '—' : money(figures.decalage)}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
          Crédits accordés pendant la session : <strong>{money(figures.credit)}</strong> — ils justifient d'autant
          l'écart entre le théorique et les espèces comptées. Le fond d'ouverture de {money(session.openingCash)} n'est
          pas compté dans le théorique.
        </div>

        {session.notes && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Notes</p>
            <p className="text-sm text-slate-600">{session.notes}</p>
          </div>
        )}

        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Ventes de la session ({figures.count})</p>
          {figures.sales.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune vente</p>
          ) : (
            <Table head={<>
              <th className="table-head">Réf</th><th className="table-head">Heure</th><th className="table-head">Client</th>
              <th className="table-head">Articles</th><th className="table-head">Total</th>
              <th className="table-head">Payé</th><th className="table-head">Reste</th>
            </>}>
              {figures.sales.map(s => (
                <tr key={s.id}>
                  <td className="table-cell font-bold">{s.ref}</td>
                  <td className="table-cell text-xs">{new Date(s.date).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="table-cell">{s.clientName}</td>
                  <td className="table-cell text-xs text-slate-500">
                    {s.items.map(i => `${i.productName} ×${i.detailQty ? `${i.detailQty}${i.detailUnit || ''}` : i.qty}`).join(', ')}
                  </td>
                  <td className="table-cell tabular-nums">{money(s.total)}</td>
                  <td className="table-cell tabular-nums text-emerald-600">{money(s.paid)}</td>
                  <td className="table-cell tabular-nums text-red-600">{money(s.rest)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CategoryCard({ title, icon: Icon, rows, max, tone, onClick, active }: {
  title: string; icon: React.ElementType; rows: [string, number][]; max: number; tone: 'emerald' | 'red'; onClick: (c: string | null) => void; active: string | null;
}) {
  return (
    <div className="card-glass p-5">
      <h3 className="font-black text-[#002d87] flex items-center gap-2 mb-3"><Icon className="w-5 h-5" /> {title}</h3>
      {rows.length === 0 ? <p className="text-slate-400 text-sm">Aucune donnée</p> : (
        <div className="space-y-2.5">
          {rows.map(([cat, val]) => (
            <button key={cat} onClick={() => onClick(active === cat ? null : cat)} className={`w-full text-left ${active === cat ? 'opacity-100' : ''}`}>
              <div className="flex items-center justify-between text-sm mb-1"><span className="font-semibold text-slate-600">{cat}</span><span className="font-bold tabular-nums text-slate-700">{money(val)}</span></div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${(val / max) * 100}%` }} /></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ─── Un mouvement du tiroir ────────────────────────────────────────────────────
 *
 * Trois natures, et la troisième est celle qui manquait :
 *   • DÉPÔT    — de l'argent entre (apport du gérant, fond de caisse) ;
 *   • RETRAIT  — de l'argent sort (prélèvement, achat réglé de la main à la main) ;
 *   • TRANSFERT avec la CAISSE GÉNÉRALE.
 *
 * POURQUOI LE TRANSFERT EST À PART
 * Une remontée de fonds n'est pas un retrait : l'argent n'a pas quitté
 * l'enseigne, il a changé de coffre. Saisie comme un simple retrait ici puis
 * comme un simple dépôt là-bas, elle donnait DEUX lignes indépendantes — et la
 * moindre faute de frappe faisait diverger les deux caisses pour toujours.
 *
 * Le transfert écrit donc les deux côtés en une seule action, chacun portant la
 * référence de l'autre (`linkedTxId`). Les deux écrans lisent la même opération.
 */
function TxForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizCaisseTx | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const cfg = MODULES[moduleKey];
  const dispatch = useAppDispatch();
  const { currentUserName, generalCash } = useAppState();
  const isEdit = !!initial;

  type Nature = 'deposit' | 'withdraw' | 'to_general' | 'from_general';
  const initialNature: Nature = initial?.transfer || initial?.type || 'deposit';

  const [nature, setNature] = useState<Nature>(initialNature);
  const [amount, setAmount] = useState(initial?.amount || 0);
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState(initial?.category || '');
  const [description, setDescription] = useState(initial?.description || '');

  const isTransfer = nature === 'to_general' || nature === 'from_general';
  /** Le solde du coffre général — on ne peut pas en sortir ce qu'il n'a pas. */
  const generalBalance = useMemo(() => generalCashBalance(generalCash), [generalCash]);

  const save = () => {
    if (amount <= 0) { toast.error('Montant requis'); return; }
    if (nature === 'from_general' && amount > generalBalance + 0.004) {
      toast.error(`La caisse générale ne contient que ${money(generalBalance)}`);
      return;
    }

    const iso = new Date(date).toISOString();
    const id = initial?.id || newId();
    const tx: BizCaisseTx = {
      id,
      // Une remontée SORT du tiroir de la cafétéria, un apport y ENTRE.
      type: nature === 'deposit' || nature === 'from_general' ? 'deposit' : 'withdraw',
      amount: Number(amount),
      date: iso,
      category: isTransfer ? 'Transfert' : category,
      description,
      transfer: isTransfer ? nature : undefined,
      createdBy: currentUserName || undefined,
    };

    if (isEdit) biz.update('caisse', tx); else biz.add('caisse', tx);

    // Le MIROIR au coffre général. Il n'est écrit qu'à la création : corriger un
    // transfert déjà passé demanderait de retrouver et réécrire les deux côtés,
    // ce qui se fait proprement en supprimant puis en resaisissant.
    if (isTransfer && !isEdit) {
      dispatch({
        type: 'ADD_GENERAL_TX',
        payload: {
          id: newId(),
          kind: nature === 'to_general' ? 'transfer_in' : 'transfer_out',
          amount: Number(amount),
          date: iso,
          label: nature === 'to_general'
            ? `Remontée de fonds — ${cfg.label}`
            : `Apport à ${cfg.label}`,
          category: 'Transfert',
          cafeteriaId: moduleKey,
          linkedTxId: id,
          notes: description || undefined,
          createdBy: currentUserName || undefined,
          createdAt: new Date().toISOString(),
        },
      });
    }

    toast.success(isEdit ? 'Mouvement modifié'
      : isTransfer ? 'Transfert enregistré des deux côtés' : 'Mouvement enregistré');
    onClose();
  };

  const NatureBtn = ({ id, label, icon: Icon, tone }: {
    id: Nature; label: string; icon: React.ElementType; tone: string;
  }) => (
    <button onClick={() => setNature(id)}
      className={`flex-1 min-w-[8rem] py-2.5 px-2 rounded-xl font-bold text-[12.5px] flex items-center justify-center gap-1.5 transition
        ${nature === id ? 'text-white shadow' : 'bg-[#F3EBE2] text-[#7A6A5C] hover:bg-[#E2D3C4]'}`}
      style={nature === id ? { background: tone } : undefined}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} icon={Wallet} size="md"
      title={isEdit ? 'Modifier le mouvement' : 'Mouvement de caisse'}
      subtitle={cfg.label}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Valider'}</button>
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <NatureBtn id="deposit"  label="Dépôt"   icon={ArrowDownCircle} tone="#059669" />
          <NatureBtn id="withdraw" label="Retrait" icon={ArrowUpCircle}   tone="#dc2626" />
        </div>
        <div className="flex flex-wrap gap-2">
          <NatureBtn id="to_general"   label="Vers caisse générale"   icon={ArrowUpCircle}   tone="#6F4E37" />
          <NatureBtn id="from_general" label="Depuis caisse générale" icon={ArrowDownCircle} tone="#B8763E" />
        </div>

        {isTransfer && (
          <div className="rounded-xl border border-[#E7C9A9] bg-[#F5E7D8]/70 px-3.5 py-2.5 text-[11.5px] text-[#8A5A2B] leading-relaxed">
            {nature === 'to_general'
              ? <>L'argent quitte le tiroir de <b>{cfg.label}</b> et entre à la <b>caisse générale</b>.</>
              : <>L'argent sort de la <b>caisse générale</b> et entre au tiroir de <b>{cfg.label}</b>.</>}
            {' '}Une seule saisie, les deux caisses sont mises à jour.
            <span className="block mt-1 font-bold">
              Caisse générale actuellement : {money(generalBalance)}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)">
            <Input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} />
          </Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        {!isTransfer && (
          <Field label="Catégorie">
            <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex: Apport, Fond de caisse, Prélèvement…" />
          </Field>
        )}
        <Field label="Description">
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Facultatif" />
        </Field>
      </div>
    </Modal>
  );
}
