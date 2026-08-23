/**
 * ─── Rapports généraux ─────────────────────────────────────────────────────────
 *
 * La comptabilité de l'enseigne sur une période CHOISIE — date de début, date de
 * fin — avec, à chaque écran, la même bascule : le consolidé, ou une cafétéria
 * seule. C'est le principe qui tient toute l'application : chaque comptoir a des
 * chiffres indépendants, et l'enseigne est leur somme, jamais une moyenne.
 *
 * Cinq lectures :
 *   • BILAN      — le compte de résultat de la période, ligne par ligne, avec la
 *                  contribution de chaque cafétéria.
 *   • ANALYSES   — les courbes, les meilleures ventes, ce qui dort en stock.
 *   • STOCK      — ce qu'on détient, au prix d'achat ET au prix de vente.
 *   • INVENTAIRES— les comptages, leurs manquants, et qui en répond.
 *   • EMPLOYÉS   — la masse salariale, cafétéria par cafétéria.
 *
 * POURQUOI UN SEUL MOTEUR : le bilan, la fiche imprimable et le rapport d'une
 * cafétéria lisent tous `computeModuleReport`. Deux calculs séparés finiraient
 * par annoncer deux chiffres d'affaires différents pour le même mois.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Calendar, Printer, TrendingUp, ShoppingCart, CircleDollarSign,
  CreditCard, Boxes, Users, Truck, AlertTriangle, Layers, BarChart3, ClipboardList,
  UsersRound, Wallet, PackageX, Coffee, Filter, Vault,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAppState, generalCashBalance } from '@/src/store/AppContext';
import { useBizAll, useCafeterias } from '@/src/store/BizContext';
import { computeModuleReport, consolidate, PartReport } from '@/src/lib/bizReporting';
import { computeModuleAnalytics, consolidateAnalytics, pickGranularity, Granularity } from '@/src/lib/bizAnalytics';
import { computeStockValuation } from '@/src/lib/stockValuation';
import { summarizeInventaires } from '@/src/lib/inventaire';
import { Cafeteria } from '@/src/lib/bizConfig';
import { money, formatDate, PageHeader, Tabs, Table, Badge, Field, Input } from '@/src/components/biz/Kit';
import ReportView from '@/src/components/biz/ReportView';
import GlobalAnalyticsView from '@/src/components/biz/GlobalAnalyticsView';
import StockValueView from '@/src/components/biz/StockValueView';
import InventaireReportView from '@/src/components/biz/InventaireReportView';
import { GlobalFiche, ModuleFiche, printFiche } from '@/src/components/biz/ReportFiche';

type Tab = 'bilan' | 'analyses' | 'stock' | 'inventaires' | 'employes';

/** Le mois en cours — la période que l'écran propose d'emblée. */
function currentMonth() {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export default function GeneralReports() {
  const app = useAppState();
  const biz = useBizAll();
  const cafeterias = useCafeterias();
  const ficheRef = useRef<HTMLDivElement>(null);

  const init = currentMonth();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  /** La période RÉELLEMENT calculée — on ne recalcule pas à chaque frappe. */
  const [range, setRange] = useState(init);
  const [tab, setTab] = useState<Tab>('bilan');
  const [scope, setScope] = useState<string>('all');
  const [grain, setGrain] = useState<Granularity | undefined>(undefined);

  const shownCafeterias = useMemo(
    () => (scope === 'all' ? cafeterias : cafeterias.filter(c => c.id === scope)),
    [cafeterias, scope]);

  /** Un rapport par cafétéria affichée. */
  const parts = useMemo(
    () => shownCafeterias
      .filter(c => !!biz.modules[c.id])
      .map(c => computeModuleReport(biz.modules[c.id], c.id, range.from, range.to)),
    [shownCafeterias, biz, range]);

  const global = useMemo(() => consolidate(parts, range.from, range.to), [parts, range]);

  const g = useMemo(() => grain || pickGranularity(range.from, range.to), [grain, range]);
  const analytics = useMemo(
    () => shownCafeterias
      .filter(c => !!biz.modules[c.id])
      .map(c => computeModuleAnalytics(biz.modules[c.id], c.id, range.from, range.to, g)),
    [shownCafeterias, biz, range, g]);
  const globalAnalytics = useMemo(
    () => consolidateAnalytics(analytics, range.from, range.to, g),
    [analytics, range, g]);

  const valuation = useMemo(
    () => computeStockValuation(biz, shownCafeterias.map(c => c.id)),
    [biz, shownCafeterias]);

  const inventaires = useMemo(
    () => shownCafeterias.map(c => summarizeInventaires(
      biz.modules[c.id], c.id, c.name, c.emoji || '☕', range)),
    [shownCafeterias, biz, range]);

  const generalCash = useMemo(() => generalCashBalance(app.generalCash), [app.generalCash]);

  const generate = () => setRange({ from, to });

  /** Une seule cafétéria affichée : on montre SON rapport détaillé, pas la somme. */
  const single = scope !== 'all' ? parts[0] : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={FileSpreadsheet} title="Rapports généraux"
        subtitle="Comptabilité et analyses de l'enseigne, sur la période de votre choix"
        actions={
          <button className="btn-secondary" onClick={() => printFiche(ficheRef.current)}>
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        } />

      {/* ── La période ────────────────────────────────────────────────── */}
      <section className="card-glass p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Du"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          </div>
          <div className="w-40">
            <Field label="Au"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
          </div>
          <button className="btn-primary" onClick={generate}>
            <Calendar className="w-4 h-4" /> Générer
          </button>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {([
              ['Ce mois', currentMonth()],
              ['Mois dernier', lastMonth()],
              ['Ce trimestre', quarter()],
              ['Cette année', year()],
            ] as const).map(([label, r]) => (
              <button key={label}
                onClick={() => { setFrom(r.from); setTo(r.to); setRange(r); }}
                className={cn('px-3 py-1.5 rounded-lg text-[11.5px] font-bold transition border',
                  range.from === r.from && range.to === r.to
                    ? 'bg-[#4B3621] text-white border-[#4B3621]'
                    : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-[#A39588] mt-2">
          Période calculée : <b>{formatDate(range.from)} → {formatDate(range.to)}</b>
        </p>
      </section>

      {/* ── La portée ─────────────────────────────────────────────────── */}
      {cafeterias.length > 1 && (
        <div className="card-glass p-3 flex flex-wrap items-center gap-1.5">
          <Filter className="w-4 h-4 text-[#8A5A2B] ml-1" />
          <button onClick={() => setScope('all')}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-bold transition border',
              scope === 'all' ? 'bg-[#4B3621] text-white border-[#4B3621]'
                : 'bg-white text-[#7A6A5C] border-[#E2D3C4] hover:border-[#D4A373]')}>
            🏢 Toutes les cafétérias
          </button>
          {cafeterias.map(c => (
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

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'bilan', label: 'Bilan', icon: CircleDollarSign },
          { id: 'analyses', label: 'Analyses', icon: BarChart3 },
          { id: 'stock', label: 'Valeur du stock', icon: Boxes },
          { id: 'inventaires', label: 'Inventaires', icon: ClipboardList },
          { id: 'employes', label: 'Employés', icon: UsersRound },
        ]}
      />

      {/* ── BILAN ─────────────────────────────────────────────────────── */}
      {tab === 'bilan' && (
        single
          // Une seule cafétéria : son rapport complet, le même que sur son écran.
          ? <ReportView report={single} />
          : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi icon={TrendingUp} tone="green" label="Chiffre d'affaires" value={money(global.salesTotal)}
                  sub={`${global.counts.sales} vente(s)`} />
                <Kpi icon={Layers} tone="cyan" label="Marge brute" value={money(global.grossMargin)}
                  sub={`coût marchandises ${money(global.cogs)}`} />
                <Kpi icon={CircleDollarSign} tone={global.netGain >= 0 ? 'green' : 'red'}
                  label="Résultat net" value={money(global.netGain)} sub="charges et pertes déduites" />
                <Kpi icon={CreditCard} tone="red" label="Charges" value={money(global.expensesTotal)}
                  sub={`salaires ${money(global.salariesPaid)}`} />
                <Kpi icon={ShoppingCart} tone="purple" label="Achats" value={money(global.purchasesTotal)}
                  sub={`${money(global.purchasesPaid)} réglés`} />
                <Kpi icon={Truck} tone="amber" label="Dettes fournisseurs" value={money(global.supplierDebtTotal)}
                  sub="toutes périodes" />
                <Kpi icon={Users} tone="blue" label="Créances clients" value={money(global.clientDebtTotal)}
                  sub={`avances détenues ${money(global.clientAdvanceTotal)}`} />
                <Kpi icon={Boxes} tone="slate" label="Valeur du stock" value={money(global.stockValue)}
                  sub={`${global.counts.products} référence(s)`} />
              </div>

              {/* Le compte de résultat, lisible de haut en bas. */}
              <section className="card-glass p-5">
                <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621] mb-4">
                  Compte de résultat de la période
                </h3>
                <div className="max-w-2xl space-y-0.5">
                  <PL label="Chiffre d'affaires" value={global.salesTotal} strong />
                  <PL label="Retours & échanges" value={-global.returnsTotal} muted />
                  <PL label="Coût des marchandises vendues" value={-global.cogs} />
                  <PL label="Marge brute" value={global.grossMargin} rule strong />
                  <PL label="Charges d'exploitation" value={-global.expensesTotal} />
                  <PL label="Salaires versés" value={-global.salariesPaid} />
                  <PL label="Pertes de production" value={-global.lossValue} muted />
                  <PL label="Marchandise détruite" value={-global.destroyedValue} muted />
                  <PL label="Résultat net" value={global.netGain} rule strong big />
                </div>
                <p className="text-[10.5px] text-[#A39588] mt-3 leading-relaxed">
                  Les achats n'apparaissent pas en charge : ils entrent en STOCK. C'est le coût des
                  marchandises <b>vendues</b> qui pèse sur le résultat — sinon un réapprovisionnement
                  de fin de mois ferait plonger un mois pourtant bénéficiaire.
                </p>
              </section>

              {/* La contribution de chaque cafétéria. */}
              {parts.length > 1 && (
                <section className="card-glass p-4">
                  <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621] mb-3">
                    Contribution de chaque cafétéria
                  </h3>
                  <Table head={<>
                    <th className="table-head">Cafétéria</th>
                    <th className="table-head text-right">CA</th>
                    <th className="table-head text-right">Part</th>
                    <th className="table-head text-right">Marge</th>
                    <th className="table-head text-right">Charges</th>
                    <th className="table-head text-right">Résultat</th>
                    <th className="table-head text-right">Caisse</th>
                    <th className="table-head text-right">Stock</th>
                  </>}>
                    {parts.map(p => {
                      const share = global.salesTotal > 0 ? (p.salesTotal / global.salesTotal) * 100 : 0;
                      return (
                        <tr key={p.key}>
                          <td className="table-cell font-bold">{p.emoji} {p.label}</td>
                          <td className="table-cell text-right tabular-nums">{money(p.salesTotal)}</td>
                          <td className="table-cell text-right tabular-nums text-[#A39588]">{share.toFixed(1)} %</td>
                          <td className="table-cell text-right tabular-nums">{money(p.grossMargin)}</td>
                          <td className="table-cell text-right tabular-nums text-red-600">{money(p.expensesTotal + p.salariesPaid)}</td>
                          <td className={cn('table-cell text-right tabular-nums font-black',
                            p.netGain >= 0 ? 'text-emerald-700' : 'text-red-600')}>{money(p.netGain)}</td>
                          <td className={cn('table-cell text-right tabular-nums',
                            p.caisseBalance < 0 && 'text-red-600')}>{money(p.caisseBalance)}</td>
                          <td className="table-cell text-right tabular-nums">{money(p.stockValue)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-[#FAF6F1]">
                      <td className="table-cell font-black">Total enseigne</td>
                      <td className="table-cell text-right tabular-nums font-black">{money(global.salesTotal)}</td>
                      <td className="table-cell text-right tabular-nums font-black">100 %</td>
                      <td className="table-cell text-right tabular-nums font-black">{money(global.grossMargin)}</td>
                      <td className="table-cell text-right tabular-nums font-black text-red-600">
                        {money(global.expensesTotal + global.salariesPaid)}
                      </td>
                      <td className={cn('table-cell text-right tabular-nums font-black',
                        global.netGain >= 0 ? 'text-emerald-700' : 'text-red-600')}>{money(global.netGain)}</td>
                      <td className="table-cell text-right tabular-nums font-black">
                        {money(parts.reduce((s, p) => s + p.caisseBalance, 0))}
                      </td>
                      <td className="table-cell text-right tabular-nums font-black">{money(global.stockValue)}</td>
                    </tr>
                  </Table>
                </section>
              )}

              {/* La trésorerie : les tiroirs + le coffre. */}
              <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Kpi icon={Wallet} tone="amber" label="Espèces aux comptoirs"
                  value={money(parts.reduce((s, p) => s + p.caisseBalance, 0))}
                  sub={`${parts.length} tiroir(s)`} />
                <Kpi icon={Vault} tone="purple" label="Caisse générale" value={money(generalCash)}
                  sub="le coffre de l'enseigne" />
                <Kpi icon={Coffee} tone="green" label="Trésorerie totale"
                  value={money(generalCash + parts.reduce((s, p) => s + p.caisseBalance, 0))}
                  sub="coffre + tiroirs" />
              </section>

              {/* Ce qui demande une action. */}
              {(global.stockAlerts > 0 || global.expiryAlerts > 0) && (
                <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex flex-wrap gap-4">
                  {global.stockAlerts > 0 && (
                    <Alert icon={PackageX} label={`${global.stockAlerts} produit(s) sous le seuil`} />
                  )}
                  {global.expiryAlerts > 0 && (
                    <Alert icon={AlertTriangle} label={`${global.expiryAlerts} péremption(s) proche(s)`} />
                  )}
                </section>
              )}
            </div>
          )
      )}

      {/* ── ANALYSES ──────────────────────────────────────────────────── */}
      {tab === 'analyses' && (
        <GlobalAnalyticsView
          global={globalAnalytics}
          parts={analytics}
          onGranularity={setGrain}
        />
      )}

      {/* ── STOCK ─────────────────────────────────────────────────────── */}
      {tab === 'stock' && <StockValueView valuation={valuation} />}

      {/* ── INVENTAIRES ───────────────────────────────────────────────── */}
      {tab === 'inventaires' && <InventaireReportView parts={inventaires} />}

      {/* ── EMPLOYÉS ──────────────────────────────────────────────────── */}
      {tab === 'employes' && <WorkforceTab parts={parts} cafeterias={shownCafeterias} />}

      {/* La feuille A4, hors écran : c'est elle que `printFiche` clone. */}
      <div className="hidden">
        {single
          ? <ModuleFiche ref={ficheRef} report={single} settings={app.settings} />
          : <GlobalFiche ref={ficheRef} global={global} settings={app.settings} />}
      </div>
    </div>
  );
}

// ─── Employés ─────────────────────────────────────────────────────────────────
/**
 * La masse salariale, cafétéria par cafétéria. Elle se lit dans les rapports
 * déjà calculés — pas dans une seconde traversée des employés — pour que le
 * total affiché ici soit exactement celui du compte de résultat.
 */
function WorkforceTab({ parts, cafeterias }: { parts: PartReport[]; cafeterias: Cafeteria[] }) {
  const rows = useMemo(() => parts.flatMap(p => p.workers.map(w => ({ ...w, part: p.label, emoji: p.emoji }))), [parts]);
  const totalSalaries = parts.reduce((s, p) => s + p.salariesPaid, 0);
  const totalAcomptes = parts.reduce((s, p) => s + p.acomptesPeriod, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={UsersRound} tone="blue" label="Employés" value={String(rows.length)}
          sub={`${cafeterias.length} cafétéria(s)`} />
        <Kpi icon={Wallet} tone="green" label="Salaires versés" value={money(totalSalaries)} sub="sur la période" />
        <Kpi icon={CreditCard} tone="amber" label="Acomptes" value={money(totalAcomptes)} sub="sur la période" />
        <Kpi icon={Layers} tone="slate" label="Coût du personnel" value={money(totalSalaries + totalAcomptes)}
          sub="salaires + acomptes" />
      </div>

      {parts.length > 1 && (
        <section className="card-glass p-4">
          <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621] mb-3">
            Masse salariale par cafétéria
          </h3>
          <Table head={<>
            <th className="table-head">Cafétéria</th>
            <th className="table-head text-right">Employés</th>
            <th className="table-head text-right">Salaires</th>
            <th className="table-head text-right">Acomptes</th>
            <th className="table-head text-right">% du CA</th>
          </>}>
            {parts.map(p => (
              <tr key={p.key}>
                <td className="table-cell font-bold">{p.emoji} {p.label}</td>
                <td className="table-cell text-right tabular-nums">{p.counts.workers}</td>
                <td className="table-cell text-right tabular-nums">{money(p.salariesPaid)}</td>
                <td className="table-cell text-right tabular-nums">{money(p.acomptesPeriod)}</td>
                <td className="table-cell text-right tabular-nums text-[#A39588]">
                  {p.salesTotal > 0 ? `${((p.salariesPaid / p.salesTotal) * 100).toFixed(1)} %` : '—'}
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      <section className="card-glass p-4">
        <h3 className="text-[12px] font-black uppercase tracking-widest text-[#4B3621] mb-3">
          Tous les employés
        </h3>
        {rows.length === 0 ? (
          <p className="text-[13px] text-[#A39588] py-8 text-center">Aucun employé enregistré.</p>
        ) : (
          <Table head={<>
            <th className="table-head">Employé</th>
            <th className="table-head">Cafétéria</th>
            <th className="table-head">Rôle</th>
            <th className="table-head">Compte</th>
            <th className="table-head text-right">Salaire</th>
          </>}>
            {rows.map((w: any, i: number) => (
              <tr key={`${w.id || i}`}>
                <td className="table-cell font-bold">{w.name}</td>
                <td className="table-cell">{w.emoji} {w.part}</td>
                <td className="table-cell">{w.role || w.roleName || '—'}</td>
                <td className="table-cell">
                  {w.hasAccount
                    ? <Badge tone="success">Actif</Badge>
                    : <Badge tone="neutral">Aucun</Badge>}
                </td>
                <td className="table-cell text-right tabular-nums">{money(Number(w.salary ?? w.salaryAmount) || 0)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

// ─── Périodes prêtes ──────────────────────────────────────────────────────────

function lastMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function quarter() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const first = new Date(now.getFullYear(), q * 3, 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

function year() {
  const now = new Date();
  return { from: `${now.getFullYear()}-01-01`, to: now.toISOString().slice(0, 10) };
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
  icon: React.ElementType; tone: string; label: string; value: string; sub?: string;
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

/** Une ligne du compte de résultat. Un montant négatif se lit « − 12 400 DA ». */
function PL({ label, value, strong, big, rule, muted }: {
  label: string; value: number; strong?: boolean; big?: boolean; rule?: boolean; muted?: boolean;
}) {
  if (muted && Math.abs(value) < 0.005) return null;
  return (
    <div className={cn('flex items-center justify-between py-1.5',
      rule && 'border-t-2 border-[#E2D3C4] mt-1.5 pt-2.5')}>
      <span className={cn(strong ? 'text-[13px] font-black text-[#2A2018]' : 'text-[12.5px] text-[#7A6A5C]')}>
        {label}
      </span>
      <span className={cn('tabular-nums',
        big ? 'text-xl font-black' : strong ? 'text-[14px] font-black' : 'text-[13px] font-bold',
        value < 0 ? 'text-red-600' : 'text-[#2A2018]')}>
        {value < 0 ? `− ${money(Math.abs(value))}` : money(value)}
      </span>
    </div>
  );
}

const Alert = ({ icon: Icon, label }: { icon: React.ElementType; label: string }) => (
  <span className="inline-flex items-center gap-2 text-[12.5px] font-bold text-amber-900">
    <Icon className="w-4 h-4 text-amber-600" /> {label}
  </span>
);
