import { useEffect, useState, type DragEvent } from 'react';
import type { OrderDTO } from '@compras/shared';
import { ApiError, api } from '../lib/api';
import { blobToDataUrl, splitDataUrl, type AttachFileRequest } from '../lib/capture';
import { sendToWhatsApp } from '../lib/whatsapp-tab';
import { ErrorBanner, Field, Icon, Spinner } from './ui';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The order PDF: drag it into the chat, attach it to the open conversation, download it or e-mail it. */
export function OrderDocument({ o }: { o: OrderDTO }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    api
      .orderPdf(o.id)
      .then((f) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(f);
        setFile(f);
        setUrl(objectUrl);
      })
      .catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [o.id, o.status]);

  const onDragStart = (e: DragEvent) => {
    if (!file || !url) return;
    e.dataTransfer.effectAllowed = 'copy';
    try {
      e.dataTransfer.items.add(file);
    } catch {
      // some drop targets only take the DownloadURL below
    }
    e.dataTransfer.setData('DownloadURL', `application/pdf:${file.name}:${url}`);
  };

  const attach = async () => {
    if (!file) return;
    setAttaching(true);
    setError(null);
    setNote(null);
    try {
      const parts = splitDataUrl(await blobToDataUrl(file));
      if (!parts) throw new Error('Não foi possível ler o PDF.');
      const req: AttachFileRequest = { type: 'attach-file', name: file.name, mediaType: 'application/pdf', data: parts.data };
      const r = await sendToWhatsApp<{ ok: boolean }>(req);
      if (!r?.ok) throw new Error('Não consegui anexar. Abra a conversa do fornecedor no WhatsApp Web ou arraste o arquivo.');
      setNote('PDF anexado na conversa. Confira e envie pelo WhatsApp.');
    } catch (e) {
      setError(message(e));
    } finally {
      setAttaching(false);
    }
  };

  return (
    <section className="card" aria-label="PDF do pedido">
      <span className="section-label">PDF do pedido</span>
      {!file && !error && <Spinner label="Gerando PDF…" />}
      {file && (
        <div className="file-tile" draggable onDragStart={onDragStart} title="Arraste para a conversa do WhatsApp">
          <Icon name="file" size={24} />
          <span className="stack" style={{ gap: 0, minWidth: 0 }}>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</strong>
            <span className="small muted">{Math.max(1, Math.round(file.size / 1024))} KB · arraste para a conversa</span>
          </span>
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {note && <span className="small" style={{ color: 'var(--success-ink)' }}>{note}</span>}
      {file && !emailing && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={attach} disabled={attaching}>
            <Icon name="plus" size={16} /> {attaching ? 'Anexando…' : 'Anexar na conversa'}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setEmailing(true)}>
            <Icon name="mail" size={16} /> Enviar por e-mail
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => download(file)}>
            <Icon name="download" size={16} /> Baixar
          </button>
        </div>
      )}
      {file && emailing && (
        <EmailForm
          o={o}
          file={file}
          onSent={(to) => {
            setEmailing(false);
            setNote(`E-mail enviado para ${to}.`);
          }}
          onCancel={() => setEmailing(false)}
        />
      )}
    </section>
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
        download(file);
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
