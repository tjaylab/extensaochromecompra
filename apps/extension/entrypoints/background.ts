import { defineBackground } from 'wxt/utils/define-background';
import { newCaptureId, PENDING_CAPTURE_KEY, type Capture, type CaptureMessage, type ConversationResponse } from '../lib/capture';

const MENU_SELECTION = 'registrar-cotacao';
const MENU_CONVERSATION = 'registrar-conversa';
const WHATSAPP = ['https://web.whatsapp.com/*'];

export default defineBackground(() => {
  // The toolbar icon opens the side panel.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: MENU_SELECTION, title: 'Registrar cotação', contexts: ['selection'], documentUrlPatterns: WHATSAPP });
    chrome.contextMenus.create({ id: MENU_CONVERSATION, title: 'Registrar cotação da conversa', contexts: ['page'], documentUrlPatterns: WHATSAPP });
  });

  // Right-click > "Registrar cotação" (selection) or "Registrar cotação da conversa" (anywhere on the page).
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const isSelection = info.menuItemId === MENU_SELECTION;
    if (!isSelection && info.menuItemId !== MENU_CONVERSATION) return;
    if (isSelection && !info.selectionText) return;
    const tabId = tab.id;
    // Open first: sidePanel.open must run while the user gesture is still active.
    chrome.sidePanel.open({ tabId }).catch(() => {});
    const capturedAt = Date.now();
    chrome.tabs
      .sendMessage<{ type: 'get-conversation' }, ConversationResponse>(tabId, { type: 'get-conversation' })
      .catch(() => null)
      .then((r) =>
        storeCapture({
          mode: isSelection ? 'selection' : 'conversation',
          text: isSelection ? info.selectionText! : '',
          conversation: r?.conversation ?? null,
          contactName: r?.contactName ?? null,
          contactPhone: r?.contactPhone ?? null,
          capturedAt,
        }),
      );
  });

  // Floating "Registrar cotação" button in the conversation.
  chrome.runtime.onMessage.addListener((msg: CaptureMessage, sender, sendResponse) => {
    if (msg?.type !== 'capture' || !sender.tab?.id) return;
    chrome.sidePanel
      .open({ tabId: sender.tab.id })
      .then(() => sendResponse({ opened: true }))
      .catch(() => sendResponse({ opened: false }));
    storeCapture(msg.capture);
    return true; // async sendResponse
  });
});

async function storeCapture(c: Omit<Capture, 'id'>) {
  const capture: Capture = { id: newCaptureId(), ...c, text: c.text.trim().slice(0, 4000) };
  await chrome.storage.session.set({ [PENDING_CAPTURE_KEY]: capture });
  // If the panel could not be opened (no user gesture), the badge tells the buyer to click the icon.
  await chrome.action.setBadgeText({ text: '1' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1E6B55' });
}
