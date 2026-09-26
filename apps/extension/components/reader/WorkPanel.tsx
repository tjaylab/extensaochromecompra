import { useRef, useState, type DragEvent } from 'react';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, type Attachment } from '@compras/shared';
import { blobToDataUrl, splitDataUrl } from '../../lib/capture';
import { ProposalCard } from '../ProposalCard';
import { ErrorBanner, Icon } from '../ui';
import { useReader, type Activity } from './ReaderProvider';

/** Work: the live reading of the open conversation, the quotes found, and a drop zone for files. */
export function WorkPanel() {
  const r = useReader();
  const c = r.current;
  const who = c ? (c.contact.contactName ?? c.contact.contactPhone) : null;
  const visible = c?.proposals ?? [];

  return (
    <div className="stack" style={{ gap: 14 }}>
      {who ? (
        <div className="row-between">
          <strong style={{ fontSize: 15 }}>{who}</strong>
          <span className="live-pill">
            <span className={`live-dot ${c!.busy ? 'busy' : ''}`} />
            {c!.busy ? 'Analisando' : 'Lendo a conversa'}
          </span>
        </div>
      ) : (
        <div className="card small muted">
          Abra uma conversa no WhatsApp Web. Conforme as mensagens aparecem, inclusive ao rolar para cima, eu leio e encontro as cotações sozinho.
        </div>
      )}

      {visible.map((p) => (
        <ProposalCard
          key={p.key}
          p={p}
          onSave={() => r.save(p.key)}
          onReview={() => r.review(p.key)}
          onIgnore={() => r.ignore(p.key)}
          onOpenQuote={() => r.openQuote(p.key)}
        />
      ))}

      {!!c?.activities.length && (
        <section className="feed" aria-label="Atividade" aria-live="polite">
          {c.activities.map((a) => (
            <FeedItem key={a.id} a={a} />
          ))}
        </section>
      )}

      <AttachDrop onFiles={r.addFiles} />
    </div>
  );
}

function FeedItem({ a }: { a: Activity }) {
  const icon =
    a.kind === 'found' ? <Icon name="check" size={14} /> : a.kind === 'error' ? <Icon name="warn" size={14} /> : !a.done ? <Icon name="spinner" size={14} className="spin" /> : null;
  return (
    <div className={`feed-item feed-${a.kind}`}>
      <div className="feed-line">
        <span className="feed-icon">{icon}</span>
        <span>{a.text}</span>
      </div>
      {!!a.snippets?.length && (
        <div className="feed-bubbles">
          {a.snippets.map((s, i) => (
            <span key={i} className={`feed-bubble ${s.direction}`} style={{ animationDelay: `${i * 120}ms` }}>
              {s.text}
            </span>
          ))}
        </div>
      )}
      {!!a.kind && a.kind === 'analyze' && !a.done && (
        <div className="typing" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {a.action && (
        <button type="button" className="btn-link small" style={{ alignSelf: 'flex-start' }} onClick={a.action.run}>
          {a.action.label}
        </button>
      )}
    </div>
  );
}

const ACCEPT = ATTACHMENT_TYPES.join(',');

async function toAttachment(file: File): Promise<Attachment> {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new Error(`${file.name}: use PDF, JPG, PNG ou WEBP`);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name}: arquivo maior que 8 MB`);
  const parts = splitDataUrl(await blobToDataUrl(file));
  if (!parts) throw new Error(`${file.name}: não foi possível ler o arquivo`);
  return { name: file.name, media_type: file.type as Attachment['media_type'], data: parts.data };
}

/** The square to drop (or choose) a PDF or image received outside the open conversation. */
export function AttachDrop({ onFiles }: { onFiles: (files: Attachment[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (list: FileList | null) => {
    setError(null);
    if (!list?.length) return;
    try {
      onFiles(await Promise.all([...list].slice(0, 3).map(toAttachment)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="stack">
      {error && <ErrorBanner message={error} />}
      <button
        type="button"
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
      >
        <Icon name="plus" />
        <span>
          <strong>Arraste um PDF ou imagem</strong>
          <span className="small muted" style={{ display: 'block' }}>ou clique para escolher · até 3 arquivos de 8 MB</span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
