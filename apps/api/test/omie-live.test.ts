import { describe, expect, it } from 'vitest';
import { OmieError } from '../src/omie/gateway.js';
import { LiveOmie } from '../src/omie/live.js';

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: any }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('LiveOmie', () => {
  it('sends UpsertPedCompra with the documented envelope', async () => {
    const f = fakeFetch([{ status: 200, body: { nCodPed: 123, cNumero: '000045', cCodStatus: '0' } }]);
    const omie = new LiveOmie('KEY', 'SECRET', f.impl);
    const r = await omie.upsertPurchaseOrder({
      cCodIntPed: 'PC-0001',
      nCodFor: 99,
      cCodParc: 'A28',
      nQtdeParc: 1,
      dDtPrevisao: '09/11/2026',
      cObs: 'obs',
      cContato: null,
      freight: { cTpFrete: '0', nValFrete: null },
      items: [{ cCodIntItem: 'PC-0001-1', nCodProd: 7, nQtde: 30, nValUnit: 601.884 }],
    });
    expect(r).toEqual({ nCodPed: 123, cNumero: '000045' });
    expect(f.calls[0].url).toBe('https://app.omie.com.br/api/v1/produtos/pedidocompra/');
    expect(f.calls[0].body).toMatchObject({
      call: 'UpsertPedCompra',
      app_key: 'KEY',
      app_secret: 'SECRET',
      param: [
        {
          cabecalho_upsert: { cCodIntPed: 'PC-0001', nCodFor: 99, cCodParc: 'A28', nQtdeParc: 1, dDtPrevisao: '09/11/2026', cObs: 'obs' },
          frete_upsert: { cTpFrete: '0' },
          produtos_upsert: [{ nCodProd: 7, nQtde: 30, nValUnit: 601.884 }],
        },
      ],
    });
  });

  it('classifies faults as retryable or permanent', async () => {
    const f = fakeFetch([
      { status: 500, body: { faultstring: 'ERROR: Consumo redundante detectado', faultcode: 'SOAP-ENV:Client-8020' } },
      { status: 500, body: { faultstring: 'ERROR: Produto não cadastrado', faultcode: 'SOAP-ENV:Client-101' } },
    ]);
    const omie = new LiveOmie('K', 'S', f.impl);
    const input = { cCodIntPed: 'X', nCodFor: 1, cCodParc: '000', nQtdeParc: null, dDtPrevisao: null, cObs: '', cContato: null, freight: null, items: [] };
    await expect(omie.upsertPurchaseOrder(input)).rejects.toMatchObject({ retryable: true, message: 'Consumo redundante detectado' });
    await expect(omie.upsertPurchaseOrder(input)).rejects.toMatchObject({ retryable: false, message: 'Produto não cadastrado' });
  });

  it('treats "no records" as an empty list and pages through products', async () => {
    const f = fakeFetch([
      { status: 200, body: { total_de_paginas: 2, produto_servico_cadastro: [{ codigo_produto: 1, codigo: 'A', descricao: 'Fonte', unidade: 'UN', inativo: 'N' }] } },
      { status: 200, body: { total_de_paginas: 2, produto_servico_cadastro: [{ codigo_produto: 2, codigo: 'B', descricao: 'Velha', inativo: 'S' }] } },
      { status: 500, body: { faultstring: 'ERROR: Não existem registros para a página [1]!' } },
    ]);
    const omie = new LiveOmie('K', 'S', f.impl);
    expect(await omie.listProducts()).toEqual([{ omie_id: 1, code: 'A', description: 'Fonte', unit: 'UN' }]);
    expect(await omie.findSupplierByCnpj('11222333000181')).toBeNull();
    expect(f.calls[2].body.param[0].clientesFiltro).toEqual({ cnpj_cpf: '11222333000181' });
  });

  it('marks network failures as retryable', async () => {
    const omie = new LiveOmie('K', 'S', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    const err = await omie.testConnection().catch((e) => e);
    expect(err).toBeInstanceOf(OmieError);
    expect(err.retryable).toBe(true);
  });
});
