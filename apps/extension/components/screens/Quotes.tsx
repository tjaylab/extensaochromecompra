import { useState } from 'react';
import { formatMoney, isoToBr, QUOTE_STATUS_LABEL, todayIso, addDaysIso, type QuoteStatus } from '@compras/shared';
import { api } from '../../lib/api';
import { ErrorBanner, Field, Icon, Screen, Spinner, StatusBadge, useLoad, useNav } from '../ui';

const STATUSES: ('' | QuoteStatus)[] = ['', 'registered', 'comparing', 'selected', 'ordered', 'discarded'];

export function deliveryLabel(q: { delivery_days: number | null; delivery_date: string | null }) {
  if (q.delivery_date) return isoToBr(q.delivery_date);
  if (q.delivery_days != null) return q.delivery_days === 0 ? 'Pronta entrega' : `${q.delivery_days} dias`;
  return 'Não informado';
}

export function Quotes({ flash }: { flash?: string }) {
  const nav = useNav();
  const [status, setStatus] = useState<'' | QuoteStatus>('');
  const [supplierId, setSupplierId] = useState('');
  const [period, setPeriod] = useState('30');
  const suppliers = useLoad(() => api.suppliers());
  const from = period ? addDaysIso(todayIso(), -Number(period)) : undefined;
  const quotes = useLoad(() => api.quotes({ status: status || undefined, supplier_id: supplierId || undefined, from }), [status, supplierId, period]);

  // Requisitions with 2+ visible proposals get a shortcut to the comparison.
  const comparable = new Map<string, { number: string; count: number }>();
  for (const q of quotes.data ?? []) {
    if (!q.requisition || q.status === 'discarded') continue;
    const c = comparable.get(q.requisition.id) ?? { number: q.requisition.number, count: 0 };
    comparable.set(q.requisition.id, { ...c, count: c.count + 1 });
  }

  return (
    <Screen title="Minhas cotações">
      {flash && (
        <div className="banner banner-ok" role="status">
          <Icon name="check" /> {flash}
        </div>
      )}
      <div className="row wrap" role="group" aria-label="Filtrar por status">
        {STATUSES.map((s) => (
          <button key={s || 'all'} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? QUOTE_STATUS_LABEL[s] : 'Ativas'}
          </button>
        ))}
      </div>
      <div className="grid2">
        <Field id="f-sup" label="Fornecedor">
          <select id="f-sup" className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Todos</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field id="f-per" label="Período">
          <select id="f-per" className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="">Todo o período</option>
          </select>
        </Field>
      </div>

      {[...comparable.entries()]
        .filter(([, c]) => c.count > 1)
        .map(([id, c]) => (
          <button key={id} type="button" className="card card-button" style={{ flexDirection: 'row', justifyContent: 'space-between', borderColor: '#b9d3c8', background: '#f1f7f4' }} onClick={() => nav.go({ name: 'compare', id })}>
            <span><strong>{c.number}</strong> tem {c.count} propostas</span>
            <strong style={{ color: 'var(--accent-ink)' }}>Comparar →</strong>
          </button>
        ))}

      {quotes.loading && <Spinner label="Carregando…" />}
      {quotes.error && <ErrorBanner message={quotes.error} onRetry={quotes.reload} />}
      {quotes.data && !quotes.data.length && <div className="empty">Nenhuma cotação com esses filtros.</div>}
      <div className="stack">
        {quotes.data?.map((q) => (
          <button key={q.id} type="button" className="card card-button" style={{ gap: 6 }} onClick={() => nav.go({ name: 'quote', id: q.id })}>
            <div className="row-between">
              <strong>{q.supplier.name}</strong>
              <StatusBadge status={q.status} label={QUOTE_STATUS_LABEL[q.status]} />
            </div>
            <div className="row-between small muted">
              <span className="mono">{q.number} · {isoToBr(q.quote_date)}</span>
              <span className="mono" style={{ color: 'var(--ink)', fontWeight: 500 }}>{formatMoney(q.total, q.currency)}</span>
            </div>
            <div className="row-between small muted">
              <span>Prazo {deliveryLabel(q)}</span>
              <span>{q.requisition ? q.requisition.number : 'Sem requisição'}</span>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}
