import { DEFAULT_HISTORY_HOURS, HISTORY_HOURS_KEY, newCaptureId, type Capture, type ConversationResponse } from './capture';

/** How far back to read the conversation, from Configurações (default 72 h). */
export async function historyHours(): Promise<number> {
  const r = await chrome.storage.local.get(HISTORY_HOURS_KEY);
  const h = Number(r[HISTORY_HOURS_KEY]);
  return Number.isFinite(h) && h > 0 ? h : DEFAULT_HISTORY_HOURS;
}

/** Reads the conversation open in the WhatsApp Web tab (the side panel's "Registrar da conversa aberta"). */
export async function captureOpenConversation(): Promise<Capture> {
  const capturedAt = Date.now();
  if (!chrome.tabs?.query) throw new Error('Abra o WhatsApp Web nesta janela do Chrome.');
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab?.id) throw new Error('Abra o WhatsApp Web numa aba do Chrome e entre na conversa com o fornecedor.');
  const hours = await historyHours();
  let r: ConversationResponse | undefined;
  try {
    r = await chrome.tabs.sendMessage<{ type: 'get-conversation'; hours: number }, ConversationResponse>(tab.id, { type: 'get-conversation', hours });
  } catch {
    throw new Error('Recarregue a aba do WhatsApp Web (a extensão foi instalada ou atualizada depois que ela abriu).');
  }
  if (!r?.conversation.length) {
    throw new Error(`Nenhuma mensagem nas últimas ${hours} horas. Abra a conversa com o fornecedor no WhatsApp Web ou aumente o período em Configurações.`);
  }
  return {
    id: newCaptureId(),
    mode: 'conversation',
    text: '',
    conversation: r.conversation,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    capturedAt,
  };
}
