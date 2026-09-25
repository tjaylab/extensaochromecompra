// Messages and storage shared by the content script, the service worker and the side panel.
import type { ConversationMessage } from '@compras/shared';

export interface Capture {
  id: string;
  /** 'selection': the buyer selected text. 'conversation': the buyer asked to read the open conversation. */
  mode: 'selection' | 'conversation';
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

export const PENDING_CAPTURE_KEY = 'pendingCapture';

export function newCaptureId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
