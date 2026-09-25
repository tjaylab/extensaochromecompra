import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { phoneKey } from '@compras/shared';
import { cleanDescription, decodeHtml } from '../src/omie/live.js';
import { PRD_MESSAGE, quotePayload, setup } from './helpers.js';

describe('phoneKey', () => {
  it.each([
    ['+55 11 97000-1234', null, '1170001234'],
    ['(11) 7000-1234', null, '1170001234'],
    ['97000-1234', '11', '1170001234'],
    ['7000-1234', '011', '1170001234'],
    ['3222-4100', '11', '1132224100'],
    ['5511970001234', null, '1170001234'],
    ['1234', null, null],
    [null, null, null],
  ])('%s (DDD %s) -> %s', (phone, ddd, key) => expect(phoneKey(phone, ddd)).toBe(key));

  it('decodes HTML entities from Omie', () => {
    expect(decodeHtml('G. G. NORONHA &amp; NORONHA LT')).toBe('G. G. NORONHA & NORONHA LT');
    expect(cleanDescription('Câmera de monitoramento Dahua   [spec]Resol. 4MP [est]ops')).toBe('Câmera de monitoramento Dahua');
  });
});

describe('GET /v1/suppliers/context', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  const user = () => env.as('ctx@empresa.com');
  beforeAll(async () => {
    env = await setup();
    await user().post('/v1/company', { name: 'Contexto' });
  });
  afterAll(async () => env?.close());

  it('recognizes the supplier by phone in Omie, links it and shows purchase history', async () => {
    // WhatsApp shows the 9th digit; Omie has the number without it; a client shares the same phone.
    const r = await user().get(`/v1/suppliers/context?name=${encodeURIComponent('Carlos (Microsemi)')}&phone=${encodeURIComponent('+55 11 97000-1234')}`);
    expect(r.status).toBe(200);
    expect(r.body.match).toBe('phone');
    expect(r.body.omie_supplier).toMatchObject({ omie_id: 9100001, name: 'MICROSEMI DISTRIBUIDORA LTDA', is_supplier: true });
    expect(r.body.supplier).toMatchObject({ name: 'Microsemi', omie_id: 9100001, cnpj: '04252011000110', phone: '+5511970001234' });
    expect(r.body.omie).toMatchObject({ available: true, orders_12m: 3, spent_12m: 30180, average_ticket: 10060 });
    expect(r.body.omie.last_order).toMatchObject({ number: '1301', total: 11970 });
    expect(r.body.omie.top_products[0]).toMatchObject({ description: 'Fonte chaveada 24V 10A', quantity: 42, total: 25530, last_unit_price: 598.5 });
    expect(r.body.quotes).toMatchObject({ total: 0, ordered: 0, last: null });
  });

  it('adds quote history once quotes exist, reusing the linked supplier', async () => {
    const ex = await user().post('/v1/extractions', { text: PRD_MESSAGE, contact_phone: '+55 11 97000-1234' });
    expect(ex.body.supplier_match).toMatchObject({ reason: 'phone', supplier: { name: 'Microsemi' } });
    await user().post('/v1/quotes', quotePayload(ex.body, { supplier: { id: ex.body.supplier_match.supplier.id } }));
    const r = await user().get(`/v1/suppliers/context?phone=${encodeURIComponent('+55 11 97000-1234')}`);
    expect(r.body.quotes).toMatchObject({ total: 1, ordered: 0, average_delivery_days: 45 });
    expect(r.body.quotes.last).toMatchObject({ total: 3343.8, currency: 'USD' });
    const all = await user().get('/v1/suppliers');
    expect(all.body).toHaveLength(1);
  });

  it('suggests candidates by name and remembers the buyer confirmation', async () => {
    const first = await user().get(`/v1/suppliers/context?name=${encodeURIComponent('Rafael - Tecnoparts')}`);
    expect(first.body.match).toBeNull();
    expect(first.body.candidates.map((c: any) => c.omie_id)).toEqual([9100003]);

    const linked = await user().post('/v1/suppliers/link', { omie_id: 9100003, contact_name: 'Rafael - Tecnoparts' });
    expect(linked.status).toBe(200);
    expect(linked.body.match).toBe('alias');
    expect(linked.body.supplier).toMatchObject({ name: 'Tecnoparts', omie_id: 9100003 });

    const again = await user().get(`/v1/suppliers/context?name=${encodeURIComponent('Rafael - Tecnoparts')}`);
    expect(again.body).toMatchObject({ match: 'alias', supplier: { name: 'Tecnoparts' } });
  });

  it('returns an empty context for an unknown contact', async () => {
    const r = await user().get(`/v1/suppliers/context?name=Fulano&phone=${encodeURIComponent('+55 21 99999-0000')}`);
    expect(r.body).toMatchObject({ match: null, supplier: null, omie_supplier: null, candidates: [] });
    expect(r.body.omie.orders_12m).toBe(0);
  });

  it('requires a name or a phone', async () => {
    expect((await user().get('/v1/suppliers/context')).status).toBe(400);
  });
});
