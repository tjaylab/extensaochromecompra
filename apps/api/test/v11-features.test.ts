import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockState } from '../src/omie/mock.js';
import { setup, VALID_CNPJ } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
const user = () => env.as('v11@empresa.com');
let companyId: string;

beforeAll(async () => {
  env = await setup();
  const me = await user().post('/v1/company', { name: 'Um Grau e Meio', cnpj: VALID_CNPJ });
  companyId = me.body.company.id;
});
afterAll(async () => env?.close());

describe('scan: every proposal in a stretch of conversation', () => {
  it('returns one proposal per priced supplier message, with the WhatsApp message ids', async () => {
    const r = await user().post('/v1/extractions/scan', {
      contact_name: 'Carlos (Microsemi)',
      contact_phone: '+55 11 97000-1234',
      conversation: [
        { id: 'false_1@c.us_A', direction: 'out', text: 'Consegue cotar fontes e cabos?' },
        { id: 'false_1@c.us_B', direction: 'in', text: 'Consigo 30 fontes Microsemi por USD 111,46 cada. Prazo de 45 dias.' },
        { id: 'false_1@c.us_C', direction: 'in', text: 'Bom dia!' },
        { id: 'false_1@c.us_D', direction: 'in', text: 'E 500 cabos PP por R$ 8,42 cada. Prazo de 7 dias.' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.proposals).toHaveLength(2);
    expect(r.body.proposals.map((p: any) => p.message_ids)).toEqual([['false_1@c.us_B'], ['false_1@c.us_D']]);
    expect(r.body.proposals[1].data).toMatchObject({ moeda: 'BRL', itens: [{ quantidade: 500, valor_unitario: 8.42 }] });
    // Each proposal is its own extraction: it saves as a quote like any other.
    const saved = await user().post('/v1/quotes', {
      extraction_id: r.body.proposals[1].extraction_id,
      supplier: { new: { name: 'Microsemi' } },
      currency: 'BRL',
      quote_date: '2026-09-25',
      source_text: r.body.proposals[1].source_text,
      origin: 'whatsapp',
      items: [{ description: 'Cabo PP', quantity: 500, unit_price: 8.42 }],
    });
    expect(saved.status).toBe(200);
  });

  it('returns nothing for a stretch without prices', async () => {
    const r = await user().post('/v1/extractions/scan', { conversation: [{ direction: 'in', text: 'Bom dia, tudo bem?' }] });
    expect(r.body.proposals).toEqual([]);
  });
});

describe('suppliers: search, register in Omie, phone update', () => {
  it('searches Omie suppliers by name, CNPJ or phone', async () => {
    await user().get('/v1/suppliers/context?name=warmup'); // loads the Omie copy
    const byName = await user().get('/v1/suppliers/search?q=tecnoparts');
    expect(byName.body.omie.map((s: any) => s.omie_id)).toEqual([9100003]);
    const byCnpj = await user().get('/v1/suppliers/search?q=11222333');
    expect(byCnpj.body.omie[0]).toMatchObject({ omie_id: 9100002 });
    expect((await user().get('/v1/suppliers/search?q=x')).body).toEqual({ local: [], omie: [] });
  });

  it('registers an unknown contact as a supplier in Omie and recognizes it right away', async () => {
    const before = await user().get(`/v1/suppliers/context?name=${encodeURIComponent('Joana Parafusos')}&phone=${encodeURIComponent('+55 41 98888-7777')}`);
    expect(before.body.match).toBeNull();

    const bad = await user().post('/v1/suppliers/omie', { name: 'Parafusos Sul', cnpj: '11.111.111/1111-11', phone: '+55 41 98888-7777' });
    expect(bad.status).toBe(400);

    const r = await user().post('/v1/suppliers/omie', {
      name: 'Parafusos Sul Ltda',
      cnpj: '45.723.174/0001-10',
      email: 'vendas@parafusossul.example',
      phone: '+55 41 98888-7777',
      contact_name: 'Joana Parafusos',
    });
    expect(r.status).toBe(200);
    expect(r.body.match).toBe('phone');
    expect(r.body.supplier).toMatchObject({ name: 'Parafusos Sul Ltda', cnpj: '45723174000110' });
    expect(r.body.supplier.omie_id).toBeGreaterThan(0);
    expect(mockState(companyId).created.map((s) => s.name)).toContain('Parafusos Sul Ltda');
  });

  it('flags a WhatsApp number that Omie does not have and updates it', async () => {
    // Tecnoparts is registered in Omie with (19) 99810-2233; the conversation comes from another number.
    await user().post('/v1/suppliers/link', { omie_id: 9100003, contact_name: 'Rafael - Tecnoparts' });
    const c = await user().get(`/v1/suppliers/context?name=${encodeURIComponent('Rafael - Tecnoparts')}&phone=${encodeURIComponent('+55 19 97777-1111')}`);
    expect(c.body.phone_mismatch).toEqual({ whatsapp: '+55 19 97777-1111', omie: ['19 99810-2233'] });

    const u = await user().post('/v1/suppliers/omie-phone', { omie_id: 9100003, phone: '+55 19 97777-1111', contact_name: 'Rafael - Tecnoparts' });
    expect(u.status).toBe(200);
    expect(u.body.phone_mismatch).toBeNull();
    expect(mockState(companyId).phoneUpdates.get(9100003)).toBe('+55 19 97777-1111');
  });
});

describe('purchase order document', () => {
  it('renders the order as a PDF and needs e-mail configured to send it', async () => {
    const q = await user().post('/v1/quotes', {
      supplier: { new: { name: 'Eletrônica Paulista', cnpj: VALID_CNPJ } },
      currency: 'BRL',
      payment_terms_text: '28 dias',
      delivery_days: 20,
      quote_date: '2026-09-25',
      source_text: 'x',
      origin: 'manual',
      items: [{ description: 'Cabo PP 3x2,5mm', quantity: 100, unit: 'm', unit_price: 8.42 }],
    });
    const d = await user().post('/v1/purchase-orders', { quote_id: q.body.id });
    const res = await env.app.inject({ method: 'GET', url: `/v1/purchase-orders/${d.body.id}/pdf`, headers: { authorization: 'Bearer dev:v11@empresa.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-file-name']).toMatch(/^Pedido-PC-\d{4}\.pdf$/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(1000);

    const mail = await user().post(`/v1/purchase-orders/${d.body.id}/email`, { to: 'vendas@paulista.example' });
    expect(mail.status).toBe(409);
    expect(mail.body.error.code).toBe('email_not_configured');
  });
});
