import { newCaptureId, type Capture, type ConversationResponse } from './capture';

/** Reads the conversation open in the WhatsApp Web tab (the side panel's "Registrar da conversa aberta"). */
export async function captureOpenConversation(): Promise<Capture> {
  const capturedAt = Date.now();
  if (!chrome.tabs?.query) throw new Error('Abra o WhatsApp Web nesta janela do Chrome.');
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab?.id) throw new Error('Abra o WhatsApp Web numa aba do Chrome e entre na conversa com o fornecedor.');
  let r: ConversationResponse | undefined;
  try {
    r = await chrome.tabs.sendMessage<{ type: 'get-conversation' }, ConversationResponse>(tab.id, { type: 'get-conversation' });
  } catch {
    throw new Error('Recarregue a aba do WhatsApp Web (a extensão foi instalada ou atualizada depois que ela abriu).');
  }
  if (!r?.conversation.length) throw new Error('Nenhuma mensagem encontrada. Abra a conversa com o fornecedor no WhatsApp Web.');
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
