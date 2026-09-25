import { defineBackground } from 'wxt/utils/define-background';
import {
  newCaptureId,
  PENDING_CAPTURE_KEY,
  type Capture,
  type CaptureMessage,
  type ConversationResponse,
  type ImageResponse,
  type ActiveContact,
  type ContactChangedMessage,
  type Suggestion,
  type SuggestionMessage,
  SUGGESTION_KEY,
  ACTIVE_CONTACT_KEY,
  CAPTURE_ERROR_KEY,
  type LauncherCommand,
} from '../lib/capture';
import { historyHours } from '../lib/whatsapp-tab';

const MENU_SELECTION = 'registrar-cotacao';
const MENU_CONVERSATION = 'registrar-conversa';
const MENU_IMAGE = 'registrar-imagem';
const WHATSAPP = ['https://web.whatsapp.com/*'];

export default defineBackground(() => {
  // Toolbar icon: on WhatsApp Web it opens/minimizes the floating window; elsewhere it opens the side panel.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.action.onClicked.addListener((tab) => {
    if (!tab.id) return;
    if (tab.url?.startsWith('https://web.whatsapp.com/')) {
      openWindow(tab.id, 'toggle');
      return;
    }
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: MENU_SELECTION, title: 'Registrar cotação', contexts: ['selection'], documentUrlPatterns: WHATSAPP });
    chrome.contextMenus.create({ id: MENU_CONVERSATION, title: 'Registrar cotação da conversa', contexts: ['page'], documentUrlPatterns: WHATSAPP });
    chrome.contextMenus.create({ id: MENU_IMAGE, title: 'Registrar cotação desta imagem', contexts: ['image'], documentUrlPatterns: WHATSAPP });
  });

  // Right-click on an image in the conversation.
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_IMAGE || !tab?.id || !info.srcUrl) return;
    const tabId = tab.id;
    openWindow(tabId);
    const capturedAt = Date.now();
    chrome.tabs
      .sendMessage<{ type: 'get-image'; src: string }, ImageResponse>(tabId, { type: 'get-image', src: info.srcUrl })
      .catch(() => null)
      .then(async (r) => {
        if (!r?.image) {
          await chrome.storage.session.set({
            [CAPTURE_ERROR_KEY]: `Não consegui ler a imagem${r?.error ? ` (${r.error})` : ''}. Baixe a imagem e anexe em "Colar texto ou anexar arquivo".`,
          });
          return;
        }
        await storeCapture({
          mode: 'file',
          text: '',
          attachments: [r.image],
          conversation: r.conversation,
          contactName: r.contactName,
          contactPhone: r.contactPhone,
          capturedAt,
        });
      });
  });

  // Right-click > "Registrar cotação" (selection) or "Registrar cotação da conversa" (anywhere on the page).
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const isSelection = info.menuItemId === MENU_SELECTION;
    if (!isSelection && info.menuItemId !== MENU_CONVERSATION) return;
    if (isSelection && !info.selectionText) return;
    const tabId = tab.id;
    openWindow(tabId);
    const capturedAt = Date.now();
    // The whole-conversation option reads the configured period (scrolling up); a selection only needs recent context.
    (isSelection ? Promise.resolve(undefined) : historyHours())
      .then((hours) =>
        chrome.tabs.sendMessage<{ type: 'get-conversation'; hours?: number }, ConversationResponse>(tabId, { type: 'get-conversation', hours }),
      )
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

  // A possible proposal arrived in the open conversation: the side panel offers to register it.
  chrome.runtime.onMessage.addListener((msg: SuggestionMessage) => {
    if (msg?.type !== 'suggestion') return;
    const suggestion: Suggestion = { ...msg.suggestion, id: newCaptureId(), at: Date.now() };
    chrome.storage.session
      .set({ [SUGGESTION_KEY]: suggestion })
      // Session storage holds 10 MB: a very large file goes without its data (the panel then asks to attach it).
      .catch(() => chrome.storage.session.set({ [SUGGESTION_KEY]: { ...suggestion, attachment: null } }))
      .then(() => chrome.action.setBadgeText({ text: '•' }))
      .then(() => chrome.action.setBadgeBackgroundColor({ color: '#2563EB' }))
      .catch(() => {});
  });

  // The conversation open in WhatsApp Web: the side panel shows this supplier's history.
  chrome.runtime.onMessage.addListener((msg: ContactChangedMessage) => {
    if (msg?.type !== 'contact-changed') return;
    const active: ActiveContact = { ...msg.contact, at: Date.now() };
    chrome.storage.session.set({ [ACTIVE_CONTACT_KEY]: active }).catch(() => {});
  });

  // Floating "Registrar cotação" button in the conversation.
  chrome.runtime.onMessage.addListener((msg: CaptureMessage, sender, sendResponse) => {
    if (msg?.type !== 'capture' || !sender.tab?.id) return;
    openWindow(sender.tab.id);
    storeCapture(msg.capture);
    sendResponse({ opened: true });
  });
});

/** Opens (or toggles) ProcureMate's floating window on the WhatsApp Web tab. */
function openWindow(tabId: number, action: LauncherCommand['action'] = 'open') {
  const cmd: LauncherCommand = { type: 'launcher', action };
  chrome.tabs.sendMessage(tabId, cmd).catch(() => {});
}

async function storeCapture(c: Omit<Capture, 'id'>) {
  const capture: Capture = { id: newCaptureId(), ...c, text: c.text.trim().slice(0, 4000) };
  await chrome.storage.session.set({ [PENDING_CAPTURE_KEY]: capture });
  // If the panel could not be opened (no user gesture), the badge tells the buyer to click the icon.
  await chrome.action.setBadgeText({ text: '1' });
  await chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
}
