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

export interface MessageRow {
  id: string;
  direction: 'in' | 'out';
  text: string;
  /** A received image rendered in the bubble (blob: URL), if any. */
  image: HTMLImageElement | null;
  /** File name when the bubble is a PDF document. */
  pdfName: string | null;
}

const ROW_ID_RE = /^(true|false)_/;

/** Every message bubble loaded in the open conversation, in page order (oldest first). */
export function readMessageRows(root: ParentNode | null = conversationRoot()): MessageRow[] {
  if (!root) return [];
  const rows: MessageRow[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-id]')) {
    const id = el.getAttribute('data-id') ?? '';
    if (!ROW_ID_RE.test(id) || el.parentElement?.closest('[data-id]')) continue; // nested ids belong to the outer row
    const textEl = el.querySelector<HTMLElement>('[data-pre-plain-text] .selectable-text') ?? el.querySelector<HTMLElement>('[data-pre-plain-text]');
    const text = (textEl?.innerText ?? textEl?.textContent ?? '').trim();
    const images = [...el.querySelectorAll<HTMLImageElement>('img[src^="blob:"]')];
    const image = images.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0] ?? null;
    const whole = (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ');
    // Bubble texts may run together ("Orcamento.pdf2 páginas"): ".pdf" must not be followed by a letter.
    const pdfName = whole.match(/([\w\-. ()À-ú]{1,120}\.pdf)(?![a-z])/i)?.[1]?.trim() ?? null;
    rows.push({ id, direction: id.startsWith('true_') ? 'out' : directionOf(el), text, image, pdfName });
  }
  return rows;
}

/**
 * Parses the time WhatsApp puts in each message ("10:47, 25/09/2026", or "10:47 AM, 9/25/2026" in US English)
 * into epoch ms. Day/month order follows the page language. Returns null when it cannot tell.
 */
export function parseMessageTime(time: string | null | undefined, lang = document.documentElement.lang || navigator.language): number | null {
  if (!time) return null;
  const hm = time.match(/(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?/i);
  const dmy = time.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!hm || !dmy) return null;
  const [a, b] = [Number(dmy[1]), Number(dmy[2])];
  const year = Number(dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]);
  // Month first in US English, unless the first number cannot be a month.
  const monthFirst = /^en-us/i.test(lang) ? a <= 12 : b > 12;
  const [day, month] = monthFirst ? [b, a] : [a, b];
  let hour = Number(hm[1]);
  const ampm = hm[3]?.toLowerCase().replace(/[.\s]/g, '');
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  const d = new Date(year, month - 1, day, hour, Number(hm[2]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== month - 1 ? null : d.getTime();
}

/**
 * Text messages loaded in the open conversation, oldest first: the most recent ones within the limits,
 * and when `since` is given only those at or after it. Only what WhatsApp has rendered (see loadHistory).
 */
export function readConversation(
  root: ParentNode | null = conversationRoot(),
  limits: { maxMessages: number; maxChars: number } = CONVERSATION_LIMITS,
  since?: number,
): ConversationMessage[] {
  if (!root) return [];
  const all: ConversationMessage[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)) {
    const meta = (el.getAttribute('data-pre-plain-text') ?? '').match(/^\[([^\]]+)\]\s*(.*?):\s*$/);
    const time = meta?.[1]?.trim() || null;
    if (since != null) {
      const at = parseMessageTime(time);
      if (at != null && at < since) continue;
    }
    const textEl = (el.querySelector('.selectable-text') as HTMLElement | null) ?? el;
    let text = (textEl.innerText ?? textEl.textContent ?? '').trim();
    if (!text) continue;
    const row = el.closest('[data-id]') ?? el.parentElement;
    if (row?.querySelector('img[src^="blob:"]')) text = `[imagem] ${text}`;
    all.push({ direction: directionOf(el), author: meta?.[2]?.trim() || null, time, text: text.slice(0, 3000) });
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

/** Limits for a history read (several days of conversation). */
export const HISTORY_LIMITS = { maxMessages: 300, maxChars: 60_000 };

/** The scrollable element that holds the message list (the one WhatsApp loads older messages into). */
export function messageScroller(root: ParentNode | null = conversationRoot()): HTMLElement | null {
  const first = root?.querySelector<HTMLElement>('[data-id]');
  for (let el = first?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

function oldestLoadedTime(root: ParentNode | null): number | null {
  for (const el of root?.querySelectorAll(MESSAGE_SELECTOR) ?? []) {
    const t = parseMessageTime((el.getAttribute('data-pre-plain-text') ?? '').match(/^\[([^\]]+)\]/)?.[1]);
    if (t != null) return t;
  }
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scrolls the conversation up until messages older than `since` are loaded (WhatsApp loads history as you
 * scroll), then puts the scroll back where the buyer was. Stops after `timeoutMs` or when nothing more loads.
 * Returns whether the whole period was reached.
 */
export async function loadHistory(since: number, opts: { timeoutMs?: number; stepWaitMs?: number } = {}): Promise<boolean> {
  const root = conversationRoot();
  const scroller = messageScroller(root);
  if (!scroller) return false;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const stepWaitMs = opts.stepWaitMs ?? 700;
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  const started = Date.now();
  let reached = false;
  let idle = 0;
  try {
    while (Date.now() - started < timeoutMs) {
      const oldest = oldestLoadedTime(root);
      if (oldest != null && oldest < since) {
        reached = true;
        break;
      }
      const before = root!.querySelectorAll('[data-id]').length;
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll'));
      await wait(stepWaitMs);
      if (root!.querySelectorAll('[data-id]').length === before) {
        if (++idle >= 3) break; // start of the conversation, or nothing more to load
      } else idle = 0;
    }
  } finally {
    // Back to where the buyer was, measured from the bottom (older messages were added above).
    scroller.scrollTop = scroller.scrollHeight - fromBottom;
  }
  return reached;
}
