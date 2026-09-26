import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockAsaas } from '../src/payments/asaas.js';
import { PRD_MESSAGE, setup, VALID_CNPJ } from './helpers.js';

const payments = new MockAsaas();
let t: Awaited<ReturnType<typeof setup>>;
const owner = () => t.as('dono@procuremate.test');
const buyer = () => t.as('compras@cliente.test');
let companyId = '';

beforeAll(async () => {
  t = await setup({ payments }, { SUPERADMIN_EMAILS: 'dono@procuremate.test', ASAAS_WEBHOOK_TOKEN: 'segredo-webhook' });
  await buyer().post('/v1/company', { name: 'Cliente Teste' });
  companyId = (await buyer().get('/v1/me')).body.company.id;
});
afterAll(() => t.close());

const extract = () => buyer().post('/v1/extractions', { text: PRD_MESSAGE });
const admin = (body: object) => owner().patch(`/v1/admin/companies/${companyId}/subscription`, body);
const webhook = (token: string, body: object) =>
  t.app.inject({ method: 'POST', url: '/webhooks/asaas', headers: { 'asaas-access-token': token }, payload: body }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

describe('plans and usage', () => {
  it('starts new companies on the Profissional trial and counts each AI call', async () => {
    let b = (await buyer().get('/v1/billing')).body;
    expect(b).toMatchObject({ plan: { id: 'profissional' }, status: 'trialing', usage: { readings: 0, seats: 1 }, can_read: true, payments_enabled: true });
    expect(b.plans.map((p: { id: string }) => p.id)).toEqual(['essencial', 'profissional', 'empresa']);
    expect((await extract()).status).toBe(200);
    await buyer().post('/v1/extractions/scan', { conversation: [{ direction: 'in', text: PRD_MESSAGE }] });
    b = (await buyer().get('/v1/billing')).body;
    expect(b.usage.readings).toBe(2);
  });

  it('stops AI readings at the limit and resumes with extra readings', async () => {
    expect((await admin({ custom_readings: 2 })).status).toBe(200);
    const blocked = await extract();
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('reading_limit');
    expect((await buyer().get('/v1/billing')).body).toMatchObject({ can_read: false, blocked_reason: 'reading_limit' });
    await admin({ extra_readings: 10 });
    expect((await extract()).status).toBe(200);
  });

  it('limits buyers by plan and features by plan', async () => {
    await admin({ plan: 'essencial' });
    const invite = await buyer().post('/v1/company/invitations', { email: 'outro@cliente.test' });
    expect(invite.status).toBe(402);
    expect(invite.body.error.code).toBe('seat_limit');
    const email = await buyer().post('/v1/purchase-orders/00000000-0000-4000-8000-000000000000/email', { to: 'f@x.test' });
    expect(email.body.error.code).toBe('feature_unavailable');
    await admin({ plan: 'profissional' });
    expect((await buyer().post('/v1/company/invitations', { email: 'outro@cliente.test' })).status).toBe(200);
  });

  it('blocks readings when the trial ends', async () => {
    await admin({ trial_ends_at: '2020-01-01T00:00:00Z', custom_readings: null, extra_readings: 0 });
    const r = await extract();
    expect(r.body.error.code).toBe('subscription_inactive');
  });
});

describe('checkout and Asaas webhook', () => {
  it('creates the Asaas customer and subscription, then activates on payment', async () => {
    const r = await buyer().post('/v1/billing/checkout', { plan: 'essencial', cycle: 'monthly', cnpj: VALID_CNPJ });
    expect(r.status).toBe(200);
    expect(r.body.invoice_url).toMatch(/^https:\/\/sandbox\.asaas\.com\/i\//);
    const sub = [...payments.subscriptions.entries()][0]!;
    expect(sub[1]).toMatchObject({ value: 197, cycle: 'monthly', externalReference: companyId });
    expect([...payments.customers.values()][0]).toMatchObject({ cpfCnpj: '11222333000181' });

    expect((await webhook('errado', { event: 'PAYMENT_CONFIRMED', payment: { subscription: sub[0] } })).status).toBe(401);
    const today = new Date().toISOString().slice(0, 10);
    expect((await webhook('segredo-webhook', { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', subscription: sub[0], dueDate: today } })).status).toBe(200);
    const b = (await buyer().get('/v1/billing')).body;
    expect(b).toMatchObject({ plan: { id: 'essencial' }, status: 'active', can_read: true, trial_ends_at: null });

    // Changing plan updates the same Asaas subscription.
    await buyer().post('/v1/billing/checkout', { plan: 'profissional', cycle: 'yearly' });
    expect(payments.subscriptions.get(sub[0])).toMatchObject({ value: 4970, cycle: 'yearly' });

    await webhook('segredo-webhook', { event: 'PAYMENT_OVERDUE', payment: { subscription: sub[0], invoiceUrl: 'https://sandbox.asaas.com/i/atraso' } });
    expect((await buyer().get('/v1/billing')).body).toMatchObject({ status: 'past_due', can_read: true, invoice_url: 'https://sandbox.asaas.com/i/atraso' });
  });

  it('lists companies only for the ProcureMate team', async () => {
    expect((await buyer().get('/v1/admin/companies')).status).toBe(403);
    const list = (await owner().get('/v1/admin/companies')).body;
    expect(list.find((c: { id: string }) => c.id === companyId)).toMatchObject({ plan: 'profissional', cycle: 'yearly', seats: { used: 2, limit: 3 } });
    expect((await owner().get('/v1/me')).body.is_superadmin).toBe(true);
    expect((await buyer().get('/v1/me')).body.is_superadmin).toBe(false);
  });

  it('marks a period as paid by hand (manual billing)', async () => {
    const r = await admin({ mark_paid: true, cycle: 'monthly' });
    expect(r.body).toMatchObject({ status: 'active', cycle: 'monthly' });
  });
});
