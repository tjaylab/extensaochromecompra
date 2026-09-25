// Everything that depends on WhatsApp Web's page structure lives here, so breakage is fixed in one place.
// If these selectors stop matching, capture still works: the buyer just picks the supplier by hand.

const CONVERSATION_SELECTORS = ['#main', '[data-testid="conversation-panel-wrapper"]'];
const HEADER_TITLE_SELECTORS = [
  '#main header [data-testid="conversation-info-header-chat-title"]',
  '#main header span[dir="auto"][title]',
  '#main header span[dir="auto"]',
];
const PHONE_RE = /^\+?\d[\d\s().-]{7,}\d$/;

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

/** Contact name and, when WhatsApp shows it, the phone of the open conversation. */
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
  if (!title) return { contactName: null, contactPhone: null };
  if (PHONE_RE.test(title)) return { contactName: null, contactPhone: title };
  // Saved contacts sometimes expose the number in the header's subtitle.
  const subtitle = document.querySelector('#main header span[title*="+"]')?.getAttribute('title')?.trim() ?? null;
  return { contactName: title, contactPhone: subtitle && PHONE_RE.test(subtitle) ? subtitle : null };
}
