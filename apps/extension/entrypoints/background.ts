import { defineBackground } from 'wxt/utils/define-background';
import { newCaptureId, PENDING_CAPTURE_KEY, type Capture, type CaptureMessage, type ContactResponse } from '../lib/capture';

const MENU_ID = 'registrar-cotacao';

export default defineBackground(() => {
  // The toolbar icon opens the side panel.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Registrar cotação',
      contexts: ['selection'],
      documentUrlPatterns: ['https://web.whatsapp.com/*'],
    });
  });

  // Right-click > "Registrar cotação".
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id || !info.selectionText) return;
    const tabId = tab.id;
    // Open first: sidePanel.open must run while the user gesture is still active.
    chrome.sidePanel.open({ tabId }).catch(() => {});
    const capturedAt = Date.now();
    chrome.tabs
      .sendMessage<{ type: 'get-contact' }, ContactResponse>(tabId, { type: 'get-contact' })
      .catch(() => ({ contactName: null, contactPhone: null }))
      .then((contact) => storeCapture({ text: info.selectionText!, capturedAt, ...(contact ?? { contactName: null, contactPhone: null }) }));
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
