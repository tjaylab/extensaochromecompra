import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  blobToDataUrl,
  splitDataUrl,
  type CaptureMessage,
  type ContactChangedMessage,
  type ContactRequest,
  type ContactResponse,
  type ConversationRequest,
  type ConversationResponse,
  type ImageRequest,
  type ImageResponse,
  type SuggestionMessage,
  PDF_MESSAGE,
} from '../lib/capture';
import { MessageWatch } from '../lib/message-watch';
import { HISTORY_LIMITS, isInConversation, loadHistory, readContact, readConversation, readMessageRows } from '../lib/whatsapp-dom';

// Shows a floating "Registrar cotação" button next to text selected inside the open conversation.
// Reads only the open conversation (selected text, its recent messages and the contact), and only
// when the buyer clicks; never other chats.

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  runAt: 'document_idle',
  main() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        button{display:flex;align-items:center;gap:8px;height:36px;padding:0 14px;border:none;border-radius:999px;
          background:#1E6B55;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(20,73,58,.3)}
        button:hover{background:#14493A}
        button:focus-visible{outline:2px solid #14493A;outline-offset:2px}
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

    // Used by the right-click menu and the side panel's "Registrar da conversa aberta".
    chrome.runtime.onMessage.addListener(
      (
        msg: ContactRequest | ConversationRequest | ImageRequest,
        _sender,
        sendResponse: (r: ContactResponse | ConversationResponse | ImageResponse) => void,
      ) => {
        if (msg?.type === 'get-contact') sendResponse(readContact());
        if (msg?.type === 'get-conversation') {
          if (!msg.hours) {
            sendResponse({ ...readContact(), conversation: readConversation() });
            return;
          }
          // Load the last N hours (scrolling up if needed), then read them.
          const since = Date.now() - msg.hours * 3600_000;
          // Automatic reads never move the buyer's view: they use what is already loaded.
          (msg.scroll === false ? Promise.resolve(false) : loadHistory(since))
            .catch(() => false)
            .then(() => sendResponse({ ...readContact(), conversation: readConversation(undefined, HISTORY_LIMITS, since) }));
          return true; // async sendResponse
        }
        if (msg?.type === 'get-image') {
          // Right-click > "Registrar cotação desta imagem": the image is a blob: URL only this page can read.
          readImage(msg.src).then(
            (image) => sendResponse({ ...readContact(), conversation: readConversation(), image }),
            (err) => sendResponse({ ...readContact(), conversation: readConversation(), image: null, error: String(err?.message ?? err) }),
          );
          return true; // async sendResponse
        }
      },
    );

    // Tell the side panel when the buyer switches conversations, so it shows that supplier's history.
    let lastContact = '';
    const announce = () => {
      const contact = readContact();
      const key = `${contact.contactName ?? ''}|${contact.contactPhone ?? ''}`;
      if (key === lastContact) return;
      lastContact = key;
      const msg: ContactChangedMessage = { type: 'contact-changed', contact };
      chrome.runtime.sendMessage(msg).catch(() => {});
    };
    // Watch the open conversation for new proposals: priced text, images and PDFs from the supplier.
    const watch = new MessageWatch();
    const suggest = (s: SuggestionMessage['suggestion']) => chrome.runtime.sendMessage({ type: 'suggestion', suggestion: s } satisfies SuggestionMessage).catch(() => {});
    const scanMessages = () => {
      const contact = readContact();
      const chat = `${contact.contactName ?? ''}|${contact.contactPhone ?? ''}`;
      for (const a of watch.scan(chat, readMessageRows())) {
        if (a.kind === 'text') suggest({ kind: 'text', contact, text: a.row.text });
        if (a.kind === 'pdf-hint') suggest({ kind: 'pdf-hint', contact, text: a.row.pdfName ?? 'documento.pdf' });
        if (a.kind === 'image' && a.row.image) {
          const el = a.row.image;
          imageData(el)
            .then((attachment) => suggest({ kind: 'image', contact, text: a.row.text, attachment, conversation: readConversation() }))
            .catch(() => {});
        }
      }
    };

    // PDFs the buyer downloads: handed over by the page-context script (whatsapp-pdf.content.ts).
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.origin !== window.location.origin || e.data?.source !== PDF_MESSAGE) return;
      const data = String(e.data.data ?? '');
      if (!data || Math.floor((data.length * 3) / 4) > 8 * 1024 * 1024) return;
      const name = String(e.data.name ?? 'documento.pdf').slice(0, 200);
      suggest({
        kind: 'pdf',
        contact: readContact(),
        text: name,
        attachment: { name, media_type: 'application/pdf', data },
        conversation: readConversation(),
      });
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        announce();
        scanMessages();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });
    announce();
    scanMessages();

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
  },
});
