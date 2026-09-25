// Messages and storage shared by the content script, the service worker and the side panel.
import type { Attachment, ConversationMessage } from '@compras/shared';

export interface Capture {
  id: string;
  /**
   * 'selection': the buyer selected text. 'conversation': the buyer asked to read the open conversation.
   * 'file': a PDF or image (right-click on a WhatsApp image, or a file added in the panel).
   */
  mode: 'selection' | 'conversation' | 'file';
  attachments?: Attachment[] | null;
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
export type ConversationRequest = { type: 'get-conversation' };
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

export const PENDING_CAPTURE_KEY = 'pendingCapture';
/** Set by the service worker when a capture fails (e.g. an image it could not read). */
export const CAPTURE_ERROR_KEY = 'captureError';

export function newCaptureId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
