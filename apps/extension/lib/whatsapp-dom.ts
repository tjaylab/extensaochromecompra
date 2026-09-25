// Everything that depends on WhatsApp Web's page structure lives here, so breakage is fixed in one place.
// If these selectors stop matching, capture still works: the buyer selects text and picks the supplier by hand.
import type { ConversationMessage } from '@compras/shared';

const CONVERSATION_SELECTORS = ['#main', '[data-testid="conversation-panel-wrapper"]'];
const HEADER_TITLE_SELECTORS = [
  '#main header [data-testid="conversation-info-header-chat-title"]',
  '#main header span[dir="auto"][title]',
  '#main header span[dir="auto"]',
];
// Each text message carries its metadata as "[10:47, 25/09/2026] Carlos: ".
const MESSAGE_SELECTOR = '[data-pre-plain-text]';
const PHONE_RE = /^\+?\d[\d\s().-]{7,}\d$/;

export const CONVERSATION_LIMITS = { maxMessages: 40, maxChars: 12_000 };

export function conversationRoot(): Element | null {
  for (const sel of CONVERSATION_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/** True when the node is inside the open conversation (not the chat list or a modal). */
export function isInConversation(node: Node | null): boolean {
  const root = conversationRoot();
  if (!root || !node) return false;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !!el && root.contains(el) && !el.closest('footer');
}

/**
 * The phone of a one-to-one chat, from the message ids ("false_5511970001234@c.us_3EB0…").
 * Group chats (@g.us) and accounts shown by privacy id (@lid) give null.
 */
export function phoneFromMessageIds(root: ParentNode | null = conversationRoot()): string | null {
  if (!root) return null;
  for (const el of root.querySelectorAll('[data-id]')) {
    const m = el.getAttribute('data-id')?.match(/^(?:true|false)_(\d{10,15})@c\.us/);
    if (m) return `+${m[1]}`;
  }
  return null;
}

/** Contact name and, when available, the phone of the open conversation. */
export function readContact(): { contactName: string | null; contactPhone: string | null } {
  let title: string | null = null;
  for (const sel of HEADER_TITLE_SELECTORS) {
    const el = document.querySelector(sel);
    const t = (el?.getAttribute('title') || el?.textContent || '').trim();
    if (t) {
      title = t;
      break;
    }
  }
  if (!title) {
    // Header markup changed: take its first line of text (the chat name comes first).
    const header = document.querySelector('#main header') as HTMLElement | null;
    const firstLine = (header?.innerText ?? header?.textContent ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 1);
    title = firstLine ?? null;
  }
  if (!title) return { contactName: null, contactPhone: phoneFromMessageIds() };
  if (PHONE_RE.test(title)) return { contactName: null, contactPhone: title };
  // Saved contacts: the number may be in the header's subtitle or in the message ids.
  const subtitle = document.querySelector('#main header span[title*="+"]')?.getAttribute('title')?.trim() ?? null;
  return { contactName: title, contactPhone: subtitle && PHONE_RE.test(subtitle) ? subtitle : phoneFromMessageIds() };
}

function directionOf(el: Element): 'in' | 'out' {
  if (el.closest('.message-out')) return 'out';
  if (el.closest('.message-in')) return 'in';
  // Row ids start with "true_" for messages sent by this account.
  const id = el.closest('[data-id]')?.getAttribute('data-id') ?? '';
  return id.startsWith('true_') ? 'out' : 'in';
}

/**
 * The most recent text messages loaded in the open conversation, oldest first.
 * Only what WhatsApp has rendered: older messages need the buyer to scroll up first.
 */
export function readConversation(root: ParentNode | null = conversationRoot(), limits = CONVERSATION_LIMITS): ConversationMessage[] {
  if (!root) return [];
  const all: ConversationMessage[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)) {
    const meta = (el.getAttribute('data-pre-plain-text') ?? '').match(/^\[([^\]]+)\]\s*(.*?):\s*$/);
    const textEl = (el.querySelector('.selectable-text') as HTMLElement | null) ?? el;
    let text = (textEl.innerText ?? textEl.textContent ?? '').trim();
    if (!text) continue;
    const row = el.closest('[data-id]') ?? el.parentElement;
    if (row?.querySelector('img[src^="blob:"]')) text = `[imagem] ${text}`;
    all.push({ direction: directionOf(el), author: meta?.[2]?.trim() || null, time: meta?.[1]?.trim() || null, text: text.slice(0, 3000) });
  }
  const recent: ConversationMessage[] = [];
  let chars = 0;
  for (let i = all.length - 1; i >= 0 && recent.length < limits.maxMessages; i--) {
    chars += all[i]!.text.length;
    if (chars > limits.maxChars && recent.length) break;
    recent.unshift(all[i]!);
  }
  return recent;
}
