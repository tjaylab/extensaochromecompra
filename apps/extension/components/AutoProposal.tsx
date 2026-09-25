import { useEffect, useRef, useState } from 'react';
import { formatDecimal, formatMoney, isoToBr, type Attachment, type ConversationMessage, type ExtractionResponse, type QuoteDTO } from '@compras/shared';
import { api } from '../lib/api';
import { hasPricedMessage, markProcessed, proposalKey, quoteFromExtraction, wasProcessed } from '../lib/auto-quote';
import { AUTO_READ_KEY, newCaptureId, requestAttention, SUGGESTION_KEY, type ContactResponse, type Suggestion } from '../lib/capture';
import { captureOpenConversation } from '../lib/whatsapp-tab';
import { useActiveContact } from './SupplierPanel';
import { Icon, Spinner, useNav } from './ui';

const MAX_AGE_MS = 30 * 60_000;

/** What is being read or was read automatically. */
interface Source {
  kind: 'conversation' | 'image' | 'pdf';
  contact: ContactResponse;
  conversation: ConversationMessage[] | null;
  attachment: Attachment | null;
  fileName: string | null;
  detectedAt: number;
  key: string | null;
}

type Phase =
  | { name: 'idle' }
  | { name: 'reading'; src: Source }
  | { name: 'ready'; src: Source; ex: ExtractionResponse }
  | { name: 'saved'; src: Source; quote: QuoteDTO }
  | { name: 'offer'; src: Source } // not a recognized supplier or auto-read off: one click to read
  | { name: 'error'; src: Source | null; message: string };

async function autoReadEnabled() {
  const r = await chrome.storage.local.get(AUTO_READ_KEY);
  return r[AUTO_READ_KEY] !== false;
}

async function isKnownSupplier(c: ContactResponse) {
  const ctx = await api.supplierContext(c.contactName, c.contactPhone).catch(() => null);
  return !!(ctx?.supplier || ctx?.omie_supplier);
}

/**
 * Reads proposals without the buyer asking: when a supplier's conversation opens, when a priced message
 * arrives, and when an image or a downloaded PDF comes in. Shows the quote ready to save in one click.
 */
