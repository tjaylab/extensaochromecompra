import { describe, expect, it } from 'vitest';
import type { ExtractionResponse } from '@compras/shared';
import { hasPricedMessage, proposalKey, quoteFromExtraction } from './auto-quote';

const ex = (over: Partial<ExtractionResponse['data']> = {}, supplier: ExtractionResponse['supplier_match']['supplier'] = null): ExtractionResponse => ({
  extraction_id: '00000000-0000-4000-8000-000000000001',
  source_text: '[2] · Fornecedor · Carlos: fica USD 105,90 cada',
  latency_ms: 10,
  supplier_match: { supplier, reason: supplier ? 'phone' : null, suggestions: [] },
  data: {
    fornecedor_nome: null,
    moeda: 'USD',
    prazo_entrega_dias: 45,
    prazo_entrega_data: null,
    prazo_entrega_texto: '45 dias',
    condicao_pagamento: '28 dias',
    frete_tipo: null,
    frete_valor: null,
    validade_proposta: null,
    itens: [{ descricao: 'Fonte Microsemi', marca: 'Microsemi', sku: null, quantidade: 30, unidade: 'un', valor_unitario: 105.9, valor_total: null }],
    campos_ambiguos: [],
    mensagens_usadas: [1, 2],
    trecho_documento: null,
    ...over,
  },
});
const src = { contactName: 'Carlos (Microsemi)', contactPhone: '+55 11 97000-1234', detectedAt: 1000, origin: 'whatsapp' as const };

describe('quoteFromExtraction', () => {
  it('builds a ready-to-save quote, creating the supplier from the contact', () => {
    const { payload, missing } = quoteFromExtraction(ex(), src, 31_000);
    expect(missing).toEqual([]);
    expect(payload).toMatchObject({
      supplier: { new: { name: 'Microsemi', phone: '+55 11 97000-1234' } },
      currency: 'USD',
      delivery_days: 45,
      payment_terms_text: '28 dias',
      origin: 'whatsapp',
      registration_ms: 30_000,
      items: [{ description: 'Fonte Microsemi', quantity: 30, unit_price: 105.9 }],
    });
  });

  it('uses the recognized supplier and derives the unit price from a lot total', () => {
    const supplier = { id: '00000000-0000-4000-8000-000000000002', name: 'Microsemi', phone: null, cnpj: null, email: null, omie_id: 9 };
    const { payload } = quoteFromExtraction(ex({ itens: [{ descricao: 'Lote', marca: null, sku: null, quantidade: 10, unidade: 'un', valor_unitario: null, valor_total: 1250 }] }, supplier), src);
    expect(payload?.supplier).toEqual({ id: supplier.id });
    expect(payload?.items[0]).toMatchObject({ quantity: 10, unit_price: 125 });
  });

  it('refuses to save when required data is missing', () => {
    const { payload, missing } = quoteFromExtraction(ex({ moeda: null, itens: [{ descricao: '', marca: null, sku: null, quantidade: null, unidade: null, valor_unitario: 10, valor_total: null }] }), src);
    expect(payload).toBeNull();
    expect(missing).toEqual(['moeda', 'produto do item 1', 'quantidade do item 1']);
  });
});

describe('proposal detection keys', () => {
  const conv = [
    { direction: 'out' as const, text: 'Consegue cotar?', time: '09:00, 25/09/2026' },
    { direction: 'in' as const, text: 'Fica USD 105,90 cada', time: '10:52, 25/09/2026' },
    { direction: 'in' as const, text: 'Qualquer coisa me chama', time: '10:53, 25/09/2026' },
  ];
  it('keys on the latest priced supplier message', () => {
    const contact = { contactName: 'Carlos', contactPhone: '+5511970001234' };
    expect(hasPricedMessage(conv)).toBe(true);
    expect(proposalKey(contact, conv)).toBe('+5511970001234|10:52, 25/09/2026|Fica USD 105,90 cada');
    expect(proposalKey(contact, conv.slice(0, 1))).toBeNull();
    expect(hasPricedMessage([conv[0]!, conv[2]!])).toBe(false);
  });
});
