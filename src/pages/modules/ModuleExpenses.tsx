/**
 * ─── Dépenses d'une cafétéria ──────────────────────────────────────────────────
 *
 * LE SEUL CHOIX QUI COMPTE ICI : d'OÙ SORT L'ARGENT.
 *
 *   • Caisse de la cafétéria — le tiroir du comptoir se vide d'autant. C'est le
 *     cas courant : on paie le livreur de lait avec la recette du matin.
 *   • Caisse générale — le coffre de l'enseigne paie (loyer, salaires du siège,
 *     impôts). Le tiroir de la cafétéria ne bouge PAS, et une ligne miroir est
 *     écrite au coffre pour que son solde reste juste.
 *
 * Sans cette distinction, toute dépense vidait le tiroir du comptoir — même le
 * loyer réglé par virement depuis le compte de l'enseigne. Le solde de caisse
 * affiché n'avait alors plus aucun rapport avec les billets réellement présents.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { CreditCard, Plus, TrendingDown, Calendar, Banknote, Vault, Wallet } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizExpense, bizExpensePaidInCash } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import {
  useBizPermission, useAppState, useAppDispatch, generalCashBalance,
} from '@/src/store/AppContext';
import { moduleCaisseBalance } from '@/src/lib/bizReporting';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, Modal, Field, Input, Textarea, Select,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import CafeteriaSwitcher from '@/src/components/biz/CafeteriaSwitcher';

/** Identifiant du « compte » caisse générale, tel qu'il est stocké sur la dépense. */
const GENERAL = 'GENERAL';
/** Identifiant du tiroir de la cafétéria (préfixe `CAISSE` ⇒ payé en espèces). */
const cofferOf = (key: ModuleKey) => `CAISSE_${key}`;

