import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

// Server in live Omie mode (production-like): only demo companies get the simulated Omie.
let t: Awaited<ReturnType<typeof setup>>;
const owner = () => t.as('dono@procuremate.test');
const reviewer = () => t.as('revisor@procuremate.test');
const other = () => t.as('cliente@empresa.test');

beforeAll(async () => {
  t = await setup({}, { OMIE_MODE: 'live', SUPERADMIN_EMAILS: 'dono@procuremate.test' });
  await reviewer().post('/v1/company', { name: 'Empresa Demonstração' });
  await other().post('/v1/company', { name: 'Cliente Real' });
});
afterAll(() => t.close());

describe('demo companies', () => {
  it('uses the simulated Omie only for companies marked as demo', async () => {
    expect((await reviewer().get('/v1/omie/products')).body.error.code).toBe('omie_not_configured');
    const id = (await reviewer().get('/v1/me')).body.company.id;
    const r = await owner().patch(`/v1/admin/companies/${id}/subscription`, { demo: true });
    expect(r.body.demo).toBe(true);

    expect((await reviewer().get('/v1/me')).body.omie).toMatchObject({ status: 'connected', mode: 'mock' });
    const products = await reviewer().get('/v1/omie/products?q=fonte');
    expect(products.status).toBe(200);
    expect(products.body.length).toBeGreaterThan(0);

    // Other companies still need their own Omie.
    expect((await other().get('/v1/me')).body.omie.mode).toBe('live');
    expect((await other().get('/v1/omie/products')).body.error.code).toBe('omie_not_configured');
  });
});
