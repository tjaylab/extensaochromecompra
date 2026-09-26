// Messages and storage shared by the content script, the service worker and the side panel.
import type { Attachment, ConversationMessage, ExtractionResponse } from '@compras/shared';

export interface Capture {
  id: string;
  /**
   * 'selection': the buyer selected text. 'conversation': the buyer asked to read the open conversation.
   * 'file': a PDF or image (right-click on a WhatsApp image, or a file added in the panel).
   */
  mode: 'selection' | 'conversation' | 'file';
  attachments?: Attachment[] | null;
  /** Already interpreted (automatic reading): the review screen skips the call. */
  extraction?: ExtractionResponse | null;
  /** Selected text ('' in conversation mode). */
  text: string;
  /** Recent messages of the open conversation, oldest first (context for the selection, or the whole input). */
  conversation: ConversationMessage[] | null;
  contactName: string | null;
  contactPhone: string | null;
  /** Epoch ms of the click that started the capture: start of the registration timer. */
  capturedAt: number;
}

export type CaptureMessage = { type: 'capture'; capture: Omit<Capture, 'id'> };
export type ContactRequest = { type: 'get-contact' };
export type ContactResponse = { contactName: string | null; contactPhone: string | null };
/** hours: period to read; scroll: load older messages by scrolling up (manual reads) or only use what is on screen. */
export type ConversationRequest = { type: 'get-conversation'; hours?: number; scroll?: boolean };
export type ConversationResponse = ContactResponse & { conversation: ConversationMessage[] };
export type ImageRequest = { type: 'get-image'; src: string };
export type ImageResponse = ConversationResponse & { image: Attachment | null; error?: string };

/** "data:image/png;base64,AAAA" -> { media_type, data } */
export function splitDataUrl(url: string): { media_type: string; data: string } | null {
  const m = url.match(/^data:([^;,]+);base64,(.*)$/);
  return m ? { media_type: m[1]!, data: m[2]! } : null;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export type ContactChangedMessage = { type: 'contact-changed'; contact: ContactResponse };

/** The contact of the conversation open in WhatsApp Web right now (kept by the service worker). */
export const ACTIVE_CONTACT_KEY = 'activeContact';
export type ActiveContact = ContactResponse & { at: number };

/**
 * Something new arrived in the open conversation that may be a proposal:
 * 'text' a message with a price, 'image' an image, 'pdf' a PDF the buyer downloaded,
 * 'pdf-hint' a PDF that arrived but has not been downloaded yet.
 */
export interface Suggestion {
  id: string;
  kind: 'text' | 'image' | 'pdf' | 'pdf-hint';
  contact: ContactResponse;
  /** The message text (text), the caption (image) or the file name (pdf, pdf-hint). */
  text: string;
  attachment?: Attachment | null;
  conversation?: ConversationMessage[] | null;
  at: number;
}
export type SuggestionMessage = { type: 'suggestion'; suggestion: Omit<Suggestion, 'id' | 'at'> };
export const SUGGESTION_KEY = 'suggestion';
/** window.postMessage tag used by the page-context script that hands over downloaded PDFs. */
export const PDF_MESSAGE = '__procuremate_pdf__';
/** chrome.storage.local: read images and PDFs from recognized suppliers automatically (default on). */
export const AUTO_READ_KEY = 'autoReadMedia';
/** chrome.storage.local: how far back "Registrar da conversa aberta" reads, in hours (default 72). */
export const HISTORY_HOURS_KEY = 'historyHours';
export const DEFAULT_HISTORY_HOURS = 72;

export const PENDING_CAPTURE_KEY = 'pendingCapture';
/** Set by the service worker when a capture fails (e.g. an image it could not read). */
export const CAPTURE_ERROR_KEY = 'captureError';

export function newCaptureId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Floating window over WhatsApp Web (entrypoints/launcher.content.ts)
// ---------------------------------------------------------------------------

/** chrome.storage.local: whether the floating window was left open. */
export const LAUNCHER_OPEN_KEY = 'launcherOpen';
/** Tag of the messages the app (inside the floating window's iframe) sends to the WhatsApp page. */
export const PANEL_MESSAGE = '__procuremate_panel__';
export type LauncherCommand = { type: 'launcher'; action: 'open' | 'close' | 'toggle' };

/** Inside the floating window: ask the icon for attention (dot + note) while minimized. */
export function requestAttention(text: string) {
  if (window.parent === window) return; // Chrome side panel: nothing to do
  window.parent.postMessage({ source: PANEL_MESSAGE, type: 'attention', text }, 'https://web.whatsapp.com');
}

// ---------------------------------------------------------------------------
// Reading as the buyer scrolls (entrypoints/whatsapp.content.ts -> the app)
// ---------------------------------------------------------------------------

/** New bubbles on screen in the open conversation, sent straight to the app pages. */
export interface RowsLoadedMessage {
  type: 'rows-loaded';
  contact: ContactResponse;
  position: 'initial' | 'older' | 'newer';
  /** Text messages, in page order. */
  messages: ConversationMessage[];
  /** Received images and PDF documents (their data is fetched on request). */
  media: { id: string; kind: 'image' | 'pdf'; name: string | null; direction: 'in' | 'out'; caption: string }[];
}

/** The app asks for every message currently loaded in the open conversation (answered with a RowsLoadedMessage). */
export type RowsRequest = { type: 'get-rows' };

export type RowMediaRequest = { type: 'get-row-image'; id: string } | { type: 'read-row-pdf'; id: string };
export type RowMediaResponse = { attachment: Attachment | null; error?: string };

/** Drops a file into the open WhatsApp conversation (WhatsApp shows its send preview; the buyer sends). */
export type AttachFileRequest = { type: 'attach-file'; name: string; mediaType: string; data: string };

/** A file dragged out of the panel carries only this token; the content script asks the panel for the file on drop. */
export const DRAG_FILE_TYPE = 'application/x-procuremate-file';
export type DragFileRequest = { type: 'get-drag-file'; token: string };

/** chrome.storage.local: phones learned from the contact info panel, by contact name. */
export const CONTACT_PHONES_KEY = 'contactPhones';
