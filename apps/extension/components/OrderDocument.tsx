import { useState } from 'react';
import type { OrderDTO } from '@compras/shared';
import { ApiError, api } from '../lib/api';
import { downloadFile, PdfCard } from './PdfCard';
import { ErrorBanner, Field, Icon } from './ui';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The order PDF: preview, drag into the chat, attach to the open conversation, download or e-mail it. */
export function OrderDocument({ o }: { o: OrderDTO }) {
  return (
    <PdfCard title="PDF do pedido" load={() => api.orderPdf(o.id)} deps={[o.id, o.status]}>
      {(file) => <EmailSection o={o} file={file} />}
    </PdfCard>
  );
}

function EmailSection({ o, file }: { o: OrderDTO; file: File }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  if (!open) {
    return (
      <>
        {sent && <span className="small" style={{ color: 'var(--success-ink)' }}>E-mail enviado para {sent}.</span>}
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
          <Icon name="mail" size={16} /> Enviar por e-mail
        </button>
      </>
    );
  }
  return (
    <EmailForm
      o={o}
      file={file}
      onSent={(to) => {
        setSent(to);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function EmailForm({ o, file, onSent, onCancel }: { o: OrderDTO; file: File; onSent: (to: string) => void; onCancel: () => void }) {
  const [to, setTo] = useState(o.supplier.email ?? '');
  const [text, setText] = useState(`Olá! Segue em anexo o pedido de compra ${o.omie_number ?? o.number}. Qualquer dúvida, é só responder este e-mail.`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.emailOrder(o.id, to.trim(), text.trim() || undefined);
      onSent(r.to);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_not_configured') {
        // No e-mail service on the server yet: open the buyer's mail app and download the PDF to attach.
        downloadFile(file);
        const subject = `Pedido de compra ${o.omie_number ?? o.number}`;
        window.open(`mailto:${to.trim().replace(/[?&#\s]/g, '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`);
        setError('O envio pelo servidor ainda não está configurado. Abri seu e-mail e baixei o PDF para você anexar.');
      } else {
        setError(message(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <Field id="em-to" label="Para">
        <input id="em-to" className="input" type="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@fornecedor.com.br" />
      </Field>
      <Field id="em-text" label="Mensagem">
        <textarea id="em-text" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {error && <ErrorBanner message={error} />}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !to.includes('@')}>
          <Icon name="send" size={16} /> {busy ? 'Enviando…' : 'Enviar com o PDF'}
        </button>
      </div>
    </form>
  );
}
