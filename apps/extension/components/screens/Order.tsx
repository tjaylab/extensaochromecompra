import { useEffect, useRef, useState } from 'react';
import {
  formatCnpj,
  formatDecimal,
  formatMoney,
  isoToBr,
  isValidCnpj,
  ORDER_STATUS_LABEL,
  parseDecimal,
  type OmiePaymentTermDTO,
  type OmieProductDTO,
  type OrderDTO,
  type UpdateOrderInput,
} from '@compras/shared';
import { api } from '../../lib/api';
import { ErrorBanner, Field, Icon, Screen, Spinner, StatusBadge, useLoad, useNav } from '../ui';
import { deliveryLabel } from './Quotes';

export function Order({ id }: { id: string }) {
  const nav = useNav();
  const order = useLoad(() => api.order(id), [id]);
  const terms = useLoad(() => api.paymentTerms());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cnpj, setCnpj] = useState('');
  const [fx, setFx] = useState('');

  const o = order.data;

  useEffect(() => {
    if (!o) return;
    setFx(o.exchange_rate != null ? formatDecimal(o.exchange_rate) : '');
  }, [o?.id, o?.exchange_rate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while the API is sending to Omie.
  useEffect(() => {
    if (o?.status !== 'sending') return;
    const t = setInterval(() => api.order(id).then(order.setData).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [o?.status, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body: UpdateOrderInput) => {
    setError(null);
    try {
      order.setData(await api.updateOrder(id, body));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      order.setData(await api.sendOrder(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!o) return <Screen title="Pedido de compra">{order.error ? <ErrorBanner message={order.error} onRetry={order.reload} /> : <Spinner label="Carregando…" />}</Screen>;

  if (o.status === 'sending' || o.status === 'sent') return <OrderResult o={o} onDone={() => nav.home()} onOrders={() => nav.go({ name: 'orders' })} />;

  const needsFx = o.quote.currency !== 'BRL';
  const cnpjDigits = cnpj.replace(/\D/g, '');

  return (
    <Screen
      title="Gerar pedido de compra"
      footer={
        <>
          <div className="grow">
            <span className="small muted">Valor total</span>
            <span className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{o.total_brl != null ? formatMoney(o.total_brl, 'BRL') : 'R$ — informe o câmbio'}</span>
            {needsFx && <span className="mono small muted">{formatMoney(o.total_original, o.quote.currency)}{o.exchange_rate ? ` × ${formatDecimal(o.exchange_rate)}` : ''}</span>}
          </div>
          <button type="button" className="btn btn-primary" disabled={!o.ready || busy} onClick={send}>
            <Icon name="send" size={16} /> Enviar para Omie
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 2 }}>
        <span className="mono small muted">{o.number} · a partir de {o.quote.number}{o.requisition ? ` · ${o.requisition.number}` : ''}</span>
        <strong style={{ fontSize: 16 }}>Confira antes de enviar ao Omie</strong>
      </div>
      {o.status === 'error' && <ErrorBanner message={`O Omie recusou o último envio: ${o.last_error}. Corrija e envie de novo.`} />}
      {error && <ErrorBanner message={error} />}

      <section className="card">
        <span className="section-label">Fornecedor</span>
        <strong>{o.supplier.name}</strong>
        {o.supplier.omie_id ? (
          <span className="small" style={{ color: 'var(--success-ink)' }}>Vinculado ao fornecedor do Omie</span>
        ) : o.supplier.cnpj ? (
          <span className="small muted">CNPJ {formatCnpj(o.supplier.cnpj)} · será localizado ou cadastrado no Omie no envio</span>
        ) : (
          <Field
            id="cnpj"
            label="CNPJ"
            hint="Ainda não existe no Omie. Com o CNPJ, ele é localizado ou cadastrado como fornecedor no envio."
            error={cnpjDigits.length === 14 && !isValidCnpj(cnpjDigits) ? 'CNPJ inválido' : null}
          >
            <input
              id="cnpj"
              className={cnpjDigits.length === 14 && isValidCnpj(cnpjDigits) ? 'input' : 'input missing'}
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              value={cnpj}
              onChange={(e) => setCnpj(formatCnpj(e.target.value))}
              onBlur={() => cnpjDigits.length === 14 && isValidCnpj(cnpjDigits) && patch({ supplier_cnpj: cnpjDigits })}
            />
          </Field>
        )}
      </section>

      {o.items.map((item) => (
        <ItemProduct key={item.id} item={item} currency={o.quote.currency} onPick={(pid) => patch({ items: [{ id: item.id, omie_product_id: pid }] })} />
      ))}

      <section className="card">
        <span className="section-label">Condições</span>
        <div className="grid2">
          <div className="stack" style={{ gap: 2 }}><span className="small muted">Prazo de entrega</span>{deliveryLabel(o.quote)}</div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="small muted">Frete</span>
            {o.quote.freight_type ?? 'Não informado'}{o.quote.freight_value != null ? ` · ${formatMoney(o.quote.freight_value, o.quote.currency)}` : ''}
          </div>
        </div>
        <Field id="parc" label={`Condição de parcela no Omie${o.quote.payment_terms_text ? ` (proposta: ${o.quote.payment_terms_text})` : ''}`} error={terms.error}>
          <select id="parc" className={o.payment_term_code ? 'select' : 'select missing'} value={o.payment_term_code ?? ''} onChange={(e) => patch({ payment_term_code: e.target.value || null })}>
            <option value="">Selecione…</option>
            {terms.data?.map((t: OmiePaymentTermDTO) => (
              <option key={t.code} value={t.code}>{t.code} · {t.description}</option>
            ))}
          </select>
        </Field>
        {needsFx && (
          <Field id="fx" label={`Taxa de câmbio ${o.quote.currency} → BRL`} hint="O pedido de compra do Omie não tem campo de moeda: o valor vai em reais e a moeda e a taxa ficam na observação do pedido.">
            <input
              id="fx"
              className={o.exchange_rate ? 'input' : 'input missing'}
              inputMode="decimal"
              placeholder="ex.: 5,40"
              value={fx}
              onChange={(e) => setFx(e.target.value)}
              onBlur={() => {
                const v = parseDecimal(fx);
                if (v !== o.exchange_rate) patch({ exchange_rate: v && v > 0 ? v : null });
              }}
            />
          </Field>
        )}
      </section>

      <section className="stack" aria-label="Pendências">
        {o.checks.map((c) => (
          <div key={c.key} className={`check ${c.ok ? 'ok' : ''}`}>
            <span className="mark" aria-hidden="true" />
            <span>{c.label}</span>
            <span className="sr-only">{c.ok ? 'ok' : 'pendente'}</span>
          </div>
        ))}
      </section>
    </Screen>
  );
}

function ItemProduct({ item, currency, onPick }: { item: OrderDTO['items'][number]; currency: string; onPick: (id: number | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<OmieProductDTO[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = (value: string) => {
    setQ(value);
    clearTimeout(timer.current);
    if (!value.trim()) return setResults(null);
    timer.current = setTimeout(() => {
      setSearching(true);
      api
        .products(value)
        .then((r) => (setResults(r), setError(null)))
        .catch((e) => setError(e.message))
        .finally(() => setSearching(false));
    }, 300);
  };

  return (
    <section className="card">
      <span className="section-label">Item</span>
      <div className="row-between">
        <span>{item.description}</span>
        <span className="mono small" style={{ whiteSpace: 'nowrap' }}>{formatDecimal(item.quantity)} {item.unit ?? ''} × {formatMoney(item.unit_price, currency)}</span>
      </div>
      {item.omie_product_id ? (
        <div className="row-between">
          <span className="small" style={{ color: 'var(--success-ink)' }}>Produto no Omie: {item.omie_product_label}</span>
          <button type="button" className="btn-link small" onClick={() => onPick(null)}>Trocar</button>
        </div>
      ) : (
        <>
          {item.suggestion && (
            <button type="button" className="btn btn-outline" style={{ justifyContent: 'flex-start' }} onClick={() => onPick(item.suggestion!.omie_id)}>
              Usar sugestão: {item.suggestion.label}
            </button>
          )}
          <Field id={`prod-${item.id}`} label="Buscar produto no Omie" error={error}>
            <input id={`prod-${item.id}`} className="input missing" value={q} onChange={(e) => search(e.target.value)} placeholder="Nome ou código do produto" />
          </Field>
          {searching && <Spinner label="Buscando…" />}
          {results && (
            <div className="result-list" role="listbox" aria-label="Produtos do Omie">
              {results.length ? (
                results.map((p) => (
                  <button key={p.omie_id} type="button" role="option" aria-selected={false} onClick={() => onPick(p.omie_id)}>
                    <span className="mono">{p.code}</span> · {p.description}{p.unit ? ` (${p.unit})` : ''}
                  </button>
                ))
              ) : (
                <div className="empty small">Nenhum produto encontrado. Cadastre-o no Omie e busque de novo.</div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function OrderResult({ o, onDone, onOrders }: { o: OrderDTO; onDone: () => void; onOrders: () => void }) {
  const sending = o.status === 'sending';
  return (
    <Screen
      title="Pedido de compra"
      footer={
        !sending && (
          <>
            <button type="button" className="btn btn-primary" onClick={onOrders}>Ver pedidos de compra</button>
            <button type="button" className="btn btn-secondary" onClick={onDone}>Voltar ao início</button>
          </>
        )
      }
    >
      {sending ? (
        <Spinner label={`Enviando para o Omie…${o.attempts > 1 ? ` (tentativa ${o.attempts})` : ''}`} />
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={26} />
          </div>
          <strong style={{ fontSize: 18 }}>Pedido enviado ao Omie</strong>
          <span className="muted">
            Nº no Omie: <strong className="mono" style={{ color: 'var(--ink)' }}>{o.omie_number ?? o.omie_order_id}</strong>
          </span>
        </div>
      )}
      <div className="card">
        <div className="row-between"><span className="muted">Pedido</span><span className="mono">{o.number}</span></div>
        <div className="row-between"><span className="muted">Fornecedor</span><span>{o.supplier.name}</span></div>
        {o.items.map((i) => (
          <div key={i.id} className="row-between"><span className="muted">Item</span><span>{i.omie_product_label} · {formatDecimal(i.quantity)} {i.unit ?? ''}</span></div>
        ))}
        <div className="row-between"><span className="muted">Parcela</span><span>{o.payment_term_code}</span></div>
        <div className="row-between"><span className="muted">Total</span><span className="mono">{formatMoney(o.total_brl, 'BRL')}</span></div>
        <div className="row-between"><span className="muted">Status</span><StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} /></div>
        {o.sent_at && <div className="row-between"><span className="muted">Enviado em</span><span>{isoToBr(o.sent_at)}</span></div>}
      </div>
    </Screen>
  );
}
