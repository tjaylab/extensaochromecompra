import { formatMoney, isoToBr, ORDER_STATUS_LABEL } from '@compras/shared';
import { api } from '../../lib/api';
import { ErrorBanner, Screen, Spinner, StatusBadge, useLoad, useNav } from '../ui';

export function Orders() {
  const nav = useNav();
  const list = useLoad(() => api.orders());
  return (
    <Screen title="Pedidos de compra">
      {list.loading && <Spinner label="Carregando…" />}
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.data && !list.data.length && <div className="empty">Nenhum pedido enviado ainda. Gere um a partir da comparação de propostas.</div>}
      <div className="stack">
        {list.data?.map((o) => (
          <button key={o.id} type="button" className="card card-button" style={{ gap: 6 }} onClick={() => nav.go({ name: 'order', id: o.id })}>
            <div className="row-between">
              <strong>{o.supplier.name}</strong>
              <StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} />
            </div>
            <div className="row-between small muted">
              <span className="mono">{o.number}{o.omie_number ? ` · Omie ${o.omie_number}` : ''}</span>
              <span className="mono" style={{ color: 'var(--ink)' }}>{formatMoney(o.total_brl, 'BRL')}</span>
            </div>
            <div className="row-between small muted">
              <span>{o.quote.number}{o.requisition ? ` · ${o.requisition.number}` : ''}</span>
              <span>{isoToBr(o.sent_at ?? o.created_at)}</span>
            </div>
            {o.status === 'error' && <span className="small" style={{ color: 'var(--danger-ink)' }}>{o.last_error}</span>}
          </button>
        ))}
      </div>
    </Screen>
  );
}
