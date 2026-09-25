import { useEffect, useState } from 'react';
import { formatMoney, type ExtractionResponse } from '@compras/shared';
import { api } from '../lib/api';
import { AUTO_READ_KEY, newCaptureId, SUGGESTION_KEY, type Suggestion } from '../lib/capture';
import { captureOpenConversation } from '../lib/whatsapp-tab';
import { Icon, Spinner, useNav } from './ui';

const MAX_AGE_MS = 30 * 60_000;

type Phase = { name: 'idle' } | { name: 'reading' } | { name: 'found'; ex: ExtractionResponse } | { name: 'none' } | { name: 'error'; message: string };

async function autoReadEnabled() {
  const r = await chrome.storage.local.get(AUTO_READ_KEY);
  return r[AUTO_READ_KEY] !== false;
}

function total(ex: ExtractionResponse) {
  return ex.data.itens.reduce((a, i) => a + (i.valor_total ?? (i.quantidade ?? 0) * (i.valor_unitario ?? 0)), 0);
}

/**
 * "Nova proposta do Carlos, registrar?": shown when a priced message, an image or a PDF arrives in the open
 * conversation. Images and PDFs from recognized suppliers are read automatically (setting in Configurações).
 */
export function SuggestionBanner() {
  const nav = useNav();
  const [s, setS] = useState<Suggestion | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });

  useEffect(() => {
    const apply = (v: Suggestion | undefined) => setS(v && Date.now() - v.at < MAX_AGE_MS ? v : null);
    chrome.storage.session.get(SUGGESTION_KEY).then((r) => apply(r[SUGGESTION_KEY] as Suggestion | undefined));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && SUGGESTION_KEY in changes) apply(changes[SUGGESTION_KEY]!.newValue as Suggestion | undefined);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const read = async (sg: Suggestion) => {
    if (!sg.attachment) return;
    setPhase({ name: 'reading' });
    try {
      const ex = await api.extract({
        text: '',
        conversation: sg.conversation,
        attachments: [sg.attachment],
        contact_name: sg.contact.contactName,
        contact_phone: sg.contact.contactPhone,
      });
      setPhase(ex.data.itens.length ? { name: 'found', ex } : { name: 'none' });
    } catch (e) {
      setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  // New image or PDF: read it right away when the setting is on and the conversation is a known supplier.
  useEffect(() => {
    setPhase({ name: 'idle' });
    if (!s || (s.kind !== 'image' && s.kind !== 'pdf') || !s.attachment) return;
    let alive = true;
    (async () => {
      if (!(await autoReadEnabled())) return;
      const ctx = await api.supplierContext(s.contact.contactName, s.contact.contactPhone).catch(() => null);
      if (alive && (ctx?.supplier || ctx?.omie_supplier)) read(s);
    })();
    return () => {
      alive = false;
    };
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    setS(null);
    chrome.storage.session.remove(SUGGESTION_KEY).catch(() => {});
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  };

  if (!s) return null;
  const who = s.contact.contactName ?? s.contact.contactPhone ?? 'o fornecedor';
  const media = s.kind === 'pdf' ? `o PDF "${s.text}"` : 'a imagem';
  const inMedia = s.kind === 'pdf' ? `no PDF "${s.text}"` : 'na imagem';

  const registerText = async () => {
    try {
      const capture = await captureOpenConversation();
      dismiss();
      nav.go({ name: 'review', capture: { ...capture, origin: 'whatsapp' } });
    } catch (e) {
      setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const review = (ex: ExtractionResponse | null) => {
    dismiss();
    nav.go({
      name: 'review',
      capture: {
        id: newCaptureId(),
        mode: 'file',
        text: '',
        attachments: s.attachment ? [s.attachment] : [],
        conversation: s.conversation ?? null,
        contactName: s.contact.contactName,
        contactPhone: s.contact.contactPhone,
        capturedAt: Date.now(),
        extraction: ex,
        origin: 'whatsapp',
      },
    });
  };

  let body: React.ReactNode;
  let actions: React.ReactNode = null;
  if (s.kind === 'text') {
    body = (
      <>
        <strong>Nova proposta de {who}</strong>
        <span className="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>“{s.text}”</span>
      </>
    );
    actions = <button type="button" className="btn btn-primary" onClick={registerText}>Registrar</button>;
  } else if (s.kind === 'pdf-hint') {
    body = (
      <>
        <strong>{who} enviou o PDF "{s.text}"</strong>
        <span className="small">Clique para baixar o PDF no WhatsApp e eu leio a cotação na hora.</span>
      </>
    );
  } else if (!s.attachment) {
    body = <strong>{s.kind === 'pdf' ? `O PDF "${s.text}" é grande demais para ler automaticamente.` : 'Não consegui ler a imagem.'}</strong>;
  } else if (phase.name === 'reading') {
    body = <Spinner label={`Lendo ${media} de ${who}…`} />;
  } else if (phase.name === 'found') {
    const n = phase.ex.data.itens.length;
    body = (
      <>
        <strong>Cotação encontrada {inMedia} de {who}</strong>
        <span className="small">
          {n} {n === 1 ? 'item' : 'itens'}
          {total(phase.ex) ? ` · ${formatMoney(total(phase.ex), phase.ex.data.moeda ?? 'BRL')}` : ''}
        </span>
      </>
    );
    actions = <button type="button" className="btn btn-primary" onClick={() => review(phase.ex)}>Revisar e salvar</button>;
  } else if (phase.name === 'none') {
    body = <strong>{s.kind === 'pdf' ? `O PDF "${s.text}"` : `A imagem de ${who}`} não parece uma cotação.</strong>;
    actions = <button type="button" className="btn btn-secondary" onClick={() => review(null)}>Preencher mesmo assim</button>;
  } else if (phase.name === 'error') {
    body = <strong>{phase.message}</strong>;
  } else {
    body = <strong>{s.kind === 'pdf' ? `PDF "${s.text}" de ${who}` : `Imagem recebida de ${who}`}</strong>;
    actions = <button type="button" className="btn btn-primary" onClick={() => read(s)}>Ler cotação</button>;
  }

  return (
    <section className="card" role="status" aria-live="polite" style={{ background: 'var(--accent-soft)', borderColor: '#B9D3C8', gap: 8 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: 'var(--accent-ink)', marginTop: 2 }}>
          <Icon name={s.kind === 'text' ? 'plus' : 'check'} />
        </span>
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0, color: 'var(--accent-ink)' }}>{body}</div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={dismiss}>Dispensar</button>
        {actions}
      </div>
    </section>
  );
}
