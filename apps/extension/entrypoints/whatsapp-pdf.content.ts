import { defineContentScript } from 'wxt/utils/define-content-script';
import { PDF_MESSAGE } from '../lib/capture';

// Runs in WhatsApp Web's own page context (MAIN world) because the decrypted file only exists there.
// When the buyer clicks to download a PDF, WhatsApp creates a blob: URL and clicks a hidden <a download>.
// We keep a copy of that PDF and hand it to the extension's content script with window.postMessage, so the
// proposal can be read without saving and attaching the file. Nothing else is read or changed.

const MAX_BYTES = 8 * 1024 * 1024;

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const blobs = new Map<string, Blob>(); // recent blob URLs -> blob (PDF-sized only)
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = originalCreate(obj);
      try {
        if (obj instanceof Blob && obj.size <= MAX_BYTES && (obj.type === 'application/pdf' || obj.type === '' || obj.type === 'application/octet-stream')) {
          blobs.set(url, obj);
          if (blobs.size > 20) blobs.delete(blobs.keys().next().value!);
        }
      } catch {
        // never interfere with WhatsApp
      }
      return url;
    };

    // Armed by the extension when it asks WhatsApp for a document itself ("read without downloading"): the next
    // PDF is kept and its save to disk is skipped. A download the buyer starts is never suppressed.
    let armedUntil = 0;
    window.addEventListener('message', (e) => {
      if (e.source === window && e.origin === window.location.origin && e.data?.source === `${PDF_MESSAGE}arm`) armedUntil = Date.now() + 20_000;
    });

    const sent = new Set<string>();
    /** Returns true when the file was taken on the extension's request (the save must be skipped). */
    const handle = (href: string, name: string): boolean => {
      try {
        const blob = blobs.get(href);
        const isPdf = blob && (blob.type === 'application/pdf' || /\.pdf$/i.test(name));
        if (!blob || !isPdf || sent.has(href)) return false;
        sent.add(href);
        const requested = Date.now() < armedUntil;
        armedUntil = 0;
        const reader = new FileReader();
        reader.onload = () => {
          const data = String(reader.result).split(',')[1] ?? '';
          window.postMessage({ source: PDF_MESSAGE, name: name || 'documento.pdf', data }, window.location.origin);
        };
        reader.readAsDataURL(blob);
        return requested;
      } catch {
        return false;
      }
    };

    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href?.startsWith('blob:') && handle(this.href, this.download)) return; // read only, no file saved
      return originalClick.call(this);
    };
    // Anchors attached to the page and clicked through events.
    document.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a[download]') as HTMLAnchorElement | null;
        if (a?.href?.startsWith('blob:') && handle(a.href, a.download)) e.preventDefault();
      },
      true,
    );
    // PDFs opened in a new tab instead of downloaded.
    const originalOpen = window.open;
    window.open = function (url?: string | URL, ...rest: unknown[]) {
      const href = String(url ?? '');
      if (href.startsWith('blob:') && handle(href, 'documento.pdf')) return null;
      return originalOpen.call(window, url, ...(rest as [string?, string?]));
    } as typeof window.open;
  },
});
