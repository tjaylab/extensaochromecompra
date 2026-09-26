import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { blobToDataUrl, DRAG_FILE_TYPE, newCaptureId, splitDataUrl, type AttachFileRequest, type DragFileRequest } from '../lib/capture';
import { sendToWhatsApp } from '../lib/whatsapp-tab';
import { ErrorBanner, Icon, Spinner } from './ui';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function asAttachment(file: File): Promise<Omit<AttachFileRequest, 'type'>> {
  const parts = splitDataUrl(await blobToDataUrl(file));
  if (!parts) throw new Error('Não foi possível ler o PDF.');
  return { name: file.name, mediaType: file.type || 'application/pdf', data: parts.data };
}

// Dragging a file out of the panel: the browser does not hand files made by a page to another site, so the drag
// carries only a token. The WhatsApp content script recognizes it on drop and asks this panel for the file,
// then drops a real file into the conversation (same as "Anexar na conversa").
const dragFiles = new Map<string, File>();
let dragListener = false;
function serveDraggedFiles() {
  if (dragListener) return;
  dragListener = true;
  chrome.runtime.onMessage.addListener((msg: DragFileRequest, _sender, sendResponse) => {
    if (msg?.type !== 'get-drag-file') return;
    const file = dragFiles.get(msg.token);
    if (!file) return; // another panel window owns it
    asAttachment(file).then(sendResponse, () => sendResponse(null));
    return true;
  });
}

/** A generated PDF (order, comparison): preview, drag into the chat, attach to the open conversation, download. */
export function PdfCard({ title, load, deps, children }: { title: string; load: () => Promise<File>; deps: unknown[]; children?: (file: File) => ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setFile(null);
    setError(null);
    load()
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
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragStart = (e: DragEvent) => {
    if (!file || !url) return;
    serveDraggedFiles();
    const token = newCaptureId();
    dragFiles.set(token, file);
    setTimeout(() => dragFiles.delete(token), 5 * 60_000);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(DRAG_FILE_TYPE, token);
    e.dataTransfer.setData('text/plain', file.name);
    // Dropping on the desktop or a folder saves the file.
    e.dataTransfer.setData('DownloadURL', `${file.type || 'application/pdf'}:${file.name}:${url}`);
  };

  const attach = async () => {
    if (!file) return;
    setAttaching(true);
    setError(null);
    setNote(null);
    try {
      const req: AttachFileRequest = { type: 'attach-file', ...(await asAttachment(file)) };
      const r = await sendToWhatsApp<{ ok: boolean }>(req);
      if (!r?.ok) throw new Error('Não consegui anexar. Abra a conversa do fornecedor no WhatsApp Web e tente de novo.');
      setNote('PDF anexado na conversa. Confira e envie pelo WhatsApp.');
    } catch (e) {
      setError(message(e));
    } finally {
      setAttaching(false);
    }
  };

  return (
    <section className="card" aria-label={title}>
      <span className="section-label">{title}</span>
      {!file && !error && <Spinner label="Gerando PDF…" />}
      {file && url && (
        <>
          <div className="file-tile" draggable onDragStart={onDragStart} title="Arraste para a conversa do WhatsApp">
            <Icon name="file" size={24} />
            <span className="stack" style={{ gap: 0, minWidth: 0, flex: 1 }}>
              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</strong>
              <span className="small muted">{Math.max(1, Math.round(file.size / 1024))} KB · arraste para a conversa</span>
            </span>
            <button type="button" className="btn-link small" onClick={() => setPreview((p) => !p)} aria-expanded={preview}>
              {preview ? 'Fechar' : 'Visualizar'}
            </button>
          </div>
          {preview && <iframe className="pdf-view" src={url} title={`Visualização: ${file.name}`} />}
        </>
      )}
      {error && <ErrorBanner message={error} />}
      {note && <span className="small" style={{ color: 'var(--success-ink)' }}>{note}</span>}
      {file && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={attach} disabled={attaching}>
            <Icon name="plus" size={16} /> {attaching ? 'Anexando…' : 'Anexar na conversa'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadFile(file)}>
            <Icon name="download" size={16} /> Baixar
          </button>
        </div>
      )}
      {file && children?.(file)}
    </section>
  );
}
