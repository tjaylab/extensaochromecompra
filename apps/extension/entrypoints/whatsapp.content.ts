import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  blobToDataUrl,
  CONTACT_PHONES_KEY,
  PDF_MESSAGE,
  splitDataUrl,
  type AttachFileRequest,
  type CaptureMessage,
  type ContactChangedMessage,
  type ContactRequest,
  type ContactResponse,
  type ConversationRequest,
  type ConversationResponse,
  type ImageRequest,
  type ImageResponse,
  type RowMediaRequest,
  type RowMediaResponse,
  type RowsLoadedMessage,
  type RowsRequest,
  type SuggestionMessage,
} from '../lib/capture';
import { RowReporter } from '../lib/row-reporter';
import {
  documentTarget,
  HISTORY_LIMITS,
  isInConversation,
  loadHistory,
  readContact as readContactFromPage,
  readConversation,
  readDrawerPhone,
  readMessageRows,
  rowById,
  type MessageRow,
} from '../lib/whatsapp-dom';

// Reads the open conversation for ProcureMate: the messages on screen as they appear (opening the chat,
// scrolling up, new arrivals), the contact's phone when the buyer opens the contact info, and received images
// and PDFs on request. Never other chats.

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  runAt: 'document_idle',
  main() {
    // ---------------------------------------------------------------------
    // Contact: name from the header, phone from the page or learned from the contact info panel
    // ---------------------------------------------------------------------
    let learnedPhones: Record<string, string> = {};
    chrome.storage.local.get(CONTACT_PHONES_KEY).then((r) => (learnedPhones = (r[CONTACT_PHONES_KEY] as Record<string, string>) ?? {}));
    const readContact = (): ContactResponse => {
      const c = readContactFromPage();
      return c.contactPhone || !c.contactName ? c : { ...c, contactPhone: learnedPhones[c.contactName] ?? null };
    };
    const learnPhone = () => {
      const c = readContactFromPage();
      if (!c.contactName || c.contactPhone) return;
      const phone = readDrawerPhone();
      if (!phone || learnedPhones[c.contactName] === phone) return;
      learnedPhones = { ...learnedPhones, [c.contactName]: phone };
      chrome.storage.local.set({ [CONTACT_PHONES_KEY]: learnedPhones }).catch(() => {});
    };

    // ---------------------------------------------------------------------
    // Floating "Registrar cotação" button over selected text
    // ---------------------------------------------------------------------
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        button{display:flex;align-items:center;gap:8px;height:36px;padding:0 14px;border:none;border-radius:999px;
          background:#2563EB;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,.3)}
        button:hover{background:#1D4ED8}
        button:focus-visible{outline:2px solid #1D4ED8;outline-offset:2px}
      </style>
      <button type="button" aria-label="Registrar cotação com o texto selecionado">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg>
        Registrar cotação
      </button>`;
    document.documentElement.appendChild(host);
    const button = shadow.querySelector('button')!;

    let selectedText = '';
    const hide = () => {
      host.style.display = 'none';
      selectedText = '';
    };
    const update = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || !text || sel.rangeCount === 0 || !isInConversation(sel.anchorNode) || !isInConversation(sel.focusNode)) return hide();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return hide();
      selectedText = text;
      const top = Math.min(window.innerHeight - 48, rect.bottom + 8);
      const left = Math.max(8, Math.min(window.innerWidth - 200, rect.left));
      host.style.transform = `translate(${left}px, ${top}px)`;
      host.style.display = 'block';
    };
    document.addEventListener('mouseup', () => setTimeout(update, 0));
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Escape') hide();
      else if (e.shiftKey) setTimeout(update, 0);
    });
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', (e) => {
      if (e.composedPath().includes(host)) e.preventDefault(); // keep the selection
      else hide();
    });
    button.addEventListener('click', () => {
      if (!selectedText) return;
      // The recent messages go along as context: the selection may miss the quantity or a later correction.
      const msg: CaptureMessage = {
        type: 'capture',
        capture: { mode: 'selection', text: selectedText, conversation: readConversation(), capturedAt: Date.now(), ...readContact() },
      };
      chrome.runtime.sendMessage(msg).catch(() => {});
      hide();
      window.getSelection()?.removeAllRanges();
    });

    // ---------------------------------------------------------------------
    // Requests from the app and the service worker
    // ---------------------------------------------------------------------
    chrome.runtime.onMessage.addListener(
      (
        msg: ContactRequest | ConversationRequest | ImageRequest | RowMediaRequest | AttachFileRequest | RowsRequest,
        _sender,
        sendResponse: (r: ContactResponse | ConversationResponse | ImageResponse | RowMediaResponse | RowsLoadedMessage | { ok: boolean }) => void,
      ) => {
        if (msg?.type === 'get-contact') sendResponse(readContact());
        // The app opened (or switched chats) after the rows were reported: it asks for what is on screen now.
        if (msg?.type === 'get-rows') sendResponse(rowsMessage('initial', readMessageRows()));
        if (msg?.type === 'get-conversation') {
          if (!msg.hours) {
            sendResponse({ ...readContact(), conversation: readConversation() });
            return;
          }
          const since = Date.now() - msg.hours * 3600_000;
          (msg.scroll === false ? Promise.resolve(false) : loadHistory(since))
            .catch(() => false)
            .then(() => sendResponse({ ...readContact(), conversation: readConversation(undefined, HISTORY_LIMITS, since) }));
          return true;
        }
        if (msg?.type === 'get-image') {
          // Right-click > "Registrar cotação desta imagem": the image is a blob: URL only this page can read.
          readImage(msg.src).then(
            (image) => sendResponse({ ...readContact(), conversation: readConversation(), image }),
            (err) => sendResponse({ ...readContact(), conversation: readConversation(), image: null, error: String(err?.message ?? err) }),
          );
          return true;
        }
        if (msg?.type === 'get-row-image') {
          const img = rowImage(msg.id);
          if (!img) {
            sendResponse({ attachment: null, error: 'Imagem não encontrada na conversa' });
            return;
          }
          imageData(img).then(
            (attachment) => sendResponse({ attachment }),
            (err) => sendResponse({ attachment: null, error: String(err?.message ?? err) }),
          );
          return true;
        }
        if (msg?.type === 'read-row-pdf') {
          readRowPdf(msg.id).then(
            (attachment) => sendResponse({ attachment }),
            (err) => sendResponse({ attachment: null, error: String(err?.message ?? err) }),
          );
          return true;
        }
        if (msg?.type === 'attach-file') {
          sendResponse({ ok: dropFile(msg) });
        }
      },
    );

    // ---------------------------------------------------------------------
    // Messages on screen -> the app (it decides what to read)
    // ---------------------------------------------------------------------
    let lastContact = '';
    const announce = () => {
      const contact = readContact();
      const key = `${contact.contactName ?? ''}|${contact.contactPhone ?? ''}`;
      if (key === lastContact) return;
      lastContact = key;
      const msg: ContactChangedMessage = { type: 'contact-changed', contact };
      chrome.runtime.sendMessage(msg).catch(() => {});
    };

    const reporter = new RowReporter();
    const toMessage = (r: MessageRow) => ({ id: r.id, direction: r.direction, author: r.author ?? null, time: r.time ?? null, text: r.text.slice(0, 3000) });
    function rowsMessage(position: RowsLoadedMessage['position'], rows: MessageRow[]): RowsLoadedMessage {
      return {
        type: 'rows-loaded',
        contact: readContact(),
        position,
        messages: rows.filter((r) => r.text && !r.image && !r.pdfName).map(toMessage),
        media: rows
          .filter((r) => r.image || r.pdfName)
          .map((r) => ({ id: r.id, kind: r.pdfName ? ('pdf' as const) : ('image' as const), name: r.pdfName, direction: r.direction, caption: r.text })),
      };
    }
    const report = () => {
      const chat = readContactFromPage().contactName ?? readContact().contactPhone ?? '';
      if (!chat) return;
      for (const batch of reporter.scan(chat, readMessageRows())) {
        const msg = rowsMessage(batch.position, batch.rows);
        if (msg.messages.length || msg.media.length) chrome.runtime.sendMessage(msg).catch(() => {});
      }
    };

    // PDFs the buyer downloads (or the app asks to read): handed over by the page-context script.
    const suggest = (s: SuggestionMessage['suggestion']) => chrome.runtime.sendMessage({ type: 'suggestion', suggestion: s } satisfies SuggestionMessage).catch(() => {});
    let pendingPdf: ((a: RowMediaResponse['attachment']) => void) | null = null;
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.origin !== window.location.origin || e.data?.source !== PDF_MESSAGE) return;
      const data = String(e.data.data ?? '');
      if (!data || Math.floor((data.length * 3) / 4) > 8 * 1024 * 1024) return;
      const name = String(e.data.name ?? 'documento.pdf').slice(0, 200);
      const attachment = { name, media_type: 'application/pdf' as const, data };
      if (pendingPdf) {
        pendingPdf(attachment); // requested by the app: no suggestion, it reads it directly
        pendingPdf = null;
        return;
      }
      suggest({ kind: 'pdf', contact: readContact(), text: name, attachment, conversation: readConversation() });
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        learnPhone();
        announce();
        report();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });
    announce();
    report();

    // ---------------------------------------------------------------------
    // Media helpers
    // ---------------------------------------------------------------------
    function rowImage(id: string): HTMLImageElement | null {
      const imgs = [...(rowById(id)?.querySelectorAll<HTMLImageElement>('img[src^="blob:"]') ?? [])];
      return imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0] ?? null;
    }

    /**
     * Makes WhatsApp download the document (click on the bubble) with the page-context script armed to keep the
     * file and skip the save to disk.
     */
    function readRowPdf(id: string): Promise<RowMediaResponse['attachment']> {
      const row = rowById(id);
      const target = row && documentTarget(row);
      if (!target) return Promise.reject(new Error('Documento não encontrado na conversa'));
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          pendingPdf = null;
          reject(new Error('O WhatsApp não entregou o PDF. Clique para baixar e eu leio.'));
        }, 20_000);
        pendingPdf = (a) => {
          clearTimeout(t);
          resolve(a);
        };
        window.postMessage({ source: `${PDF_MESSAGE}arm`, suppressSave: true }, window.location.origin);
        target.click();
      });
    }

    /** The image as shown in the bubble: read the blob, or draw it when the blob cannot be fetched. */
    async function imageData(img: HTMLImageElement) {
      try {
        return await readImage(img.src);
      } catch {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        const parts = splitDataUrl(canvas.toDataURL('image/jpeg', 0.92))!;
        return { name: 'imagem-whatsapp', media_type: 'image/jpeg' as const, data: parts.data };
      }
    }

    async function readImage(src: string) {
      // In the chat bubble WhatsApp shows a reduced image; opening it first gives the full resolution.
      const res = await fetch(src);
      const blob = await res.blob();
      if (blob.size > 8 * 1024 * 1024) throw new Error('Imagem maior que 8 MB');
      const parts = splitDataUrl(await blobToDataUrl(blob));
      if (!parts || !parts.media_type.startsWith('image/')) throw new Error('Não foi possível ler a imagem');
      const media_type = (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(parts.media_type) ? parts.media_type : 'image/jpeg') as
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'image/gif';
      return { name: 'imagem-whatsapp', media_type, data: parts.data };
    }

    /**
     * Drops a file into the open conversation, as if dragged from the desktop: WhatsApp opens its send preview
     * and the buyer presses send. Returns false when there is no conversation to drop into.
     */
    function dropFile(f: AttachFileRequest): boolean {
      const target = document.querySelector('#main footer') ?? document.querySelector('#main');
      if (!target) return false;
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], f.name, { type: f.mediaType }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
      return true;
    }
  },
});
