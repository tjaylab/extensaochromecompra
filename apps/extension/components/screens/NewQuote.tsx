import { useRef, useState, type DragEvent } from 'react';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, type Attachment } from '@compras/shared';
import { blobToDataUrl, newCaptureId, splitDataUrl } from '../../lib/capture';
import { ErrorBanner, Field, Icon, Screen, useNav } from '../ui';

const ACCEPT = ATTACHMENT_TYPES.join(',');
const MAX_FILES = 3;

async function toAttachment(file: File): Promise<Attachment> {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new Error(`${file.name}: use PDF, JPG, PNG ou WEBP`);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name}: arquivo maior que 8 MB`);
  const parts = splitDataUrl(await blobToDataUrl(file));
  if (!parts) throw new Error(`${file.name}: não foi possível ler o arquivo`);
  return { name: file.name, media_type: file.type as Attachment['media_type'], data: parts.data };
}

/** Alternative to the WhatsApp flow: paste a proposal and/or attach the PDF or image received. */
export function NewQuote() {
  const nav = useNav();
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const startedAt = useRef(Date.now());

  const add = async (list: FileList | null) => {
    setError(null);
    if (!list?.length) return;
    try {
      const incoming = await Promise.all([...list].map(toAttachment));
      setFiles((f) => {
        const next = [...f, ...incoming];
        if (next.length > MAX_FILES) setError(`No máximo ${MAX_FILES} arquivos por cotação`);
        return next.slice(0, MAX_FILES);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  const interpret = () =>
    nav.replace({
      name: 'review',
      capture: {
        id: newCaptureId(),
        mode: files.length ? 'file' : 'selection',
        text: text.trim(),
        attachments: files,
        conversation: null,
        contactName: contact.trim() || null,
        contactPhone: null,
        capturedAt: startedAt.current,
        origin: 'manual',
      },
    });

  return (
    <Screen
      title="Nova cotação"
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={!text.trim() && !files.length} onClick={interpret}>
          Interpretar
        </button>
      }
    >
      {error && <ErrorBanner message={error} />}
      <div
        className="card"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{ borderStyle: 'dashed', borderWidth: 2, alignItems: 'center', textAlign: 'center', padding: 20, background: dragging ? 'var(--accent-soft)' : undefined }}
      >
        <strong>Arraste o PDF ou a imagem da proposta aqui</strong>
        <span className="small muted">Orçamento, tabela de preços, foto ou print. Até {MAX_FILES} arquivos de 8 MB.</span>
        <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()}>
          Escolher arquivo
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
      {!!files.length && (
        <div className="stack">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="row-between card" style={{ padding: '10px 12px' }}>
              <span className="row" style={{ minWidth: 0 }}>
                <span className="badge badge-info">{f.media_type === 'application/pdf' ? 'PDF' : 'Imagem'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              </span>
              <button type="button" className="icon-btn" aria-label={`Remover ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <Field id="paste" label="Texto da proposta (opcional com anexo)" hint="Cole a mensagem do fornecedor exatamente como recebida.">
        <textarea id="paste" className="textarea" style={{ minHeight: 100 }} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      </Field>
      <Field id="contact" label="Fornecedor ou contato (opcional)">
        <input id="contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
      </Field>
    </Screen>
  );
}
