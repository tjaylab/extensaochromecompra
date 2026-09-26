import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockState } from '../src/omie/mock.js';
import { PRD_MESSAGE, quotePayload, setup, VALID_CNPJ } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => env?.close());

describe('full flow: register, compare, order', () => {
  const buyer = () => env.as('ana@empresa.com.br');
  let companyId: string;
  let requisitionId: string;
  let microsemiQuoteId: string;
  let orderId: string;

  it('requires authentication', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('onboards a company', async () => {
    const me = await buyer().get('/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.company).toBeNull();

    const blocked = await buyer().get('/v1/quotes');
    expect(blocked.status).toBe(403);

    const created = await buyer().post('/v1/company', { name: 'Um Grau e Meio' });
    expect(created.status).toBe(200);
    expect(created.body.role).toBe('admin');
    expect(created.body.omie).toMatchObject({ status: 'connected', mode: 'mock' });
    companyId = created.body.company.id;
  });

  it('creates a requisition', async () => {
    const r = await buyer().post('/v1/requisitions', { title: 'Fontes 24V industriais', items: [{ description: 'Fonte 24V', quantity: 30, unit: 'un' }] });
    expect(r.status).toBe(200);
    expect(r.body.number).toMatch(/^CMP-\d{4}$/);
    requisitionId = r.body.id;
  });

  it('extracts the PRD message and saves the quote', async () => {
    const ex = await buyer().post('/v1/extractions', { text: PRD_MESSAGE, contact_name: 'Carlos (Microsemi)', contact_phone: '+55 11 97000-1234' });
    expect(ex.status).toBe(200);
    expect(ex.body.data.itens[0]).toMatchObject({ quantidade: 30, valor_unitario: 111.46 });
    expect(ex.body.supplier_match.supplier).toBeNull();

    const saved = await buyer().post('/v1/quotes', quotePayload(ex.body, { requisition_id: requisitionId }));
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      status: 'comparing',
      currency: 'USD',
      total: 3343.8,
      delivery_days: 45,
      payment_terms_text: '28 dias',
      source_text: PRD_MESSAGE,
      origin: 'whatsapp',
      registration_ms: 38000,
    });
    expect(saved.body.supplier).toMatchObject({ name: 'Microsemi Distribuidora', phone: '+5511970001234', omie_id: null });
    microsemiQuoteId = saved.body.id;
  });

  it('recognizes the supplier by phone next time and does not duplicate it', async () => {
    const ex = await buyer().post('/v1/extractions', { text: PRD_MESSAGE, contact_name: 'Carlos', contact_phone: '(11) 97000-1234' });
    expect(ex.body.supplier_match).toMatchObject({ reason: 'phone', supplier: { name: 'Microsemi Distribuidora' } });

    const again = await buyer().post('/v1/quotes', quotePayload(ex.body, { supplier: { new: { name: 'microsemi distribuidora ltda', phone: '11970001234' } } }));
    expect(again.status).toBe(200);
    expect(again.body.supplier.id).toBeDefined();
    const list = await buyer().get('/v1/suppliers');
    expect(list.body).toHaveLength(1);
    // Discard the duplicate proposal so it does not appear in the comparison.
    const discarded = await buyer().patch(`/v1/quotes/${again.body.id}`, { status: 'discarded' });
    expect(discarded.body.status).toBe('discarded');
  });

  it('rejects a quote without items and keeps the source text required', async () => {
    const bad = await buyer().post('/v1/quotes', { supplier: { new: { name: 'X' } }, currency: 'BRL', quote_date: '2026-09-25', source_text: 'x', origin: 'manual', items: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Informe ao menos um item');
  });

  it('compares proposals of the requisition', async () => {
    const other = await buyer().post('/v1/quotes', {
      supplier: { new: { name: 'Eletrônica Paulista', phone: '+55 11 3222-4100', cnpj: VALID_CNPJ } },
      requisition_id: requisitionId,
      currency: 'BRL',
      delivery_days: 20,
      payment_terms_text: '30/60 dias',
      freight_type: 'CIF',
      quote_date: '23/09/2026',
      source_text: 'R$ 589,90 a unidade, frete incluso, 20 dias, 30/60',
      origin: 'manual',
      items: [{ description: 'Fonte chaveada 24V 10A', quantity: 30, unit: 'un', unit_price: 589.9 }],
    });
    expect(other.status).toBe(200);
    expect(other.body.total).toBe(17697);

    const cmp = await buyer().get(`/v1/requisitions/${requisitionId}/comparison`);
    expect(cmp.status).toBe(200);
    expect(cmp.body.requisition.quote_count).toBe(2);
    expect(cmp.body.quotes).toHaveLength(2);
    const paulista = cmp.body.quotes.find((q: any) => q.supplier.name === 'Eletrônica Paulista');
    expect(paulista.badges).toContain('Menor prazo');
    // One quote per currency: no price badge, and no automatic conversion.
    expect(cmp.body.quotes.flatMap((q: any) => q.badges)).not.toContain('Menor total em USD');
  });

  it('generates a draft order with suggestions and blocks sending until complete', async () => {
    const draft = await buyer().post('/v1/purchase-orders', { quote_id: microsemiQuoteId });
    expect(draft.status).toBe(200);
    expect(draft.body.status).toBe('draft');
    expect(draft.body.payment_term_code).toBe('A28');
    expect(draft.body.items[0].suggestion).toMatchObject({ omie_id: 4100412 });
    expect(draft.body.ready).toBe(false);
    expect(draft.body.checks.filter((c: any) => !c.ok).map((c: any) => c.key).sort()).toEqual(['exchange_rate', 'products', 'supplier']);
    orderId = draft.body.id;

    const early = await buyer().post(`/v1/purchase-orders/${orderId}/send`);
    expect(early.status).toBe(400);

    const quote = await buyer().get(`/v1/quotes/${microsemiQuoteId}`);
    expect(quote.body.status).toBe('selected');
  });

  it('validates CNPJ, products and exchange rate', async () => {
    const badCnpj = await buyer().patch(`/v1/purchase-orders/${orderId}`, { supplier_cnpj: '11.222.333/0001-00' });
    expect(badCnpj.status).toBe(400);
    const dupCnpj = await buyer().patch(`/v1/purchase-orders/${orderId}`, { supplier_cnpj: VALID_CNPJ });
    expect(dupCnpj.status).toBe(409);

    const draft = await buyer().get(`/v1/purchase-orders/${orderId}`);
    const itemId = draft.body.items[0].id;
    const badProduct = await buyer().patch(`/v1/purchase-orders/${orderId}`, { items: [{ id: itemId, omie_product_id: 123 }] });
    expect(badProduct.status).toBe(400);

    const ok = await buyer().patch(`/v1/purchase-orders/${orderId}`, {
      supplier_cnpj: '04.252.011/0001-10',
      exchange_rate: 5.4,
      items: [{ id: itemId, omie_product_id: 4100412 }],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.ready).toBe(true);
    expect(ok.body.total_brl).toBe(18056.52);
  });

  it('sends to Omie once, creating the supplier there', async () => {
    const sending = await buyer().post(`/v1/purchase-orders/${orderId}/send`);
    expect(sending.status).toBe(200);
    expect(['sending', 'sent']).toContain(sending.body.status);
    await env.ctx.jobs.idle();

    const sent = await buyer().get(`/v1/purchase-orders/${orderId}`);
    expect(sent.body).toMatchObject({ status: 'sent', total_brl: 18056.52 });
    expect(sent.body.omie_number).toMatch(/^\d{6}$/);
    expect(sent.body.supplier.omie_id).toBeGreaterThan(0);

    const omie = mockState(companyId);
    const order = [...omie.orders.values()][0];
    expect(omie.orders.size).toBe(1);
    expect(order.input).toMatchObject({ cCodParc: 'A28', nQtdeParc: 1, dDtPrevisao: '09/11/2026' });
    expect(order.input.items[0]).toMatchObject({ nCodProd: 4100412, nQtde: 30, nValUnit: 601.884 });
    expect(order.input.cObs).toContain('Moeda original USD');

    // Sending again does not create a second order.
    const again = await buyer().post(`/v1/purchase-orders/${orderId}/send`);
    expect(again.body.status).toBe('sent');
    await env.ctx.jobs.idle();
    expect(omie.orders.size).toBe(1);
    const dup = await buyer().post('/v1/purchase-orders', { quote_id: microsemiQuoteId });
    expect(dup.status).toBe(409);

    const quote = await buyer().get(`/v1/quotes/${microsemiQuoteId}`);
    expect(quote.body.status).toBe('ordered');
    const req = await buyer().get(`/v1/requisitions/${requisitionId}`);
    expect(req.body.status).toBe('ordered');
  });

  it('reports pilot metrics', async () => {
    const m = await buyer().get('/v1/metrics');
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ quotes_whatsapp: 2, median_registration_seconds: 38, under_one_minute_pct: 100, orders_sent: 1 });
    expect(m.body.quotes_by_user[0]).toMatchObject({ email: 'ana@empresa.com.br' });
  });

  it('isolates companies', async () => {
    const outsider = env.as('bruno@outra.com');
    await outsider.post('/v1/company', { name: 'Outra' });
    const q = await outsider.get(`/v1/quotes/${microsemiQuoteId}`);
    expect(q.status).toBe(404);
    const list = await outsider.get('/v1/quotes');
    expect(list.body).toEqual([]);
    const po = await outsider.post(`/v1/purchase-orders/${orderId}/send`);
    expect(po.status).toBe(404);
  });

  it('lets an admin invite a buyer, who joins on first login', async () => {
    const inv = await buyer().post('/v1/company/invitations', { email: 'Carla@Empresa.com.br' });
    expect(inv.status).toBe(200);
    const me = await env.as('carla@empresa.com.br').get('/v1/me');
    expect(me.body).toMatchObject({ role: 'buyer', company: { name: 'Um Grau e Meio' } });
    const metrics = await env.as('carla@empresa.com.br').get('/v1/metrics');
    expect(metrics.status).toBe(403);
  });
});

describe('Omie failures', () => {
  it('retries transient errors and surfaces permanent ones', async () => {
    const u = env.as('dora@loja.com');
    const me = await u.post('/v1/company', { name: 'Loja' });
    const companyId = me.body.company.id;
    const mkOrder = async (name: string, cnpj: string) => {
      const q = await u.post('/v1/quotes', {
        supplier: { new: { name, cnpj } },
        currency: 'BRL',
        payment_terms_text: '28 dias',
        quote_date: '2026-09-25',
        source_text: 'x',
        origin: 'manual',
        items: [{ description: 'Cabo PP 3x2,5mm', quantity: 100, unit: 'm', unit_price: 8.42 }],
      });
      const d = await u.post('/v1/purchase-orders', { quote_id: q.body.id });
      await u.patch(`/v1/purchase-orders/${d.body.id}`, { items: [{ id: d.body.items[0].id, omie_product_id: 4100220 }] });
      return d.body.id as string;
    };

    const state = mockState(companyId);
    const transientId = await mkOrder('Cabos Norte', '11.444.777/0001-61');
    state.failNext.push({ message: 'Consumo redundante detectado', retryable: true });
    await u.post(`/v1/purchase-orders/${transientId}/send`);
    await env.ctx.jobs.idle();
    const ok = await u.get(`/v1/purchase-orders/${transientId}`);
    expect(ok.body).toMatchObject({ status: 'sent', attempts: 2 });

    const permanentId = await mkOrder('Cabos Sul', '45.723.174/0001-10');
    state.failNext.push({ message: 'Fornecedor bloqueado para compras', retryable: false }, { message: 'x', retryable: false });
    await u.post(`/v1/purchase-orders/${permanentId}/send`);
    await env.ctx.jobs.idle();
    const failed = await u.get(`/v1/purchase-orders/${permanentId}`);
    expect(failed.body).toMatchObject({ status: 'error', last_error: 'Fornecedor bloqueado para compras', attempts: 1 });

    // Fix on the Omie side, then resend.
    state.failNext.length = 0;
    await u.post(`/v1/purchase-orders/${permanentId}/send`);
    await env.ctx.jobs.idle();
    const resent = await u.get(`/v1/purchase-orders/${permanentId}`);
    expect(resent.body.status).toBe('sent');
  });
});
