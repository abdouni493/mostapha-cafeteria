/**
 * ─── Printable "Fiche" sheets for the business reports ─────────────────────────
 * A4-width (794px) printable documents that mirror the station's *Fiche
 * Journalière* design (dark-blue banner, gold accent, numbered parts, striped
 * tables, signature footer). Used by both `ModuleReports` and `GeneralReports`.
 *
 * `printFiche(el)` clones a sheet into a body-level portal and flips the body
 * into `print-document` mode so the global thermal-receipt print CSS is bypassed
 * and the sheet prints on full A4 pages (same mechanism as the Fiche Journalière).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import { printDocumentMode } from '@/src/lib/pdf';
import { PartReport, GlobalReport } from '@/src/lib/bizReporting';

export const C = { blue900: '#001233', blue800: '#001f5c', blue700: '#002d87', blue600: '#003087', gold: '#FFB800' };

export const da = (n: number) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const lit = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const shortDate = (s: string) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR'); };

/** Colour of a purchase status label on the printed sheet. */
const statusColor = (s: string) =>
  s === 'Payé' ? '#15803d'
    : s === 'Dette partielle' || s === 'Partiel' ? '#b45309'
      : s === 'En attente livraison' ? '#64748b'
        : '#dc2626';

/** Human labels for the payment modes carried by an achat carburant. */
export const PAY_MODE_LABEL: Record<string, string> = { ESPECES: 'Espèces', CHEQUE: 'Chèque', VIREMENT: 'Virement' };

/** Human labels for the fuel types a cuve can hold. */
export const FUEL_TYPE_LABEL: Record<string, string> = {
  ESSENCE: 'Essence', GASOIL: 'Gasoil', GPL: 'GPL', DIESEL: 'Diesel', SUPER: 'Super', AUTRE: 'Autre',
};
/** Print colours per fuel type (kept sober for the black-and-white fiche). */
export const FUEL_TYPE_COLOR: Record<string, string> = {
  ESSENCE: '#15803d', GASOIL: '#b45309', GPL: '#7c3aed', DIESEL: '#0e7490', SUPER: '#b91c1c', AUTRE: '#475569',
};

