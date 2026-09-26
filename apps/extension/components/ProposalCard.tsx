import { formatDecimal, formatMoney, isoToBr, type ExtractionResponse, type QuoteDTO } from '@compras/shared';
import { quoteFromExtraction } from '../lib/auto-quote';
import { Icon, Spinner } from './ui';

export interface ProposalView {
  key: string;
  source: 'conversation' | 'image' | 'pdf' | 'file';
  fileName: string | null;
  ex: ExtractionResponse;
  contact: { contactName: string | null; contactPhone: string | null };
  detectedAt: number;
  status: 'ready' | 'saving' | 'saved' | 'error';
  quote?: QuoteDTO;
  error?: string;
}

const SOURCE_LABEL = { conversation: 'da conversa', image: 'da imagem', pdf: 'do PDF', file: 'do arquivo' } as const;

/** A proposal read automatically, ready to save in one click (or review). */
export function ProposalCard({ p, onSave, onReview, onIgnore, onOpenQuote }: { p: ProposalView; onSave: () => void; onReview: () => void; onIgnore: () => void; onOpenQuote: () => void }) {
  if (p.status === 'saved' && p.quote) {
    return (
      <section className="card card-enter" style={{ gap: 8 }}>
        <div className="row" style={{ color: 'var(--success-ink)' }}>
          <Icon name="check" />
          <strong>Cotação {p.quote.number} salva · {formatMoney(p.quote.total, p.quote.currency)}</strong>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onIgnore}>Fechar</button>
          <button type="button" className="btn btn-outline" onClick={onOpenQuote}>Ver cotação</button>
        </div>
      </section>
    );
  }
  const d = p.ex.data;
  const { payload, missing } = quoteFromExtraction(p.ex, { ...p.contact, detectedAt: p.detectedAt, origin: 'whatsapp' });
  const supplier = p.ex.supplier_match.supplier?.name ?? d.fornecedor_nome ?? p.contact.contactName ?? p.contact.contactPhone;
  const total = payload?.items.reduce((a, i) => a + i.quantity * i.unit_price, 0) ?? null;
  const cond = [
    d.prazo_entrega_dias != null ? (d.prazo_entrega_dias === 0 ? 'pronta entrega' : `prazo ${d.prazo_entrega_dias} dias`) : d.prazo_entrega_data ? `entrega ${isoToBr(d.prazo_entrega_data)}` : null,
    d.condicao_pagamento ? `pagamento ${d.condicao_pagamento}` : null,
    d.frete_tipo ? `frete ${d.frete_tipo}` : null,
  ].filter(Boolean);
  return (
    <section className="card card-ai card-enter" style={{ gap: 10 }} aria-label={`Cotação de ${supplier}`}>
      <div className="stack" style={{ gap: 2 }}>
        <span className="small ai-ink">Cotação lida {SOURCE_LABEL[p.source]}{p.fileName ? ` "${p.fileName}"` : ''}</span>
        <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{supplier}</strong>
      </div>
      <div className="stack" style={{ gap: 4, color: 'var(--ink)' }}>
        {d.itens.map((i, idx) => (
          <div key={idx} className="row-between small" style={{ alignItems: 'flex-start' }}>
            <span style={{ minWidth: 0 }}>
              {i.quantidade != null ? `${formatDecimal(i.quantidade)} ${i.unidade ?? ''} × ` : ''}
              {i.descricao || 'Produto não identificado'}
            </span>
            <span className="mono" style={{ whiteSpace: 'nowrap' }}>{i.valor_unitario != null ? formatMoney(i.valor_unitario, d.moeda ?? undefined) : '—'}</span>
          </div>
        ))}
        {total != null && (
          <div className="row-between small" style={{ borderTop: '1px solid var(--ai-line)', paddingTop: 4 }}>
            <strong>Total</strong>
            <strong className="mono">{formatMoney(total, d.moeda ?? undefined)}</strong>
          </div>
        )}
        {!!cond.length && <span className="small muted">{cond.join(' · ')}</span>}
        {d.campos_ambiguos.slice(0, 2).map((a) => (
          <span key={a.campo} className="small" style={{ color: 'var(--warn-ink)' }}>• {a.motivo}</span>
        ))}
        {!!missing.length && <span className="small" style={{ color: 'var(--warn-ink)' }}>Faltou: {missing.join(', ')}. Use Revisar para completar.</span>}
        {p.status === 'error' && <span className="small" style={{ color: 'var(--danger-ink)' }}>{p.error}</span>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {p.status === 'saving' ? (
          <Spinner label="Salvando…" />
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onIgnore}>Ignorar</button>
            <button type="button" className="btn btn-outline" onClick={onReview}>Revisar</button>
            <button type="button" className="btn btn-primary" disabled={!payload} onClick={onSave}>Salvar cotação</button>
          </>
        )}
      </div>
    </section>
  );
}