export default function ModuleExpenses({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'expenses');
  const app = useAppState();
  const dispatch = useAppDispatch();
  const { expenses } = biz.state;

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [form, setForm] = useState<BizExpense | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<BizExpense | null>(null);

  const cats = useMemo(
    () => Array.from(new Set([
      ...(app.settings.expenseCategories || []),
      ...expenses.map(e => e.category).filter(Boolean) as string[],
    ])),
    [expenses, app.settings.expenseCategories]);

  const filtered = useMemo(() => [...expenses]
    .filter(e => matchesSearch(search, e.name, e.category) && inPeriod(e.date, period, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [expenses, search, period, from, to]);

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  /** Ce qui est réellement sorti du tiroir de la cafétéria sur la période. */
  const totalCash = filtered.filter(bizExpensePaidInCash).reduce((s, e) => s + e.amount, 0);
  /** Le solde du tiroir — le MÊME calcul que l'écran Caisse et que les rapports. */
  const caisse = useMemo(() => moduleCaisseBalance(biz.state, moduleKey), [biz.state, moduleKey]);

  /**
   * Une dépense supprimée emporte la ligne qu'elle avait écrite au coffre
   * général : sans cela, le solde du coffre resterait amputé d'une dépense qui
   * n'existe plus.
   */
  const del = () => {
    if (!toDelete) return;
    const mirror = app.generalCash.find(t => t.linkedTxId === toDelete.id);
    if (mirror) dispatch({ type: 'DELETE_GENERAL_TX', payload: mirror.id });
    biz.remove('expenses', toDelete.id);
    toast.success('Dépense supprimée');
    setToDelete(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={CreditCard} title="Dépenses" subtitle={`${cfg.label} — charges et sorties de caisse`}
        actions={perm.creer
          ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvelle dépense</button>
          : undefined} />

      <CafeteriaSwitcher current={moduleKey} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={TrendingDown} label="Dépenses" value={filtered.length} tone="blue" />
        <StatCard icon={CreditCard} label="Total période" value={money(total)} tone="red" />
        <StatCard icon={Banknote} label="Payé du tiroir" value={money(totalCash)} tone="amber"
          sub={`Caisse générale ${money(total - totalCash)}`} />
        <StatCard icon={Wallet} label={`Caisse ${cfg.short}`} value={money(caisse)} tone={caisse >= 0 ? 'green' : 'red'}
          sub="après ces dépenses" />
      </div>

      <div className="rounded-2xl bg-[#F5E7D8]/60 border border-[#E7C9A9] px-4 py-3 text-[12px] text-[#8A5A2B] leading-relaxed">
        Une dépense payée <strong>du tiroir</strong> vide la caisse de <strong>{cfg.label}</strong>.
        Payée par la <strong>caisse générale</strong>, elle sort du coffre de l'enseigne : le tiroir du
        comptoir n'y touche pas, et le coffre est débité automatiquement.
      </div>

      <div className="card-glass p-4 space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom de la dépense…" />
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CreditCard} title="Aucune dépense"
          action={perm.creer
            ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvelle dépense</button>
            : undefined} />
      ) : (
        <CardGrid>
          {filtered.map(e => (
            <GlassCard key={e.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-black text-[#2A2018] truncate">{e.name}</h3>
                  {e.category && <Badge tone="primary">{e.category}</Badge>}
                </div>
                <span className="font-black text-red-600 tabular-nums">{money(e.amount)}</span>
              </div>
              {e.description && <p className="text-xs text-[#A39588] mt-2 line-clamp-2">{e.description}</p>}
              <p className="text-[11px] text-[#A39588] mt-2 flex items-center gap-1.5">
                {bizExpensePaidInCash(e)
                  ? <><Banknote className="w-3.5 h-3.5" /> Espèces — caisse {cfg.short}</>
                  : <><Vault className="w-3.5 h-3.5" /> Caisse générale
                    {e.paymentMode ? ` · ${e.paymentMode}` : ''}
                    {e.chequeNumber ? ` · n° ${e.chequeNumber}` : ''}</>}
              </p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F3EBE2]">
                <span className="text-[11px] text-[#A39588] flex items-center gap-1">
                  <Calendar className="w-3 h-3" />{formatDate(e.date)}
                </span>
                <RowActions>
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setForm(e)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(e)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}

      {form && (
        <ExpenseForm moduleKey={moduleKey} initial={form === 'new' ? null : form} cats={cats}
          onClose={() => setForm(null)} />
      )}
      <Confirm open={!!toDelete} title="Supprimer la dépense"
        message={`Supprimer « ${toDelete?.name} » ?`}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

/** Saisie d'une dépense — le compte débité est la première question posée. */
function ExpenseForm({ moduleKey, initial, cats, onClose }: {
  moduleKey: ModuleKey; initial: BizExpense | null; cats: string[]; onClose: () => void;
}) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const app = useAppState();
  const dispatch = useAppDispatch();
  const isEdit = !!initial;
  const coffer = cofferOf(moduleKey);

  const caisse = useMemo(() => moduleCaisseBalance(biz.state, moduleKey), [biz.state, moduleKey]);
  const general = useMemo(() => generalCashBalance(app.generalCash), [app.generalCash]);

  const [f, setF] = useState<Partial<BizExpense>>(initial
    ? { ...initial, accountId: initial.accountId || coffer }
    : {
      name: '', description: '', amount: 0,
      date: new Date().toISOString().split('T')[0],
      category: '', accountId: coffer, paymentMode: 'Espèces',
    });
  const set = (k: keyof BizExpense, v: any) => setF(p => ({ ...p, [k]: v }));

  const paidCash = !f.accountId || f.accountId.startsWith('CAISSE');
  const amount = Number(f.amount) || 0;
  /** Le solde du compte choisi APRÈS cette dépense — le chiffre qui alerte. */
  const after = (paidCash ? caisse : general) - amount + (isEdit ? Number(initial?.amount) || 0 : 0);

  const save = () => {
    if (!f.name?.trim()) { toast.error('Le libellé est requis'); return; }
    if (amount <= 0) { toast.error('Montant requis'); return; }

    const id = initial?.id || newId();
    const iso = f.date || new Date().toISOString().split('T')[0];
    const expense: BizExpense = {
      id,
      name: f.name.trim(),
      description: f.description || '',
      amount,
      date: iso,
      category: f.category || undefined,
      accountId: paidCash ? coffer : GENERAL,
      paymentMode: paidCash ? 'Espèces' : (f.paymentMode || 'Virement'),
      chequeNumber: paidCash ? undefined : (f.chequeNumber || undefined),
    };

    if (isEdit) biz.update('expenses', expense); else biz.add('expenses', expense);

    // ── Le miroir au coffre général ────────────────────────────────────────
    // Il est REÉCRIT à chaque enregistrement plutôt que complété : sans cela,
    // corriger le montant d'une dépense laisserait l'ancienne ligne au coffre
    // et le solde compterait la dépense deux fois.
    const existing = app.generalCash.find(t => t.linkedTxId === id);
    if (existing) dispatch({ type: 'DELETE_GENERAL_TX', payload: existing.id });
    if (!paidCash) {
      dispatch({
        type: 'ADD_GENERAL_TX',
        payload: {
          id: newId(),
          kind: 'expense',
          amount,
          date: iso,
          label: `${expense.name} — ${cfg.label}`,
          category: expense.category,
          cafeteriaId: moduleKey,
          linkedTxId: id,
          notes: expense.chequeNumber ? `n° ${expense.chequeNumber}` : undefined,
          createdBy: app.currentUserName || undefined,
          createdAt: new Date().toISOString(),
        },
      });
    }

    toast.success(isEdit ? 'Dépense modifiée' : 'Dépense enregistrée');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={CreditCard} size="lg" formScale
      title={isEdit ? 'Modifier la dépense' : 'Nouvelle dépense'} subtitle={cfg.label}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!f.name?.trim() || amount <= 0}>
          {isEdit ? 'Enregistrer' : 'Valider'}
        </button>
      </>}>
      <div className="space-y-4">
        {/* ── D'où sort l'argent ─────────────────────────────────────── */}
        <div>
          <p className="label-field">Payée par</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <SourceBtn
              active={paidCash} onClick={() => set('accountId', coffer)}
              icon={Banknote} label={`Caisse ${cfg.short}`}
              hint={`Le tiroir du comptoir · ${money(caisse)}`} tone="#B8763E"
            />
            <SourceBtn
              active={!paidCash} onClick={() => set('accountId', GENERAL)}
              icon={Vault} label="Caisse générale"
              hint={`Le coffre de l'enseigne · ${money(general)}`} tone="#4B3621"
            />
          </div>
          {amount > 0 && (
            <p className={`text-[11px] mt-2 font-semibold ${after < 0 ? 'text-red-600' : 'text-[#7A6A5C]'}`}>
              Solde après cette dépense : {money(after)}
              {after < 0 && ' — le compte passera à découvert.'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Libellé" required>
            <Input value={f.name || ''} onChange={e => set('name', e.target.value)} placeholder="Ex : Achat de gobelets" />
          </Field>
          <Field label="Montant (DA)" required>
            <Input type="number" inputMode="decimal" className="text-right" value={f.amount || ''}
              onChange={e => set('amount', Number(e.target.value))} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={f.date || ''} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="Catégorie">
            <Select value={f.category || ''} onChange={e => set('category', e.target.value)}>
              <option value="">— Sans catégorie —</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>

        {!paidCash && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mode de règlement">
              <Select value={f.paymentMode || 'Virement'} onChange={e => set('paymentMode', e.target.value)}>
                {['Virement', 'Chèque', 'Espèces (coffre)', 'TPE'].map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="N° de chèque / bordereau">
              <Input value={f.chequeNumber || ''} onChange={e => set('chequeNumber', e.target.value)} placeholder="Facultatif" />
            </Field>
          </div>
        )}

        <Field label="Description">
          <Textarea value={f.description || ''} onChange={e => set('description', e.target.value)} placeholder="Facultatif" />
        </Field>
      </div>
    </Modal>
  );
}

function SourceBtn({ active, onClick, icon: Icon, label, hint, tone }: {
  active: boolean; onClick: () => void; icon: React.ElementType;
  label: string; hint: string; tone: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition ${
        active ? 'text-white shadow' : 'bg-white border-[#EFE5DA] text-[#4B3621] hover:border-[#D4A373]'
      }`}
      style={active ? { background: tone, borderColor: tone } : undefined}>
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[13px] font-black">{label}</span>
        <span className={`block text-[10.5px] ${active ? 'text-white/75' : 'text-[#A39588]'}`}>{hint}</span>
      </span>
    </button>
  );
}