// ─── Print helper ────────────────────────────────────────────────────────────
export function printFiche(el: HTMLElement | null) {
  if (!el) return;
  // Ensure the revealed portal exists on <body> (same id the global print CSS targets).
  let portal = document.getElementById('daily-report-print-area-portal');
  if (!portal) {
    portal = document.createElement('div');
    portal.id = 'daily-report-print-area-portal';
    document.body.appendChild(portal);
  }
  // Inject the page/fine-tune print CSS once.
  if (!document.getElementById('fiche-print-style')) {
    const style = document.createElement('style');
    style.id = 'fiche-print-style';
    style.textContent = `
      #daily-report-print-area-portal { display: none; }
      @media print {
        @page { size: A4 portrait; margin: 6mm; }
        body.print-document #daily-report-print-area-portal { display: block !important; }
        body.print-document #daily-report-print-area-portal .no-print { display: none !important; }
        body.print-document #daily-report-print-area-portal * { box-shadow: none !important; overflow: visible !important; }
        body.print-document #daily-report-print-area-portal > div { position: static !important; left: auto !important; top: auto !important; width: 100% !important; }
        body.print-document #daily-report-print-area-portal > div > div { width: 100% !important; }
      }`;
    document.head.appendChild(style);
  }
  portal.innerHTML = '';
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.overflow = 'visible';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  clone.style.position = 'static';
  clone.style.left = 'auto';
  clone.style.top = 'auto';
  portal.appendChild(clone);
  const cleanup = () => { portal!.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  printDocumentMode();
}

// ─── Shared primitives ───────────────────────────────────────────────────────
export const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
export const theadRow: React.CSSProperties = { background: C.blue800 };
export const totalRow: React.CSSProperties = { background: '#eff6ff' };

export function TH({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <th style={{ padding: '6px 9px', textAlign: align || 'left', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4, color: '#fff', whiteSpace: 'nowrap' }}>{children}</th>;
}
export function TD({ children, align, bold, color }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; bold?: boolean; color?: string }) {
  return <td style={{ padding: '5px 9px', textAlign: align || 'left', fontSize: 10.5, fontWeight: bold ? 900 : 600, color: color || '#1e293b', borderBottom: '1px solid #eef2f7' }}>{children}</td>;
}
export function Part({ num, label, accent, children }: { num: string; label: string; accent: string; children: React.ReactNode; key?: React.Key }) {
  return (
    <section style={{ borderTop: `2px solid ${accent}`, margin: '0 14px 14px 14px', breakInside: 'avoid' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ width: 20, height: 20, background: C.blue900, color: C.gold, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 11 }}>{num}</span>
        <h3 style={{ margin: 0, color: C.blue900, fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</h3>
      </div>
      <div style={{ padding: '10px 0 0 0' }}>{children}</div>
    </section>
  );
}
export function EmptyLine({ text = 'Aucune donnée sur la période' }: { text?: string }) {
  return <p style={{ margin: '2px 0 6px 0', fontSize: 10.5, color: '#94a3b8', fontStyle: 'italic' }}>{text}</p>;
}

// ─── Banner + KPI strip + footer (shared shell) ──────────────────────────────
export function Banner({ settings, badge, period }: { settings: any; badge: string; period: string }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: `linear-gradient(135deg, ${C.blue900} 0%, ${C.blue800} 55%, ${C.blue600} 100%)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {(settings?.logoUrl || settings?.logo) ? (
            <img src={settings.logoUrl || settings.logo} alt="logo" style={{ width: 58, height: 58, objectFit: 'contain', borderRadius: 8, background: '#fff', padding: 3 }} />
          ) : (
            <div style={{ width: 58, height: 58, background: 'rgba(255,184,0,0.15)', border: '1px solid rgba(255,184,0,0.4)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: C.gold, fontSize: 28, fontWeight: 900 }}>⛽</span>
            </div>
          )}
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 22, color: '#fff', letterSpacing: 0.3 }}>{settings?.name || 'Altech Cafétéria'}</p>
            {settings?.address && <p style={{ margin: '2px 0 0 0', fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{settings.address}</p>}
            <p style={{ margin: '2px 0 0 0', fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
              {[settings?.phone && `Tél: ${settings.phone}`, settings?.fiscalId && `NIF: ${settings.fiscalId}`, settings?.rc && `RC: ${settings.rc}`].filter(Boolean).join('  ·  ')}
            </p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ display: 'inline-block', background: C.gold, color: C.blue900, fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, padding: '6px 14px', borderRadius: 6 }}>{badge}</span>
          <p style={{ margin: '7px 0 0 0', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{period}</p>
        </div>
      </div>
      <div style={{ height: 4, width: '100%', background: `linear-gradient(90deg, ${C.gold}, transparent)`, margin: '0 0 14px 0' }} />
    </>
  );
}

export function KpiStrip({ kpis }: { kpis: { label: string; value: string; col: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpis.length}, 1fr)`, gap: 10, margin: '0 14px 16px 14px' }}>
      {kpis.map(k => (
        <div key={k.label} style={{ borderLeft: `3px solid ${k.col}`, background: '#f8fafc', borderRadius: '0 7px 7px 0', padding: '8px 12px' }}>
          <p style={{ margin: 0, fontSize: 8.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#94a3b8' }}>{k.label}</p>
          <p style={{ margin: '3px 0 0 0', fontSize: 16, fontWeight: 900, color: k.col }}>{k.value}</p>
        </div>
      ))}
    </div>
  );
}

export function Footer({ settings, title }: { settings: any; title: string }) {
  return (
    <div style={{ margin: '4px 14px 0 14px', paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginBottom: 22 }}>
        <span>Généré le {new Date().toLocaleString('fr-FR')}</span>
        <span>{settings?.name || 'Altech Cafétéria'} — {title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60 }}>
        <div><p style={{ fontSize: 10.5, fontWeight: 900, color: '#334155', marginBottom: 34 }}>Signature Responsable :</p><div style={{ borderBottom: '1px solid #94a3b8' }} /></div>
        <div><p style={{ fontSize: 10.5, fontWeight: 900, color: '#334155', marginBottom: 34 }}>Cachet & Signature Gérant :</p><div style={{ borderBottom: '1px solid #94a3b8' }} /></div>
      </div>
    </div>
  );
}

export const sheetStyle: React.CSSProperties = { width: 794, background: '#fff', padding: '0 0 8px 0', fontFamily: 'Arial, sans-serif', color: '#1e293b' };
export const hiddenWrap: React.CSSProperties = { position: 'fixed', left: -10000, top: 0, width: 794, pointerEvents: 'none', zIndex: -1 };

// ─── Module fiche (one part, fully detailed) ─────────────────────────────────
export const ModuleFiche = React.forwardRef<HTMLDivElement, { report: PartReport; settings: any }>(({ report: r, settings }, ref) => {
  const period = `Du ${shortDate(r.from)} au ${shortDate(r.to)}`;
  const title = `Rapport ${r.label}`;
  const salesTotals = r.salesByProduct.reduce((a, x) => ({ qty: a.qty + x.qty, revenue: a.revenue + x.revenue, cost: a.cost + x.cost, gain: a.gain + x.gain }), { qty: 0, revenue: 0, cost: 0, gain: 0 });

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge={`Rapport · ${r.label}`} period={period} />
        <KpiStrip kpis={[
          { label: 'Chiffre d\'affaires', value: `${da(r.salesTotal)} DA`, col: '#047857' },
          { label: 'Total achats', value: `${da(r.purchasesTotal)} DA`, col: '#c2410c' },
          { label: 'Dépenses', value: `${da(r.expensesTotal + r.salariesPaid)} DA`, col: '#dc2626' },
          { label: 'Bénéfice net', value: `${da(r.netGain)} DA`, col: r.netGain >= 0 ? '#15803d' : '#dc2626' },
        ]} />

        {/* PART 1 — VENTES */}
        <Part num="1" label="Ventes par produit" accent={C.blue700}>
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Produit</TH><TH align="right">Quantité</TH><TH align="right">Total achat</TH><TH align="right">Total vente</TH><TH align="right">Gains</TH></tr></thead>
            <tbody>
              {r.salesByProduct.length === 0 && (<tr><TD>—</TD><TD align="right">0</TD><TD align="right">0</TD><TD align="right">0</TD><TD align="right">0</TD></tr>)}
              {r.salesByProduct.map((p, i) => (
                <tr key={p.name} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                  <TD bold>{p.name}</TD>
                  <TD align="right">{lit(p.qty)}{p.unit ? ` ${p.unit}` : ''}</TD>
                  <TD align="right" color="#b45309">{da(p.cost)} DA</TD>
                  <TD align="right" color="#1d4ed8">{da(p.revenue)} DA</TD>
                  <TD align="right" bold color={p.gain >= 0 ? '#15803d' : '#dc2626'}>{da(p.gain)} DA</TD>
                </tr>
              ))}
              <tr style={totalRow}>
                <TD bold color={C.blue900}>TOTAL</TD>
                <TD align="right" bold color={C.blue900}>{lit(salesTotals.qty)}</TD>
                <TD align="right" bold color="#b45309">{da(salesTotals.cost)} DA</TD>
                <TD align="right" bold color="#1d4ed8">{da(salesTotals.revenue)} DA</TD>
                <TD align="right" bold color={salesTotals.gain >= 0 ? '#15803d' : '#dc2626'}>{da(salesTotals.gain)} DA</TD>
              </tr>
            </tbody>
          </table>

          {/* Ventes ANNULÉES — retirées du tableau ci-dessus : la marchandise est
              revenue en stock, donc ni chiffre d'affaires ni gain. Elles sont
              listées pour justifier l'écart avec ce qui a été encaissé. */}
          {r.returns.length > 0 && (
            <>
              <p style={{ margin: '10px 0 5px 0', fontSize: 10, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Retours &amp; échanges — {r.returns.length} vente(s) annulée(s), exclue(s) du tableau ci-dessus
              </p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Réf</TH><TH>Type</TH><TH>Client</TH><TH>Date</TH><TH align="right">CA annulé</TH><TH align="right">Remboursé</TH><TH align="right">Remis en stock</TH></tr></thead>
                <tbody>
                  {r.returns.map((rt, i) => (
                    <tr key={rt.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                      <TD bold>{rt.ref}</TD><TD>{rt.kind}</TD><TD>{rt.client}</TD><TD>{shortDate(rt.date)}</TD>
                      <TD align="right" color="#64748b">{da(rt.total)} DA</TD>
                      <TD align="right" color="#dc2626">{da(rt.refunded)} DA</TD>
                      <TD align="right" color="#15803d">{da(rt.restockedCost)} DA</TD>
                    </tr>
                  ))}
                  <tr style={totalRow}>
                    <TD bold color={C.blue900}>TOTAL</TD><TD /><TD /><TD />
                    <TD align="right" bold color="#64748b">{da(r.returnsTotal)} DA</TD>
                    <TD align="right" bold color="#dc2626">{da(r.refundedTotal)} DA</TD>
                    <TD align="right" bold color="#15803d">{da(r.restockedCost)} DA</TD>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </Part>

        {/* PART 2 — FACTURES / ACHATS */}
        <Part num="2" label="Achats fournisseurs" accent="#c2410c">
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Réf</TH><TH>Fournisseur</TH><TH>Date</TH><TH align="right">Total</TH><TH align="right">Payé</TH><TH align="right">Reste</TH></tr></thead>
            <tbody>
              {r.purchases.length === 0 && (<tr><TD>Aucun achat</TD><TD /><TD /><TD align="right">0</TD><TD align="right">0</TD><TD align="right">0</TD></tr>)}
              {r.purchases.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                  <TD bold>{p.ref}</TD><TD>{p.supplier}</TD><TD>{shortDate(p.date)}</TD>
                  <TD align="right">{da(p.total)} DA</TD>
                  <TD align="right" color="#15803d">{da(p.paid)} DA</TD>
                  <TD align="right" color={p.rest > 0 ? '#dc2626' : '#94a3b8'}>{da(p.rest)} DA</TD>
                </tr>
              ))}
              <tr style={{ background: '#fff7ed' }}>
                <TD bold color="#9a3412">TOTAL</TD><TD /><TD />
                <TD align="right" bold color="#9a3412">{da(r.purchasesTotal)} DA</TD>
                <TD align="right" bold color="#15803d">{da(r.purchasesPaid)} DA</TD>
                <TD align="right" bold color="#dc2626">{da(r.purchasesTotal - r.purchasesPaid)} DA</TD>
              </tr>
            </tbody>
          </table>
        </Part>

        {/* PART 3 — DEPENSES */}
        <Part num="3" label="Dépenses, salaires & acomptes" accent="#dc2626">
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Type</TH><TH>Nom / Description</TH><TH align="right">Montant</TH><TH align="right">Date</TH></tr></thead>
            <tbody>
              {r.expenses.length === 0 && (<tr><TD>Aucune dépense</TD><TD /><TD align="right">0</TD><TD align="right">—</TD></tr>)}
              {r.expenses.map(e => (
                <tr key={e.id} style={{ background: '#fff' }}>
                  <TD bold color={e.kind === 'Salaire' ? '#4338ca' : e.kind === 'Acompte' ? '#b45309' : '#0f172a'}>{e.kind}</TD>
                  <TD>{e.label}{e.description ? <span style={{ color: '#94a3b8' }}> — {e.description}</span> : null}</TD>
                  <TD align="right" bold color="#dc2626">{da(e.amount)} DA</TD>
                  <TD align="right">{shortDate(e.date)}</TD>
                </tr>
              ))}
              <tr style={{ background: '#fef2f2' }}>
                <TD bold color="#991b1b">TOTAL DÉPENSES</TD><TD />
                <TD align="right" bold color="#991b1b">{da(r.expensesTotal + r.salariesPaid + r.acomptesPeriod)} DA</TD><TD />
              </tr>
            </tbody>
          </table>
        </Part>

        {/* PART 4 — DETTES */}
        <Part num="4" label="Dettes clients & fournisseurs" accent="#b45309">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dettes clients — {da(r.clientDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Client</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {r.clientDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD align="right">0</TD></tr>) :
                    r.clientDebts.map((d, i) => (
                      <tr key={d.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                        <TD>{d.name}{d.ref === 'AVANCE' ? ' — avance détenue' : d.ref === 'REPRISE' ? ' — dette initiale' : ''}</TD>
                        <TD align="right" bold color={d.rest < 0 ? '#0d9488' : '#dc2626'}>{da(d.rest)} DA</TD>
                      </tr>))}
                </tbody>
              </table>
            </div>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dettes fournisseurs — {da(r.supplierDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Fournisseur</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {r.supplierDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD align="right">0</TD></tr>) :
                    r.supplierDebts.map((d, i) => (<tr key={d.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}><TD>{d.name}</TD><TD align="right" bold color="#b45309">{da(d.rest)} DA</TD></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </Part>

        {/* PART 5 — ALERTES */}
        <Part num="5" label="Alertes stock & expiration" accent="#ea580c">
          <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Stock bas ({r.stockAlerts.length})</p>
          {r.stockAlerts.length === 0 ? <EmptyLine text="Aucune alerte de stock" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Produit</TH><TH>Catégorie</TH><TH align="right">Stock</TH><TH align="right">Seuil</TH><TH align="right">Manque</TH></tr></thead>
              <tbody>
                {r.stockAlerts.map((a, i) => (
                  <tr key={a.id} style={{ background: i % 2 ? '#fff7ed' : '#fff' }}>
                    <TD bold>{a.name}</TD><TD color="#94a3b8">{a.category || '—'}</TD>
                    <TD align="right" color={a.currentQty <= 0 ? '#dc2626' : '#b45309'}>{lit(a.currentQty)}{a.unit ? ` ${a.unit}` : ''}</TD>
                    <TD align="right">{lit(a.minQty)}</TD>
                    <TD align="right" bold color="#dc2626">{lit(a.deficit)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ margin: '10px 0 5px 0', fontSize: 10, fontWeight: 900, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 }}>Expirations proches ({r.expiryAlerts.length})</p>
          {r.expiryAlerts.length === 0 ? <EmptyLine text="Aucune expiration proche" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Produit</TH><TH>Expiration</TH><TH align="right">Jours restants</TH><TH align="right">Quantité</TH></tr></thead>
              <tbody>
                {r.expiryAlerts.map((a, i) => (
                  <tr key={a.id} style={{ background: i % 2 ? '#faf5ff' : '#fff' }}>
                    <TD bold>{a.name}</TD><TD>{shortDate(a.expirationDate)}</TD>
                    <TD align="right" bold color={a.status === 'expired' ? '#dc2626' : '#c2410c'}>{a.status === 'expired' ? `Expiré (${Math.abs(a.daysLeft)}j)` : `${a.daysLeft}j`}</TD>
                    <TD align="right">{lit(a.currentQty)}{a.unit ? ` ${a.unit}` : ''}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Part>

        {/* PART 6 — EMPLOYES */}
        {r.workers.length > 0 && (
          <Part num="6" label="Comptes des employés" accent="#4338ca">
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Employé</TH><TH>Rôle</TH><TH align="right">Salaire</TH><TH align="right">Acomptes</TH><TH align="right">Absences</TH><TH align="right">Payé</TH><TH align="right">Net à payer</TH></tr></thead>
              <tbody>
                {r.workers.map((w, i) => (
                  <tr key={w.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                    <TD bold>{w.name}</TD><TD color="#94a3b8">{w.role}</TD>
                    <TD align="right">{da(w.salaryAmount)} DA<span style={{ color: '#94a3b8' }}>/{w.salaryType}</span></TD>
                    <TD align="right" color="#b45309">{da(w.acomptesTotal)} DA</TD>
                    <TD align="right" color="#dc2626">{w.absencesCount ? `${da(w.absencesTotal)} DA` : '—'}</TD>
                    <TD align="right" color="#15803d">{da(w.paymentsTotal)} DA</TD>
                    <TD align="right" bold color={C.blue900}>{da(w.net)} DA</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </Part>
        )}

        {/* PART 7 — RECAPITULATION */}
        <Part num={r.workers.length > 0 ? '7' : '6'} label="Récapitulation" accent="#047857">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
            {[
              { label: 'Chiffre d\'affaires', value: r.salesTotal, bg: '#eff6ff', col: '#1d4ed8' },
              { label: 'Coût marchandises', value: r.cogs, bg: '#fff7ed', col: '#c2410c' },
              { label: 'Marge brute', value: r.grossMargin, bg: '#ecfdf5', col: '#047857' },
            ].map(c => (
              <div key={c.label} style={{ padding: '10px 13px', background: c.bg, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <p style={{ margin: 0, fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>{c.label}</p>
                <p style={{ margin: '3px 0 0 0', fontSize: 16.5, fontWeight: 900, color: c.col }}>{da(c.value)} DA</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderRadius: 8, color: '#fff', background: r.netGain >= 0 ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Bénéfice net de la période</p>
              <p style={{ margin: '2px 0 0 0', fontSize: 9, opacity: 0.85 }}>Marge brute − Dépenses − Salaires − Destructions − Pertes</p>
              {r.returns.length > 0 && (
                <p style={{ margin: '2px 0 0 0', fontSize: 9, opacity: 0.85 }}>
                  Hors {r.returns.length} vente(s) annulée(s) ({da(r.returnsTotal)} DA) — marchandise revenue en stock
                </p>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>{da(r.netGain)} DA</p>
          </div>
        </Part>

        <Footer settings={settings} title={title} />
      </div>
    </div>
  );
});
ModuleFiche.displayName = 'ModuleFiche';

// ─── Global consolidated fiche ───────────────────────────────────────────────
export const GlobalFiche = React.forwardRef<HTMLDivElement, { global: GlobalReport; settings: any }>(({ global: g, settings }, ref) => {
  const period = `Du ${shortDate(g.from)} au ${shortDate(g.to)}`;
  const title = 'Rapport Général Consolidé';
  const allClientDebts = g.parts.flatMap(p => p.clientDebts.map(d => ({ ...d, part: p.label })));
  const allSupplierDebts = g.parts.flatMap(p => p.supplierDebts.map(d => ({ ...d, part: p.label })));
  const allStockAlerts = g.parts.flatMap(p => p.stockAlerts.map(a => ({ ...a, part: p.label })));
  const allExpiry = g.parts.flatMap(p => p.expiryAlerts.map(a => ({ ...a, part: p.label })));

  return (
    <div aria-hidden="true" style={hiddenWrap}>
      <div ref={ref} className="not-italic" style={sheetStyle}>
        <Banner settings={settings} badge="Rapport Général" period={period} />
        <KpiStrip kpis={[
          { label: 'Total des ventes', value: `${da(g.salesTotal)} DA`, col: '#047857' },
          { label: 'Coût marchandises', value: `${da(g.cogs)} DA`, col: '#c2410c' },
          { label: 'Total des dépenses', value: `${da(g.expensesTotal + g.salariesPaid)} DA`, col: '#dc2626' },
          { label: 'Total des gains', value: `${da(g.netGain)} DA`, col: g.netGain >= 0 ? '#15803d' : '#dc2626' },
        ]} />

        {/* PART 1 — Synthèse par activité */}
        <Part num="1" label="Synthèse par activité" accent={C.blue700}>
          <table style={tableStyle}>
            <thead><tr style={theadRow}><TH>Activité</TH><TH align="right">Ventes</TH><TH align="right">Achats</TH><TH align="right">Dépenses</TH><TH align="right">Dettes clients</TH><TH align="right">Bénéfice net</TH></tr></thead>
            <tbody>
              {g.parts.map((p, i) => (
                <tr key={p.key} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                  <TD bold>{p.emoji} {p.label}</TD>
                  <TD align="right" color="#047857">{da(p.salesTotal)} DA</TD>
                  <TD align="right" color="#c2410c">{da(p.purchasesTotal)} DA</TD>
                  <TD align="right" color="#dc2626">{da(p.expensesTotal + p.salariesPaid)} DA</TD>
                  <TD align="right" color="#b45309">{da(p.clientDebtTotal)} DA</TD>
                  <TD align="right" bold color={p.netGain >= 0 ? '#15803d' : '#dc2626'}>{da(p.netGain)} DA</TD>
                </tr>
              ))}
              <tr style={totalRow}>
                <TD bold color={C.blue900}>TOTAL</TD>
                <TD align="right" bold color="#047857">{da(g.salesTotal)} DA</TD>
                <TD align="right" bold color="#c2410c">{da(g.purchasesTotal)} DA</TD>
                <TD align="right" bold color="#dc2626">{da(g.expensesTotal + g.salariesPaid)} DA</TD>
                <TD align="right" bold color="#b45309">{da(g.clientDebtTotal)} DA</TD>
                <TD align="right" bold color={g.netGain >= 0 ? '#15803d' : '#dc2626'}>{da(g.netGain)} DA</TD>
              </tr>
            </tbody>
          </table>
        </Part>

        {/* PART 2 — Dettes consolidées */}
        <Part num="2" label="Dettes consolidées" accent="#b45309">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5 }}>Clients — {da(g.clientDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Client</TH><TH>Activité</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {allClientDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD /><TD align="right">0</TD></tr>) :
                    allClientDebts.map((d, i) => (
                      <tr key={d.id + i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                        <TD>{d.name}{d.ref === 'AVANCE' ? ' — avance détenue' : d.ref === 'REPRISE' ? ' — dette initiale' : ''}</TD>
                        <TD color="#94a3b8">{d.part}</TD>
                        <TD align="right" bold color={d.rest < 0 ? '#0d9488' : '#dc2626'}>{da(d.rest)} DA</TD>
                      </tr>))}
                </tbody>
              </table>
            </div>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Fournisseurs — {da(g.supplierDebtTotal)} DA</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Fournisseur</TH><TH>Activité</TH><TH align="right">Reste</TH></tr></thead>
                <tbody>
                  {allSupplierDebts.length === 0 ? (<tr><TD color="#94a3b8">Aucune</TD><TD /><TD align="right">0</TD></tr>) :
                    allSupplierDebts.map((d, i) => (<tr key={d.id + i} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}><TD>{d.name}</TD><TD color="#94a3b8">{d.part}</TD><TD align="right" bold color="#b45309">{da(d.rest)} DA</TD></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </Part>

        {/* PART 3 — Alertes consolidées */}
        <Part num="3" label="Alertes consolidées" accent="#ea580c">
          <p style={{ margin: '0 0 5px 0', fontSize: 10, fontWeight: 900, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Stock bas ({allStockAlerts.length})</p>
          {allStockAlerts.length === 0 ? <EmptyLine text="Aucune alerte de stock" /> : (
            <table style={tableStyle}>
              <thead><tr style={theadRow}><TH>Produit</TH><TH>Activité</TH><TH align="right">Stock</TH><TH align="right">Seuil</TH><TH align="right">Manque</TH></tr></thead>
              <tbody>
                {allStockAlerts.map((a, i) => (
                  <tr key={a.id + i} style={{ background: i % 2 ? '#fff7ed' : '#fff' }}>
                    <TD bold>{a.name}</TD><TD color="#94a3b8">{a.part}</TD>
                    <TD align="right" color={a.currentQty <= 0 ? '#dc2626' : '#b45309'}>{lit(a.currentQty)}{a.unit ? ` ${a.unit}` : ''}</TD>
                    <TD align="right">{lit(a.minQty)}</TD>
                    <TD align="right" bold color="#dc2626">{lit(a.deficit)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {allExpiry.length > 0 && (
            <>
              <p style={{ margin: '10px 0 5px 0', fontSize: 10, fontWeight: 900, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 }}>Expirations proches ({allExpiry.length})</p>
              <table style={tableStyle}>
                <thead><tr style={theadRow}><TH>Produit</TH><TH>Activité</TH><TH>Expiration</TH><TH align="right">Jours</TH></tr></thead>
                <tbody>
                  {allExpiry.map((a, i) => (
                    <tr key={a.id + i} style={{ background: i % 2 ? '#faf5ff' : '#fff' }}>
                      <TD bold>{a.name}</TD><TD color="#94a3b8">{a.part}</TD><TD>{shortDate(a.expirationDate)}</TD>
                      <TD align="right" bold color={a.status === 'expired' ? '#dc2626' : '#c2410c'}>{a.status === 'expired' ? `Expiré` : `${a.daysLeft}j`}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Part>

        {/* PART 4 — Bilan */}
        <Part num="4" label="Bilan global" accent="#047857">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
            {[
              { label: 'Coût marchandises', value: g.cogs, bg: '#fff7ed', col: '#c2410c' },
              { label: 'Marge brute', value: g.grossMargin, bg: '#ecfdf5', col: '#047857' },
              { label: 'Valeur du stock', value: g.stockValue, bg: '#eff6ff', col: '#1d4ed8' },
              { label: 'Dépenses + salaires', value: g.expensesTotal + g.salariesPaid, bg: '#fef2f2', col: '#dc2626' },
            ].map(c => (
              <div key={c.label} style={{ padding: '10px 13px', background: c.bg, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <p style={{ margin: 0, fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>{c.label}</p>
                <p style={{ margin: '3px 0 0 0', fontSize: 16.5, fontWeight: 900, color: c.col }}>{da(c.value)} DA</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderRadius: 8, color: '#fff', background: g.netGain >= 0 ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Total des gains (toutes activités)</p>
              <p style={{ margin: '2px 0 0 0', fontSize: 9, opacity: 0.85 }}>Ventes − coût des marchandises vendues − dépenses − salaires − destructions − pertes</p>
            </div>
            <p style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>{da(g.netGain)} DA</p>
          </div>
        </Part>

        <Footer settings={settings} title={title} />
      </div>
    </div>
  );
});
GlobalFiche.displayName = 'GlobalFiche';

// ─── Fuel-purchases fiche (Achats carburant, fully detailed) ─────────────────
/** One règlement of an achat carburant, with its mode and its references. */
export interface FuelPurchasePaymentDetail {
  mode: string;                 // ESPECES | CHEQUE | VIREMENT
  amount: number;
  chequeNumber?: string;
  bordereauNumber?: string;
  account: string;              // libellé du compte débité (caisse ou banque)
  date: string;
  notes?: string;
}
