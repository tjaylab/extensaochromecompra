import { useState } from 'react';
import { formatCnpj, isoToBr, PLAN_IDS, PLANS, SUBSCRIPTION_STATUS_LABEL, type AdminCompanyDTO, type AdminSubscriptionInput } from '@compras/shared';
import { api } from '../../lib/api';
import { ErrorBanner, Field, Screen, Spinner, StatusBadge, useLoad } from '../ui';

const STATUS_BADGE = { trialing: 'info', active: 'ok', past_due: 'selected', canceled: 'error' } as const;
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** ProcureMate team only (SUPERADMIN_EMAILS): every company, its plan and usage; manual billing and adjustments. */
export function Admin() {
  const list = useLoad(() => api.adminCompanies());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const replace = (c: AdminCompanyDTO) => list.setData((list.data ?? []).map((x) => (x.id === c.id ? c : x)));

  return (
    <Screen title="Painel ProcureMate">
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Spinner label="Carregando empresas…" />}
      {list.data && (
        <>
          <div className="grid2">
            <Stat label="Empresas" value={String(list.data.length)} />
            <Stat label="Pagantes" value={String(list.data.filter((c) => c.status === 'active').length)} />
            <Stat label="Em teste" value={String(list.data.filter((c) => c.status === 'trialing').length)} />
            <Stat
              label="Receita mensal"
              value={`R$ ${compact.format(
                list.data.filter((c) => c.status === 'active').reduce((a, c) => a + (c.cycle === 'yearly' ? PLANS[c.plan].yearly / 12 : PLANS[c.plan].monthly), 0),
              )}`}
            />
          </div>
          <Field id="adm-q" label="Buscar empresa">
            <input id="adm-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          {rows.map((c) => (
            <section key={c.id} className="card" aria-label={c.name}>
              <button type="button" className="row-between" style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>{c.name}</strong>
                  <span className="small muted">
                    {PLANS[c.plan].name} · {c.cycle === 'yearly' ? 'anual' : 'mensal'} · até {isoToBr(c.period_end)}
                  </span>
                </span>
                <StatusBadge status={STATUS_BADGE[c.status]} label={SUBSCRIPTION_STATUS_LABEL[c.status]} />
              </button>
              <div className="grid2 small">
                <span>Leituras: <span className="mono">{c.readings.used}/{c.readings.limit}</span></span>
                <span>Compradores: <span className="mono">{c.seats.used}/{c.seats.limit ?? '∞'}</span></span>
                <span>Tokens: <span className="mono">{compact.format(c.tokens.input)} in · {compact.format(c.tokens.output)} out</span></span>
                <span>{c.cnpj ? formatCnpj(c.cnpj) : 'sem CNPJ'}</span>
              </div>
              {open === c.id && <Editor c={c} onSaved={replace} />}
            </section>
          ))}
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="small muted">{label}</span>
      <strong className="mono" style={{ fontSize: 16 }}>{value}</strong>
    </div>
  );
}

function Editor({ c, onSaved }: { c: AdminCompanyDTO; onSaved: (c: AdminCompanyDTO) => void }) {
  const [plan, setPlan] = useState(c.plan);
  const [cycle, setCycle] = useState(c.cycle);
  const [extra, setExtra] = useState('');
  const [days, setDays] = useState('');
  const [seats, setSeats] = useState('');
  const [readings, setReadings] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async (body: Partial<AdminSubscriptionInput>, done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      onSaved(await api.adminUpdate(c.id, body));
      setNote(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="grid2">
        <Field id={`p-${c.id}`} label="Plano">
          <select id={`p-${c.id}`} className="select" value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
            {PLAN_IDS.map((id) => <option key={id} value={id}>{PLANS[id].name}</option>)}
          </select>
        </Field>
        <Field id={`c-${c.id}`} label="Ciclo">
          <select id={`c-${c.id}`} className="select" value={cycle} onChange={(e) => setCycle(e.target.value as typeof cycle)}>
            <option value="monthly">Mensal</option>
            <option value="yearly">Anual</option>
          </select>
        </Field>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save({ plan, cycle }, 'Plano alterado.')}>Salvar plano</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save({ plan, cycle, mark_paid: true }, 'Período marcado como pago.')}>Marcar como pago</button>
      </div>
      <div className="grid2">
        <Field id={`t-${c.id}`} label="Estender teste (dias)">
          <input id={`t-${c.id}`} className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} placeholder="ex.: 14" />
        </Field>
        <Field id={`x-${c.id}`} label="Leituras extras no mês">
          <input id={`x-${c.id}`} className="input" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value.replace(/\D/g, ''))} placeholder="ex.: 200" />
        </Field>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" disabled={busy || !days} onClick={() => save({ status: 'trialing', trial_ends_at: inDays(Number(days)) }, `Teste estendido por ${days} dias.`)}>Estender teste</button>
        <button type="button" className="btn btn-secondary" disabled={busy || !extra} onClick={() => save({ extra_readings: Number(extra) }, `${extra} leituras extras liberadas.`)}>Liberar leituras</button>
      </div>
      {plan === 'empresa' && (
        <>
          <div className="grid2">
            <Field id={`s-${c.id}`} label="Compradores (vazio = ilimitado)">
              <input id={`s-${c.id}`} className="input" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id={`r-${c.id}`} label="Leituras por mês">
              <input id={`r-${c.id}`} className="input" inputMode="numeric" value={readings} onChange={(e) => setReadings(e.target.value.replace(/\D/g, ''))} placeholder={String(PLANS.empresa.limits.readings)} />
            </Field>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy}
            onClick={() => save({ custom_seats: seats ? Number(seats) : null, custom_readings: readings ? Number(readings) : null }, 'Limites personalizados salvos.')}
          >
            Salvar limites
          </button>
        </>
      )}
      <button type="button" className="btn-link small" style={{ alignSelf: 'flex-start', color: 'var(--danger-ink)' }} disabled={busy} onClick={() => window.confirm(`Cancelar a assinatura de ${c.name}? A IA para de ler para esta empresa.`) && save({ status: 'canceled' }, 'Assinatura cancelada.')}>
        Cancelar assinatura
      </button>
      {error && <ErrorBanner message={error} />}
      {note && <span className="small" style={{ color: 'var(--success-ink)' }}>{note}</span>}
    </div>
  );
}
