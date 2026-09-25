import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatConversation, type ConversationMessage } from '@compras/shared';
import { buildUserMessage } from '../src/extraction/prompt.js';
import { sourceExcerpt } from '../src/services/extractions.js';
import { setup } from './helpers.js';

const CONVERSATION: ConversationMessage[] = [
  { direction: 'out', author: 'Ana', time: '09:12, 25/09/2026', text: 'Bom dia, Carlos! Consegue cotar 30 fontes 24V?' },
  { direction: 'in', author: 'Carlos', time: '09:20, 25/09/2026', text: 'Bom dia! Vou verificar com o estoque.' },
  { direction: 'in', author: 'Carlos', time: '10:47, 25/09/2026', text: 'Consigo 30 fontes Microsemi por USD 111,46 cada. Prazo de 45 dias. Pagamento 28 dias.' },
  { direction: 'out', author: 'Ana', time: '10:50, 25/09/2026', text: 'Obrigada, vou analisar.' },
];

describe('conversation formatting', () => {
  it('numbers messages and names the sides', () => {
    const text = formatConversation(CONVERSATION);
    expect(text.split('\n')).toHaveLength(4);
    expect(text).toContain('[1] 09:12, 25/09/2026 · Comprador: Bom dia, Carlos!');
    expect(text).toContain('[3] 10:47, 25/09/2026 · Fornecedor · Carlos: Consigo 30 fontes');
    expect(formatConversation(CONVERSATION, { only: [1, 3] }).split('\n')).toHaveLength(2);
  });

  it('builds the prompt with conversation and selection blocks', () => {
    const msg = buildUserMessage({ text: 'USD 111,46 cada', conversation: CONVERSATION, contactName: 'Carlos', today: '2026-09-25' });
    expect(msg).toContain('<conversa>\n[1]');
    expect(msg).toContain('<selecao>\nUSD 111,46 cada\n</selecao>');
    expect(buildUserMessage({ text: 'x', today: '2026-09-25' })).not.toContain('<conversa>');
  });

  it('keeps only the messages the proposal came from', () => {
    expect(sourceExcerpt('', CONVERSATION, [1, 3])).toBe(formatConversation(CONVERSATION, { only: [1, 3] }));
    expect(sourceExcerpt('', CONVERSATION, [])).toBe(formatConversation(CONVERSATION));
    expect(sourceExcerpt('USD 111,46 cada', CONVERSATION, [1])).toContain('Contexto da conversa:\n[1]');
    expect(sourceExcerpt('Consigo 30 fontes', null, [])).toBe('Consigo 30 fontes');
    // Out-of-range numbers from the model are ignored.
    expect(sourceExcerpt('', CONVERSATION, [99])).toBe(formatConversation(CONVERSATION));
  });
});

describe('POST /v1/extractions with a conversation', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  const user = () => env.as('conv@empresa.com');
  beforeAll(async () => {
    env = await setup();
    await user().post('/v1/company', { name: 'Conversas' });
  });
  afterAll(async () => env?.close());

  it('extracts the latest supplier proposal and returns its excerpt', async () => {
    const r = await user().post('/v1/extractions', { conversation: CONVERSATION, contact_name: 'Carlos (Microsemi)' });
    expect(r.status).toBe(200);
    expect(r.body.data.itens[0]).toMatchObject({ quantidade: 30, valor_unitario: 111.46 });
    expect(r.body.data.mensagens_usadas).toEqual([3]);
    expect(r.body.source_text).toBe('[3] 10:47, 25/09/2026 · Fornecedor · Carlos: Consigo 30 fontes Microsemi por USD 111,46 cada. Prazo de 45 dias. Pagamento 28 dias.');
  });

  it('requires a selection or a conversation', async () => {
    const r = await user().post('/v1/extractions', { text: '', conversation: [] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('Selecione uma mensagem, abra uma conversa ou anexe um arquivo');
  });

  it('rejects conversations that are too long', async () => {
    const long = Array.from({ length: 25 }, () => ({ direction: 'in', text: 'x'.repeat(3000) }));
    const r = await user().post('/v1/extractions', { conversation: long });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('Conversa longa demais');
  });
});
