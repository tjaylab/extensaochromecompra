// Messages and storage shared by the content script, the service worker and the side panel.

export interface Capture {
  id: string;
  text: string;
  contactName: string | null;
  contactPhone: string | null;
  /** Epoch ms of the click on "Registrar cotação": start of the registration timer. */
  capturedAt: number;
}

export type CaptureMessage = { type: 'capture'; capture: Omit<Capture, 'id'> };
export type ContactRequest = { type: 'get-contact' };
export type ContactResponse = { contactName: string | null; contactPhone: string | null };

export const PENDING_CAPTURE_KEY = 'pendingCapture';

export function newCaptureId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
