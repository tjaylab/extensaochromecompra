import { buildApp, type BuildOptions } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';

export const PRD_MESSAGE = 'Consigo 30 fontes Microsemi por USD 111,46 cada. Prazo de 45 dias. Pagamento 28 dias.';
export const VALID_CNPJ = '11.222.333/0001-81';

export async function setup(extra: Partial<BuildOptions> = {}, env: Parameters<typeof loadConfig>[0] = {}) {
  const cfg = loadConfig({ AUTH_MODE: 'dev', OMIE_MODE: 'mock', EXTRACTION_MODE: 'mock', NODE_ENV: 'test', ...env });
  const database = await openDatabase({ pgliteDir: 'memory://' });
  const { app, ctx } = await buildApp({ cfg, database, logger: false, jobRetryBaseMs: 1, ...extra });
  await app.ready();

  const as = (email: string) => {
    const headers = { authorization: `Bearer dev:${email}` };
    const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) => {
      const res = await app.inject({ method, url, headers, payload: payload as object });
      const body = res.body ? JSON.parse(res.body) : null;
      return { status: res.statusCode, body };
    };
    return {
      get: (url: string) => call('GET', url),
      post: (url: string, payload?: unknown) => call('POST', url, payload ?? {}),
      put: (url: string, payload?: unknown) => call('PUT', url, payload ?? {}),
      patch: (url: string, payload?: unknown) => call('PATCH', url, payload ?? {}),
    };
  };

  return {
    app,
    ctx,
    as,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

export function quotePayload(ex: { extraction_id: string; data: any }, overrides: Record<string, unknown> = {}) {
  return {
    extraction_id: ex.extraction_id,
    supplier: { new: { name: 'Microsemi Distribuidora', phone: '+55 11 97000-1234' } },
    currency: ex.data.moeda ?? 'BRL',
    delivery_days: ex.data.prazo_entrega_dias,
    delivery_text: ex.data.prazo_entrega_texto,
    payment_terms_text: ex.data.condicao_pagamento,
    freight_type: ex.data.frete_tipo,
    freight_value: ex.data.frete_valor,
    quote_date: '2026-09-25',
    source_text: PRD_MESSAGE,
    origin: 'whatsapp',
    registration_ms: 38_000,
    items: ex.data.itens.map((i: any) => ({
      description: i.descricao,
      brand: i.marca,
      sku: i.sku,
      quantity: i.quantidade,
      unit: i.unidade,
      unit_price: i.valor_unitario,
    })),
    ...overrides,
  };
}
