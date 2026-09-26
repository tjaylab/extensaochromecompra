import { useEffect, useState } from 'react';
import { formatDecimal, formatMoney, isoToBr, QUOTE_STATUS_LABEL } from '@compras/shared';
import { ApiError, api } from '../../lib/api';
import { ErrorBanner, Field, Screen, Spinner, StatusBadge, useLoad, useNav } from '../ui';
import { deliveryLabel } from './Quotes';

export function QuoteDetail({ id }: { id: string }) {
  const nav = useNav();
  const quote = useLoad(() => api.quote(id), [id]);
  const reqs = useLoad(() => api.requisitions('open'));
  const [reqId, setReqId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setReqId(quote.data?.requisition?.id ?? ''), [quote.data]);

  if (quote.loading && !quote.data) return <Screen title="Cotação"><Spinner label="Carregando…" /></Screen>;
  if (!quote.data) return <Screen title="Cotação"><ErrorBanner message={quote.error ?? 'Não encontrada'} onRetry={quote.reload} /></Screen>;
  const q = quote.data;
  const editable = q.status === 'registered' || q.status === 'comparing';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const generateOrder = () =>
    run(async () => {
      try {
        const po = await api.createOrder(q.id);
        nav.go({ name: 'order', id: po.id });
      } catch (e) {
        const orderId = e instanceof ApiError ? (e.details as { order_id?: string } | undefined)?.order_id : undefined;
        if (orderId) nav.go({ name: 'order', id: orderId });
        else throw e;
      }
    });

  return (
    <Screen
      title={q.number}
      footer={
        q.status !== 'discarded' && (
          <>
            {q.requisition && (
              <button type="button" className="btn btn-secondary" onClick={() => nav.go({ name: 'compare', id: q.requisition!.id })}>
                Comparar
              </button>
            )}
            <div className="grow" />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={generateOrder}>
              {q.status === 'ordered' || q.status === 'selected' ? 'Ver pedido' : 'Gerar pedido de compra'}
            </button>
          </>
        )
      }
    >
      {error && <ErrorBanner message={error} />}
      <div className="row-between">
        <strong style={{ fontSize: 16 }}>{q.supplier.name}</strong>
        <StatusBadge status={q.status} label={QUOTE_STATUS_LABEL[q.status]} />
      </div>
      <div className="card">
        {q.items.map((i) => (
          <div key={i.id} className="stack" style={{ gap: 2 }}>
            <div className="row-between">
              <span>{i.description}{i.brand ? ` · ${i.brand}` : ''}</span>
              <span className="mono">{formatMoney(i.total, q.currency)}</span>
            </div>
            <span className="small muted mono">
              {formatDecimal(i.quantity)} {i.unit ?? ''} × {formatMoney(i.unit_price, q.currency)}{i.sku ? ` · SKU ${i.sku}` : ''}
            </span>
          </div>
        ))}
        <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <strong>Total</strong>
          <strong className="mono">{formatMoney(q.total, q.currency)}</strong>
        </div>
      </div>
      <div className="card grid2">
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Prazo</span>{deliveryLabel(q)}</div>
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Pagamento</span>{q.payment_terms_text ?? 'Não informado'}</div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="small muted">Frete</span>
          {q.freight_type ?? 'Não informado'}{q.freight_value != null ? ` · ${formatMoney(q.freight_value, q.currency)}` : ''}
        </div>
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Validade</span>{q.validity_text ?? 'Não informada'}</div>
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Data</span>{isoToBr(q.quote_date)}</div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="small muted">Registro</span>
          {q.registration_ms != null ? `${Math.round(q.registration_ms / 1000)} s · ${q.origin === 'whatsapp' ? 'WhatsApp' : 'manual'}` : q.origin}
        </div>
      </div>
      <div className="stack">
        <span className="section-label">Texto original</span>
        <div className="source">{q.source_text}</div>
      </div>
      {editable && (
        <div className="stack">
          <Field id="link-req" label="Comparativo">
            <select id="link-req" className="select" value={reqId} onChange={(e) => setReqId(e.target.value)}>
              <option value="">Sem comparativo</option>
              {reqs.data?.map((r) => (
                <option key={r.id} value={r.id}>{r.number} · {r.title}</option>
              ))}
            </select>
          </Field>
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || reqId === (q.requisition?.id ?? '')}
              onClick={() => run(async () => quote.setData(await api.updateQuote(q.id, { requisition_id: reqId || null })))}
            >
              Salvar vínculo
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run(async () => quote.setData(await api.updateQuote(q.id, { status: 'discarded' })))}>
              Descartar cotação
            </button>
          </div>
        </div>
      )}
      {q.status === 'discarded' && (
        <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(async () => quote.setData(await api.updateQuote(q.id, { status: 'registered' })))}>
          Restaurar cotação
        </button>
      )}
    </Screen>
  );
}
