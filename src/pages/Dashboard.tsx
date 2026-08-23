/**
 * ─── Tableau de bord ───────────────────────────────────────────────────────────
 *
 * DEUX LECTURES, ET LA BASCULE ENTRE ELLES EST LE CŒUR DE L'ÉCRAN :
 *
 *  • CONSOLIDÉ — l'enseigne d'un coup d'œil : ce que TOUTES les cafétérias ont
 *    vendu, gagné, dépensé, et ce qu'elles détiennent.
 *  • UNE CAFÉTÉRIA — exactement les mêmes chiffres, mais pour ce comptoir seul.
 *
 * Les deux vues lisent le MÊME moteur de calcul (`computeModuleReport`) que les
 * rapports : un tableau de bord qui calcule « à sa façon » finit toujours par
 * annoncer un chiffre d'affaires différent de celui du rapport, et plus personne
 * ne sait lequel croire.
 *
 * Un EMPLOYÉ n'a pas de vue consolidée : il ne voit que sa cafétéria, et la
 * bascule n'existe même pas dans son rendu.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Coffee, TrendingUp, ShoppingCart, CircleDollarSign, Wallet, Boxes, Users,
  CreditCard, AlertTriangle, ArrowRight, Layers, Vault, ScanLine, Truck,
  ReceiptText, ChefHat, BarChart3, Calendar, Store, PiggyBank,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/src/lib/utils';
import { useAppState, useVisibleCafeteriaIds, generalCashBalance } from '@/src/store/AppContext';
import { useBizAll, useCafeterias } from '@/src/store/BizContext';
import { computeModuleReport, PartReport } from '@/src/lib/bizReporting';
import { computeModuleAnalytics, pickGranularity } from '@/src/lib/bizAnalytics';
import { routeBaseOf, Cafeteria, isReversedSale } from '@/src/lib/bizConfig';
import { money, formatDate } from '@/src/components/biz/Kit';
import ChartBox from '@/src/components/ChartBox';
import { useCafeteriaAlerts, useDismissedAlerts } from '@/src/hooks/useCafeteriaAlerts';

const AXIS = { fontSize: 11, fill: '#A39588' } as const;

/** Le premier jour du mois en cours — la période que le tableau de bord ouvre. */
function monthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

type Range = 'today' | 'week' | 'month' | 'year';

const RANGE_LABEL: Record<Range, string> = {
  today: "Aujourd'hui", week: '7 derniers jours', month: 'Ce mois-ci', year: 'Cette année',
};

function rangeOf(r: Range): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (r === 'today') return { from: to, to };
  if (r === 'week') {
    const d = new Date(now.getTime() - 6 * 86_400_000);
    return { from: d.toISOString().slice(0, 10), to };
  }
  if (r === 'year') return { from: `${now.getFullYear()}-01-01`, to };
  return monthRange();
}

