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
} from '../lib/capture';
import { isInConversation, readContact, readConversation } from '../lib/whatsapp-dom';

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
        if (msg?.type === 'get-conversation') sendResponse({ ...readContact(), conversation: readConversation() });
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(announce, 400);
    }).observe(document.body, { childList: true, subtree: true });
    announce();

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
