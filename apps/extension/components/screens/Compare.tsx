import { useEffect, useState } from 'react';
import { formatDecimal, formatMoney, QUOTE_STATUS_LABEL, type QuoteDTO } from '@compras/shared';
import { ApiError, api } from '../../lib/api';
import { ErrorBanner, Screen, Spinner, useLoad, useNav } from '../ui';
import { deliveryLabel } from './Quotes';

type Row = { label: string; value: (q: QuoteDTO) => string; mono?: boolean };

const ROWS: Row[] = [
  { label: 'Quantidade', value: (q) => q.items.map((i) => `${formatDecimal(i.quantity)} ${i.unit ?? ''}`.trim()).join(' + ') },
  { label: 'Valor unitário', value: (q) => q.items.map((i) => formatMoney(i.unit_price, q.currency)).join(' / '), mono: true },
  { label: 'Valor total', value: (q) => formatMoney(q.total, q.currency), mono: true },
  { label: 'Moeda', value: (q) => q.currency },
  { label: 'Prazo de entrega', value: (q) => deliveryLabel(q) },
  { label: 'Condição de pagamento', value: (q) => q.payment_terms_text ?? 'Não informado' },
  { label: 'Frete', value: (q) => (q.freight_type ? `${q.freight_type}${q.freight_value != null ? ` · ${formatMoney(q.freight_value, q.currency)}` : ''}` : 'Não informado') },
  { label: 'Status', value: (q) => QUOTE_STATUS_LABEL[q.status] },
];

export function Compare({ id }: { id: string }) {
  const nav = useNav();
  const cmp = useLoad(() => api.comparison(id), [id]);
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cmp.data) return;
    api.event('comparison_viewed', id, { quotes: cmp.data.quotes.length });
    const current = cmp.data.quotes.find((q) => q.status === 'selected' || q.status === 'ordered');
    if (current) setSelected(current.id);
  }, [cmp.data, id]);

  const locked = !!cmp.data?.quotes.some((q) => q.status === 'ordered');

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const po = await api.createOrder(selected);
      api.event('order_generated', po.id);
      nav.go({ name: 'order', id: po.id });
    } catch (e) {
      const orderId = e instanceof ApiError ? (e.details as { order_id?: string } | undefined)?.order_id : undefined;
      if (orderId) nav.go({ name: 'order', id: orderId });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!cmp.data) {
    return <Screen title="Comparar propostas">{cmp.error ? <ErrorBanner message={cmp.error} onRetry={cmp.reload} /> : <Spinner label="Carregando…" />}</Screen>;
  }
  const { requisition, quotes } = cmp.data;
  const chosen = quotes.find((q) => q.id === selected);

  return (
    <Screen
      title="Comparar propostas"
      footer={
        <>
          <span className="grow small muted">
            {chosen ? `Selecionada: ${chosen.supplier.name} · ${formatMoney(chosen.total, chosen.currency)}` : 'Selecione uma proposta para gerar o pedido.'}
          </span>
          <button type="button" className="btn btn-primary" disabled={!chosen || busy} onClick={generate}>
            {locked ? 'Ver pedido' : 'Gerar pedido de compra'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 2 }}>
        <span className="mono small muted">{requisition.number}</span>
        <strong style={{ fontSize: 16 }}>{requisition.title}</strong>
        <span className="small muted">Valores na moeda original, sem conversão automática. Arraste para o lado se houver muitas propostas.</span>
      </div>
      {error && <ErrorBanner message={error} />}
      {!quotes.length ? (
        <div className="empty">Nenhuma cotação vinculada a esta requisição ainda.</div>
      ) : (
        <div className="table-scroll">
          <table className="cmp">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Campo</span></th>
                {quotes.map((q) => (
                  <th key={q.id} scope="col" className={q.id === selected ? 'selected' : ''} style={q.id === selected ? { boxShadow: 'inset 0 3px 0 var(--accent)' } : undefined}>
                    <div className="stack" style={{ gap: 4 }}>
                      <strong>{q.supplier.name}</strong>
                      <span className="mono small muted">{q.number}</span>
                      <div className="row wrap" style={{ gap: 4, minHeight: 22 }}>
                        {q.badges.map((b) => (
                          <span key={b} className="badge badge-info" style={{ fontSize: 11 }}>{b}</span>
                        ))}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {quotes.map((q) => {
                    const v = row.value(q);
                    return (
                      <td key={q.id} className={`${q.id === selected ? 'selected' : ''} ${v.startsWith('Não informad') ? 'missing-value' : ''} ${row.mono ? 'mono' : ''}`}>
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" />
                {quotes.map((q) => (
                  <td key={q.id} className={q.id === selected ? 'selected' : ''}>
                    <button
                      type="button"
                      className={q.id === selected ? 'btn btn-primary btn-block' : 'btn btn-outline btn-block'}
                      aria-pressed={q.id === selected}
                      disabled={locked}
                      onClick={() => setSelected(q.id === selected ? '' : q.id)}
                    >
                      {q.id === selected ? 'Selecionada' : 'Selecionar'}
                    </button>
                    <button type="button" className="btn-link small" style={{ marginTop: 8 }} onClick={() => nav.go({ name: 'quote', id: q.id })}>
                      Ver mensagem
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}