export default function Dashboard() {
  const navigate = useNavigate();
  const app = useAppState();
  const biz = useBizAll();
  const allCafeterias = useCafeterias();

  const allIds = useMemo(() => allCafeterias.map(c => c.id), [allCafeterias]);
  const visibleIds = useVisibleCafeteriaIds(allIds);
  const visible = useMemo(
    () => allCafeterias.filter(c => visibleIds.includes(c.id)),
    [allCafeterias, visibleIds]);

  const isAdmin = app.currentUserRole !== 'module_worker';
  /** `all` = consolidé. Un employé démarre — et reste — sur sa cafétéria. */
  const [scope, setScope] = useState<string>(isAdmin ? 'all' : (visibleIds[0] || 'all'));
  const [range, setRange] = useState<Range>('month');

  const { from, to } = useMemo(() => rangeOf(range), [range]);

  /** Le rapport de chaque cafétéria visible — un seul calcul, réutilisé partout. */
  const reports = useMemo(() => visible.map(caf => ({
    cafeteria: caf,
    report: computeModuleReport(biz.modules[caf.id] || ({} as any), caf.id, from, to),
  })).filter(r => !!r.report), [visible, biz, from, to]);

  const shown = useMemo(
    () => (scope === 'all' ? reports : reports.filter(r => r.cafeteria.id === scope)),
    [reports, scope]);

  /** Les totaux de la sélection — la somme, jamais une moyenne. */
  const t = useMemo(() => {
    const sum = (f: (r: PartReport) => number) => shown.reduce((s, x) => s + f(x.report), 0);
    return {
      sales: sum(r => r.salesTotal),
      cogs: sum(r => r.cogs),
      margin: sum(r => r.grossMargin),
      purchases: sum(r => r.purchasesTotal),
      expenses: sum(r => r.expensesTotal),
      salaries: sum(r => r.salariesPaid),
      net: sum(r => r.netGain),
      caisse: sum(r => r.caisseBalance),
      stock: sum(r => r.stockValue),
      clientDebt: sum(r => r.clientDebtTotal),
      supplierDebt: sum(r => r.supplierDebtTotal),
      operations: sum(r => r.counts.sales),
      products: sum(r => r.counts.products),
      workers: sum(r => r.counts.workers),
      clients: sum(r => r.counts.clients),
    };
  }, [shown]);

  const general = useMemo(() => generalCashBalance(app.generalCash), [app.generalCash]);

  /** La courbe : une série par cafétéria affichée, sur le même découpage. */
  const grain = useMemo(() => pickGranularity(from, to), [from, to]);
  const analytics = useMemo(() => shown.map(x => ({
    cafeteria: x.cafeteria,
    data: computeModuleAnalytics(biz.modules[x.cafeteria.id] || ({} as any), x.cafeteria.id, from, to, grain),
  })), [shown, biz, from, to, grain]);

  const timeline = useMemo(() => {
    const first = analytics[0]?.data.points || [];
    return first.map((p, i) => {
      const row: Record<string, any> = { label: p.label };
      let total = 0;
      for (const a of analytics) {
        const v = a.data.points[i]?.revenue || 0;
        row[a.cafeteria.id] = v;
        total += v;
      }
      row.total = total;
      return row;
    });
  }, [analytics]);

  /** Ce qui se vend le mieux, toutes cafétérias affichées confondues. */
  const best = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; qty: number; gain: number }>();
    for (const x of shown) {
      for (const p of x.report.salesByProduct) {
        const key = p.name;
        const row = map.get(key) || { name: p.name, revenue: 0, qty: 0, gain: 0 };
        row.revenue += p.revenue; row.qty += p.qty; row.gain += p.gain;
        map.set(key, row);
      }
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [shown]);

  const { dismissedIds } = useDismissedAlerts();
  const alerts = useCafeteriaAlerts(biz, scope === 'all' ? visible : visible.filter(c => c.id === scope), dismissedIds);

  const scopeCaf = scope === 'all' ? null : visible.find(c => c.id === scope) || null;

  return (
    <div className="space-y-6">
      {/* ── En-tête + bascule de portée ───────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
              style={{ background: 'var(--grad-caramel)' }}>
              {scopeCaf ? (scopeCaf.emoji || '☕') : '📊'}
            </span>
            {scopeCaf ? scopeCaf.name : (app.settings.name || 'Altech Cafétéria')}
          </h1>
          <p className="text-[12.5px] text-[#A39588] mt-1">
            {scopeCaf
              ? 'Les chiffres de ce comptoir seul'
              : `Vue consolidée — ${visible.length} cafétéria(s)`}
            {' · '}{formatDate(from)} → {formatDate(to)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(RANGE_LABEL) as Range[]).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={cn('px-3 py-1.5 rounded-lg text-[11.5px] font-bold transition border',
                range === r ? 'bg-[#4B3621] text-white border-[#4B3621]'
                  : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}>
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Le sélecteur de cafétéria — invisible pour un employé, qui n'en a qu'une. */}
      {isAdmin && visible.length > 1 && (
        <div className="card-glass p-3 flex flex-wrap items-center gap-1.5">
          <Layers className="w-4 h-4 text-[#8A5A2B] ml-1" />
          <button onClick={() => setScope('all')}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-bold transition border',
              scope === 'all' ? 'bg-[#4B3621] text-white border-[#4B3621]'
                : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}>
            🏢 Toutes les cafétérias
          </button>
          {visible.map(c => (
            <button key={c.id} onClick={() => setScope(c.id)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-bold transition border',
                scope === c.id ? 'text-white border-transparent shadow'
                  : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}
              style={scope === c.id ? { background: c.color || '#6F4E37' } : undefined}>
              {c.emoji || '☕'} {c.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Les chiffres ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} tone="green" label="Chiffre d'affaires" value={money(t.sales)}
          sub={`${t.operations} vente(s)`} />
        <Kpi icon={Layers} tone="cyan" label="Marge brute" value={money(t.margin)}
          sub={`coût marchandises ${money(t.cogs)}`} />
        <Kpi icon={CircleDollarSign} tone={t.net >= 0 ? 'green' : 'red'} label="Gain net" value={money(t.net)}
          sub="charges et pertes déduites" />
        <Kpi icon={CreditCard} tone="red" label="Dépenses" value={money(t.expenses)}
          sub={t.salaries ? `dont salaires ${money(t.salaries)}` : 'sur la période'} />
        <Kpi icon={Wallet} tone={t.caisse < 0 ? 'red' : 'amber'} label="Espèces en caisse" value={money(t.caisse)}
          sub={scopeCaf ? 'tiroir du comptoir' : 'tous tiroirs confondus'} />
        <Kpi icon={Boxes} tone="purple" label="Valeur du stock" value={money(t.stock)}
          sub={`${t.products} référence(s)`} />
        <Kpi icon={ShoppingCart} tone="slate" label="Achats" value={money(t.purchases)}
          sub={t.supplierDebt ? `${money(t.supplierDebt)} dus` : 'réglés'} />
        <Kpi icon={Users} tone="blue" label="Crédits clients" value={money(t.clientDebt)}
          sub={`${t.clients} client(s)`} />
      </div>

      {/* ── Alertes ───────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="text-[11px] font-black uppercase tracking-widest text-amber-800">
              À traiter ({alerts.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {alerts.slice(0, 6).map(a => (
              <button key={a.id} onClick={() => navigate(a.link)}
                className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-amber-100 text-left hover:shadow transition">
                <span className={cn('w-1.5 h-full min-h-[2rem] rounded-full flex-shrink-0',
                  a.level === 'danger' ? 'bg-red-500' : a.level === 'warning' ? 'bg-amber-500' : 'bg-[#D4A373]')} />
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold text-[#2A2018]">{a.title}</span>
                  <span className="block text-[10.5px] text-[#A39588] truncate">{a.detail}</span>
                  {a.cafeteriaName && visible.length > 1 && (
                    <span className="block text-[9.5px] font-bold uppercase tracking-wide text-[#C9B7A5] mt-0.5">
                      {a.cafeteriaName}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── La courbe ─────────────────────────────────────────────────── */}
      {timeline.length > 1 && (
        <ChartBox title="Chiffre d'affaires" subtitle={`Découpage ${grain === 'day' ? 'journalier' : grain === 'week' ? 'hebdomadaire' : 'mensuel'}`} height={280}>
          <AreaChart data={timeline}>
            <defs>
              {analytics.map(a => (
                <linearGradient key={a.cafeteria.id} id={`g-${a.cafeteria.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={a.cafeteria.color || '#6F4E37'} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={a.cafeteria.color || '#6F4E37'} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#EFE5DA" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={70}
              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: any) => money(Number(v))}
              contentStyle={{ borderRadius: 12, border: '1px solid #EFE5DA', fontSize: 12 }} />
            {analytics.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {analytics.map(a => (
              <Area key={a.cafeteria.id} type="monotone" dataKey={a.cafeteria.id}
                name={a.cafeteria.name}
                stroke={a.cafeteria.color || '#6F4E37'} strokeWidth={2}
                fill={`url(#g-${a.cafeteria.id})`} />
            ))}
          </AreaChart>
        </ChartBox>
      )}

      {/* ── Comparaison des cafétérias ────────────────────────────────── */}
      {scope === 'all' && reports.length > 1 && (
        <section className="card-glass p-4">
          <div className="flex items-center gap-2 mb-3">
            <Store className="w-4 h-4 text-[#8A5A2B]" />
            <h3 className="text-[11px] font-black uppercase tracking-widest text-[#7A6A5C]">
              Cafétéria par cafétéria
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {reports.map(({ cafeteria, report }) => (
              <CafeteriaCard key={cafeteria.id} caf={cafeteria} report={report}
                onOpen={() => setScope(cafeteria.id)}
                onGo={(iface) => navigate(`${routeBaseOf(cafeteria.id)}/${iface}`)} />
            ))}
          </div>
        </section>
      )}

      {/* ── Meilleures ventes ─────────────────────────────────────────── */}
      {best.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartBox title="Ce qui se vend le mieux" subtitle="Chiffre d'affaires de la période" height={300}>
            <BarChart data={best} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EFE5DA" horizontal={false} />
              <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
              <YAxis type="category" dataKey="name" tick={{ ...AXIS, fontSize: 10 }} width={130}
                axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: any) => money(Number(v))}
                contentStyle={{ borderRadius: 12, border: '1px solid #EFE5DA', fontSize: 12 }} />
              <Bar dataKey="revenue" name="CA" radius={[0, 6, 6, 0]}>
                {best.map((_, i) => <Cell key={i} fill={i === 0 ? '#B8763E' : '#D4A373'} />)}
              </Bar>
            </BarChart>
          </ChartBox>

          <section className="card-glass p-4">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-[#7A6A5C] mb-3">
              Détail des meilleures ventes
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>
                  <th className="table-head">Produit</th>
                  <th className="table-head text-right">Qté</th>
                  <th className="table-head text-right">CA</th>
                  <th className="table-head text-right">Gain</th>
                </tr></thead>
                <tbody>
                  {best.map(p => (
                    <tr key={p.name}>
                      <td className="table-cell font-semibold truncate max-w-[14rem]">{p.name}</td>
                      <td className="table-cell text-right tabular-nums">{p.qty.toFixed(0)}</td>
                      <td className="table-cell text-right tabular-nums">{money(p.revenue)}</td>
                      <td className={cn('table-cell text-right tabular-nums font-bold',
                        p.gain >= 0 ? 'text-emerald-700' : 'text-red-600')}>{money(p.gain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ── Trésorerie de l'enseigne (administrateur) ─────────────────── */}
      {isAdmin && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={() => navigate('/general-cash')}
            className="rounded-2xl p-5 text-white text-left hover:shadow-lg transition"
            style={{ background: 'var(--grad-coffee)' }}>
            <div className="flex items-center gap-2 text-white/70">
              <Vault className="w-4 h-4" />
              <span className="text-[10.5px] font-black uppercase tracking-wider">Caisse générale</span>
            </div>
            <p className="text-2xl font-black tabular-nums mt-1.5 text-[#D4A373]">{money(general)}</p>
            <p className="text-[10.5px] text-white/55 mt-0.5 flex items-center gap-1">
              Ouvrir le coffre <ArrowRight className="w-3 h-3" />
            </p>
          </button>
          <Kpi icon={PiggyBank} tone="amber" label="Espèces aux comptoirs" value={money(t.caisse)}
            sub="tous tiroirs confondus" />
          <Kpi icon={Coffee} tone="purple" label="Trésorerie totale" value={money(general + t.caisse)}
            sub="coffre + tiroirs" />
        </section>
      )}

      {/* ── Raccourcis ────────────────────────────────────────────────── */}
      {scopeCaf && (
        <section className="card-glass p-4">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-[#7A6A5C] mb-3">
            Aller directement à
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {([
              ['pos', 'Point de vente', ScanLine],
              ['stock', 'Stock', Boxes],
              ['purchases', 'Achats', Truck],
              ['sales', 'Ventes', ReceiptText],
              ['production', 'Production', ChefHat],
              ['reports', 'Rapports', BarChart3],
            ] as const).map(([iface, label, Icon]) => (
              <button key={iface} onClick={() => navigate(`${routeBaseOf(scopeCaf.id)}/${iface}`)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[#EFE5DA] bg-white
                           hover:border-[#D4A373] hover:shadow transition">
                <Icon className="w-5 h-5 text-[#8A5A2B]" />
                <span className="text-[11px] font-bold text-[#4B3621] text-center leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Briques ──────────────────────────────────────────────────────────────────

const TONES: Record<string, { bg: string; fg: string }> = {
  green:  { bg: '#DCFCE7', fg: '#166534' },
  red:    { bg: '#FEE2E2', fg: '#991B1B' },
  amber:  { bg: '#FEF3C7', fg: '#92400E' },
  cyan:   { bg: '#CFFAFE', fg: '#155E75' },
  purple: { bg: '#EDE9FE', fg: '#5B21B6' },
  blue:   { bg: '#DBEAFE', fg: '#1E40AF' },
  slate:  { bg: '#F3EBE2', fg: '#7A6A5C' },
};

function Kpi({ icon: Icon, tone, label, value, sub }: {
  icon: React.ElementType; tone: keyof typeof TONES | string; label: string; value: string; sub?: string;
}) {
  const t = TONES[tone] || TONES.slate;
  return (
    <div className="stat-card">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: t.bg, color: t.fg }}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[10px] font-black uppercase tracking-wider text-[#A39588] leading-tight">{label}</span>
      </div>
      <p className="text-[22px] font-black tabular-nums text-[#2A2018] leading-none">{value}</p>
      {sub && <p className="text-[10.5px] text-[#A39588]">{sub}</p>}
    </div>
  );
}

/** La carte d'une cafétéria dans la vue consolidée. */
function CafeteriaCard({ caf, report, onOpen, onGo }: {
  caf: Cafeteria; report: PartReport; onOpen: () => void; onGo: (iface: string) => void;
}) {
  const color = caf.color || '#6F4E37';
  const lowStock = report.stockAlerts.length;

  return (
    <div className="caf-tint rounded-2xl border border-[#EFE5DA] bg-white p-4"
      style={{ ['--caf-color' as any]: color }}>
      <button onClick={onOpen} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="min-w-0">
          <span className="block text-[13.5px] font-black text-[#2A2018] truncate">
            {caf.emoji || '☕'} {caf.name}
          </span>
          <span className="block text-[10.5px] text-[#A39588]">
            {report.counts.sales} vente(s) · {report.counts.workers} employé(s)
          </span>
        </span>
        <ArrowRight className="w-4 h-4 text-[#C9B7A5] flex-shrink-0" />
      </button>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Mini label="CA" value={money(report.salesTotal)} />
        <Mini label="Gain net" value={money(report.netGain)} tone={report.netGain >= 0 ? 'green' : 'red'} />
        <Mini label="Caisse" value={money(report.caisseBalance)} tone={report.caisseBalance < 0 ? 'red' : undefined} />
        <Mini label="Stock" value={money(report.stockValue)} />
      </div>

      {lowStock > 0 && (
        <button onClick={() => onGo('stock')}
          className="mt-3 w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-100 text-[11px] font-bold text-red-700">
          <AlertTriangle className="w-3 h-3" /> {lowStock} produit(s) sous le seuil
        </button>
      )}
    </div>
  );
}

const Mini = ({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) => (
  <div className="rounded-xl bg-[#FAF6F1] px-2.5 py-2">
    <p className="text-[9px] font-black uppercase tracking-wide text-[#A39588]">{label}</p>
    <p className={cn('text-[13px] font-black tabular-nums',
      tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : 'text-[#2A2018]')}>
      {value}
    </p>
  </div>
);
