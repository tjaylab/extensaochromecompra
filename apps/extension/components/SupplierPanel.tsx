import { useEffect, useState } from 'react';
import { formatCnpj, formatMoney, isoToBr, QUOTE_STATUS_LABEL, type SupplierContextDTO } from '@compras/shared';
import { api } from '../lib/api';
import { ACTIVE_CONTACT_KEY, type ActiveContact, type ContactResponse } from '../lib/capture';
import { MonthlyBars, PriceHistory } from './charts';
import { ErrorBanner, Spinner, StatusBadge, useNav } from './ui';

/** Follows the conversation open in WhatsApp Web (the content script reports every switch). */
function useActiveContact(): ContactResponse | null {
  const [contact, setContact] = useState<ContactResponse | null>(null);
  useEffect(() => {
    const apply = (c: ActiveContact | undefined) => setContact(c && (c.contactName || c.contactPhone) ? { contactName: c.contactName, contactPhone: c.contactPhone } : null);
    chrome.storage.session.get(ACTIVE_CONTACT_KEY).then((r) => apply(r[ACTIVE_CONTACT_KEY] as ActiveContact | undefined));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && ACTIVE_CONTACT_KEY in changes) apply(changes[ACTIVE_CONTACT_KEY]!.newValue as ActiveContact | undefined);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return contact;
}

export function SupplierPanel() {
  const nav = useNav();
  const contact = useActiveContact();
  const [ctx, setCtx] = useState<SupplierContextDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!contact) return setCtx(null);
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .supplierContext(contact.contactName, contact.contactPhone)
      .then((c) => alive && setCtx(c))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [contact?.contactName, contact?.contactPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (omieId: number) => {
    if (!contact) return;
    setLinking(true);
    try {
      setCtx(await api.linkSupplier({ omie_id: omieId, contact_name: contact.contactName, contact_phone: contact.contactPhone }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinking(false);
    }
  };

  if (!contact) {
    return <div className="card small muted">Abra uma conversa no WhatsApp Web para ver o histórico do fornecedor.</div>;
  }

  const title = ctx?.supplier?.name ?? ctx?.omie_supplier?.trade_name ?? ctx?.omie_supplier?.name ?? contact.contactName ?? contact.contactPhone;
  const recognized = !!(ctx?.supplier || ctx?.omie_supplier);

  return (
    <section className="card" aria-label="Fornecedor da conversa">
      <div className="row-between">
        <span className="section-label">Fornecedor da conversa</span>
        {ctx && (
          <StatusBadge
            status={ctx.omie_supplier || ctx.supplier?.omie_id ? 'ok' : recognized ? 'draft' : 'registered'}
            label={ctx.omie_supplier || ctx.supplier?.omie_id ? 'No Omie' : recognized ? 'Só no app' : 'Não cadastrado'}
          />
        )}
      </div>
      <div className="stack" style={{ gap: 2 }}>
        <strong style={{ fontSize: 16 }}>{title}</strong>
        <span className="small muted">
          {[
            ctx?.omie_supplier?.name && ctx.omie_supplier.name !== title ? ctx.omie_supplier.name : null,
            ctx?.supplier?.cnpj || ctx?.omie_supplier?.cnpj ? `CNPJ ${formatCnpj((ctx?.supplier?.cnpj || ctx?.omie_supplier?.cnpj)!)}` : null,
            ctx?.match === 'phone' ? 'reconhecido pelo telefone' : ctx?.match === 'alias' ? 'vinculado por você' : ctx?.match === 'name' ? 'reconhecido pelo nome' : null,
          ]
            .filter(Boolean)
            .join(' · ') || (contact.contactName && contact.contactPhone ? contact.contactPhone : '')}
        </span>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && !ctx && <Spinner label="Buscando histórico…" />}

      {ctx && !recognized && (
        <div className="stack">
          {ctx.candidates.length ? (
            <>
              <span className="small muted">Não reconheci este contato. É algum destes fornecedores do Omie?</span>
              {ctx.candidates.map((c) => (
                <button key={c.omie_id} type="button" className="btn btn-outline" style={{ justifyContent: 'flex-start' }} disabled={linking} onClick={() => link(c.omie_id)}>
                  {c.trade_name || c.name}
                  {c.cnpj ? <span className="small muted" style={{ marginLeft: 'auto' }}>{formatCnpj(c.cnpj)}</span> : null}
                </button>
              ))}
            </>
          ) : (
            <span className="small muted">
              {ctx.omie.available
                ? 'Contato não encontrado nos fornecedores do Omie. Ele será cadastrado quando você registrar a primeira cotação.'
                : 'Conecte o Omie em Configurações para ver o histórico de compras.'}
            </span>
          )}
        </div>
      )}

      {ctx && recognized && (
        <>
          <div className="grid2">
            <Kpi label="Compras em 12 meses" value={ctx.omie.orders_12m ? formatMoney(ctx.omie.spent_12m, 'BRL') : '—'} hint={`${ctx.omie.orders_12m} pedido(s)`} />
            <Kpi label="Ticket médio" value={ctx.omie.average_ticket != null ? formatMoney(ctx.omie.average_ticket, 'BRL') : '—'} />
            <Kpi
              label="Último pedido"
              value={ctx.omie.last_order ? isoToBr(ctx.omie.last_order.date) : '—'}
              hint={ctx.omie.last_order ? `${ctx.omie.last_order.number ? `nº ${ctx.omie.last_order.number} · ` : ''}${formatMoney(ctx.omie.last_order.total, 'BRL')}` : undefined}
            />
            <Kpi
              label="Cotações aqui"
              value={String(ctx.quotes.total)}
              hint={ctx.quotes.total ? `${ctx.quotes.ordered} viraram pedido${ctx.quotes.average_delivery_days != null ? ` · prazo médio ${ctx.quotes.average_delivery_days} dias` : ''}` : undefined}
            />
          </div>

          {ctx.omie.orders_12m > 0 && <MonthlyBars data={ctx.omie.monthly} />}
          {!!ctx.omie.price_history.length && <PriceHistory series={ctx.omie.price_history} />}

          {!!ctx.omie.recent_orders.length && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">Últimos pedidos no Omie</span>
              {ctx.omie.recent_orders.map((o, i) => (
                <div key={`${o.number}-${i}`} className="row-between small">
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span className="mono">{isoToBr(o.date)}</span> · {o.items}
                  </span>
                  <span className="mono" style={{ whiteSpace: 'nowrap' }}>{formatMoney(o.total, 'BRL')}</span>
                </div>
              ))}
            </div>
          )}

          {!!ctx.quotes.recent.length && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">Últimas cotações</span>
              {ctx.quotes.recent.map((q) => (
                <button key={q.id} type="button" className="row-between small" style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left' }} onClick={() => nav.go({ name: 'quote', id: q.id })}>
                  <span className="mono">{q.number} · {isoToBr(q.date)}</span>
                  <span className="row">
                    <span className="mono">{formatMoney(q.total, q.currency)}</span>
                    <StatusBadge status={q.status} label={QUOTE_STATUS_LABEL[q.status]} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {!ctx.omie.available && <span className="small muted">Histórico do Omie indisponível no momento.</span>}
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="small muted">{label}</span>
      <strong className="mono" style={{ fontSize: 15 }}>{value}</strong>
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}