export function AutoProposal() {
  const nav = useNav();
  const contact = useActiveContact();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const busy = useRef(false);

  const read = async (src: Source) => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ name: 'reading', src });
    try {
      const ex = await api.extract({
        text: '',
        conversation: src.conversation,
        attachments: src.attachment ? [src.attachment] : null,
        contact_name: src.contact.contactName,
        contact_phone: src.contact.contactPhone,
      });
      if (src.key) await markProcessed(src.key);
      // Nothing that looks like a quote: stay quiet for conversations, say so for files.
      if (!ex.data.itens.length) setPhase(src.kind === 'conversation' ? { name: 'idle' } : { name: 'error', src, message: `${src.kind === 'pdf' ? `O PDF "${src.fileName}"` : 'A imagem'} não parece uma cotação.` });
      else {
        setPhase({ name: 'ready', src, ex });
        const who = src.contact.contactName ?? src.contact.contactPhone ?? 'fornecedor';
        requestAttention(`Proposta de ${who} pronta para salvar`);
      }
    } catch (e) {
      setPhase({ name: 'error', src, message: e instanceof Error ? e.message : String(e) });
    } finally {
      busy.current = false;
    }
  };

  /** Reads the open conversation if it has a priced supplier message not read yet. */
  const checkConversation = async (c: ContactResponse, detectedAt: number, force = false) => {
    let capture;
    try {
      capture = await captureOpenConversation({ scroll: false });
    } catch {
      return;
    }
    if (!hasPricedMessage(capture.conversation)) return;
    const key = proposalKey(c, capture.conversation);
    if (!force && key && (await wasProcessed(key))) return;
    const src: Source = { kind: 'conversation', contact: c, conversation: capture.conversation, attachment: null, fileName: null, detectedAt, key };
    if (!force && !((await autoReadEnabled()) && (await isKnownSupplier(c)))) {
      requestAttention(`Possível proposta de ${c.contactName ?? c.contactPhone ?? 'fornecedor'}`);
      return setPhase({ name: 'offer', src });
    }
    read(src);
  };

  // 1. A supplier's conversation was opened.
  useEffect(() => {
    if (!contact) return setPhase({ name: 'idle' });
    setPhase({ name: 'idle' });
    const t = setTimeout(() => checkConversation(contact, Date.now()), 800); // let WhatsApp render the messages
    return () => clearTimeout(t);
  }, [contact?.contactName, contact?.contactPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Something new arrived in the open conversation (priced message, image, downloaded PDF).
  useEffect(() => {
    const handle = async (s: Suggestion | undefined) => {
      if (!s || Date.now() - s.at > MAX_AGE_MS) return;
      chrome.storage.session.remove(SUGGESTION_KEY).catch(() => {});
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
      if (s.kind === 'text') return checkConversation(s.contact, s.at);
      if (s.kind === 'pdf-hint') {
        return setPhase({
          name: 'offer',
          src: { kind: 'pdf', contact: s.contact, conversation: null, attachment: null, fileName: s.text, detectedAt: s.at, key: null },
        });
      }
      const src: Source = {
        kind: s.kind,
        contact: s.contact,
        conversation: s.conversation ?? null,
        attachment: s.attachment ?? null,
        fileName: s.kind === 'pdf' ? s.text : null,
        detectedAt: s.at,
        key: null,
      };
      if (!src.attachment) return setPhase({ name: 'error', src, message: `${s.kind === 'pdf' ? `O PDF "${s.text}"` : 'A imagem'} não pôde ser lido(a) automaticamente.` });
      if ((await autoReadEnabled()) && (await isKnownSupplier(s.contact))) read(src);
      else setPhase({ name: 'offer', src });
    };
    chrome.storage.session.get(SUGGESTION_KEY).then((r) => handle(r[SUGGESTION_KEY] as Suggestion | undefined));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[SUGGESTION_KEY]?.newValue) handle(changes[SUGGESTION_KEY].newValue as Suggestion);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = async () => {
    if ('src' in phase && phase.src?.key) await markProcessed(phase.src.key);
    setPhase({ name: 'idle' });
  };

  const openReview = (src: Source, ex: ExtractionResponse | null) =>
    nav.go({
      name: 'review',
      capture: {
        id: newCaptureId(),
        mode: src.kind === 'conversation' ? 'conversation' : 'file',
        text: '',
        attachments: src.attachment ? [src.attachment] : [],
        conversation: src.conversation,
        contactName: src.contact.contactName,
        contactPhone: src.contact.contactPhone,
        capturedAt: src.detectedAt,
        extraction: ex,
        origin: 'whatsapp',
      },
    });

  const save = async (src: Source, ex: ExtractionResponse) => {
    const { payload } = quoteFromExtraction(ex, { ...src.contact, detectedAt: src.detectedAt, origin: 'whatsapp' });
    if (!payload) return;
    try {
      setPhase({ name: 'reading', src });
      const quote = await api.createQuote(payload);
      setPhase({ name: 'saved', src, quote });
    } catch (e) {
      setPhase({ name: 'error', src, message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (phase.name === 'idle') return null;
  const src = 'src' in phase ? phase.src : null;
  const who = src?.contact.contactName ?? src?.contact.contactPhone ?? 'o fornecedor';
  const what = src?.kind === 'pdf' ? `o PDF "${src.fileName}"` : src?.kind === 'image' ? 'a imagem' : 'a conversa';

  return (
    <section className="card card-ai" role="status" aria-live="polite" style={{ gap: 10 }}>
      {phase.name === 'reading' && <Spinner label={`Lendo ${what} de ${who}…`} />}

      {phase.name === 'offer' && (
        <>
          <strong style={{ color: 'var(--ai-ink)' }}>
            {phase.src.kind === 'pdf' && !phase.src.attachment
              ? `${who} enviou o PDF "${phase.src.fileName}". Clique para baixar no WhatsApp que eu leio na hora.`
              : `Possível proposta de ${who}`}
          </strong>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={dismiss}>Ignorar</button>
            {(phase.src.kind === 'conversation' || phase.src.attachment) && (
              <button type="button" className="btn btn-primary" onClick={() => read(phase.src)}>Ler proposta</button>
            )}
          </div>
        </>
      )}

      {phase.name === 'ready' && <Ready src={phase.src} ex={phase.ex} onSave={() => save(phase.src, phase.ex)} onReview={() => openReview(phase.src, phase.ex)} onIgnore={dismiss} />}

      {phase.name === 'saved' && (
        <>
          <div className="row" style={{ color: 'var(--success-ink)' }}>
            <Icon name="check" />
            <strong>Cotação {phase.quote.number} salva · {formatMoney(phase.quote.total, phase.quote.currency)}</strong>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPhase({ name: 'idle' })}>Fechar</button>
            <button type="button" className="btn btn-outline" onClick={() => nav.go({ name: 'quote', id: phase.quote.id })}>Ver cotação</button>
          </div>
        </>
      )}

      {phase.name === 'error' && (
        <>
          <strong style={{ color: 'var(--ai-ink)' }}>{phase.message}</strong>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={dismiss}>Fechar</button>
            {phase.src && <button type="button" className="btn btn-outline" onClick={() => openReview(phase.src!, null)}>Preencher manualmente</button>}
          </div>
        </>
      )}
    </section>
  );
}

function Ready({ src, ex, onSave, onReview, onIgnore }: { src: Source; ex: ExtractionResponse; onSave: () => void; onReview: () => void; onIgnore: () => void }) {
  const d = ex.data;
  const { payload, missing } = quoteFromExtraction(ex, { ...src.contact, detectedAt: src.detectedAt, origin: 'whatsapp' });
  const supplier = ex.supplier_match.supplier?.name ?? d.fornecedor_nome ?? src.contact.contactName ?? src.contact.contactPhone;
  const total = payload?.items.reduce((a, i) => a + i.quantity * i.unit_price, 0) ?? null;
  const cond = [
    d.prazo_entrega_dias != null ? (d.prazo_entrega_dias === 0 ? 'pronta entrega' : `prazo ${d.prazo_entrega_dias} dias`) : d.prazo_entrega_data ? `entrega ${isoToBr(d.prazo_entrega_data)}` : null,
    d.condicao_pagamento ? `pagamento ${d.condicao_pagamento}` : null,
    d.frete_tipo ? `frete ${d.frete_tipo}` : null,
  ].filter(Boolean);
  return (
    <>
      <div className="stack" style={{ gap: 2, color: 'var(--ai-ink)' }}>
        <span className="small">Proposta lida automaticamente {src.kind === 'pdf' ? `do PDF "${src.fileName}"` : src.kind === 'image' ? 'da imagem' : 'da conversa'}</span>
        <strong style={{ fontSize: 15 }}>{supplier}</strong>
      </div>
      <div className="stack" style={{ gap: 4 }}>
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
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onIgnore}>Ignorar</button>
        <button type="button" className="btn btn-outline" onClick={onReview}>Revisar</button>
        <button type="button" className="btn btn-primary" disabled={!payload} onClick={onSave}>Salvar cotação</button>
      </div>
    </>
  );
}
