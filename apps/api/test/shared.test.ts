import { describe, expect, it } from 'vitest';
import { brToIso, isValidCnpj, normalizePhone, normalizeSupplierName, parseDecimal } from '@compras/shared';
import { mockExtractor } from '../src/extraction/extractor.js';
import { suggestPaymentTerm } from '../src/services/catalog.js';
import { correctedFields } from '../src/services/quotes.js';
import { PRD_MESSAGE } from './helpers.js';

describe('parseDecimal', () => {
  it.each([
    ['111,46', 111.46],
    ['1.234,50', 1234.5],
    ['1,234.50', 1234.5],
    ['1.234', 1234],
    ['12.5', 12.5],
    ['R$ 589,90', 589.9],
    ['USD 104.90', 104.9],
    ['', null],
    ['abc', null],
  ])('%s -> %s', (input, expected) => expect(parseDecimal(input)).toBe(expected));
});

describe('suppliers', () => {
  it('normalizes names for duplicate detection', () => {
    expect(normalizeSupplierName('Eletrônica Paulista LTDA.')).toBe(normalizeSupplierName('eletronica paulista'));
  });
  it('normalizes Brazilian phones', () => {
    expect(normalizePhone('+55 11 97000-1234')).toBe('+5511970001234');
    expect(normalizePhone('(11) 97000-1234')).toBe('+5511970001234');
    expect(normalizePhone('123')).toBeNull();
  });
  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
  it('parses dates', () => {
    expect(brToIso('25/09/2026')).toBe('2026-09-25');
    expect(brToIso('2026-09-25')).toBe('2026-09-25');
    expect(brToIso('31/02')).toBeNull();
  });
});

describe('mock extractor', () => {
  it('reads the PRD example', async () => {
    const { output } = await mockExtractor({ text: PRD_MESSAGE, today: '2026-09-25' });
    expect(output.moeda).toBe('USD');
    expect(output.prazo_entrega_dias).toBe(45);
    expect(output.condicao_pagamento).toBe('28 dias');
    expect(output.frete_tipo).toBeNull();
    expect(output.itens).toHaveLength(1);
    expect(output.itens[0]).toMatchObject({ descricao: 'Fonte Microsemi', marca: 'Microsemi', quantidade: 30, valor_unitario: 111.46 });
  });
});

describe('payment term suggestion', () => {
  const terms = [
    { code: '000', description: 'À vista', installments: 1 },
    { code: 'A28', description: '28 dias', installments: 1 },
    { code: 'S36', description: '30/60 dias', installments: 2 },
  ];
  it.each([
    ['28 dias', 'A28'],
    ['Pagamento 30/60', 'S36'],
    ['à vista', '000'],
    ['45 dias', null],
    [null, null],
  ])('%s -> %s', (text, code) => expect(suggestPaymentTerm(text, terms)).toBe(code));

  // Descriptions as they appear in a real Omie account.
  const real = [
    { code: '000', description: 'A Vista', installments: 1 },
    { code: '001', description: '1 Parcela', installments: 1 },
    { code: '003', description: '3 Parcelas', installments: 3 },
    { code: 'A01', description: 'Para 1 dia', installments: 1 },
    { code: 'A28', description: 'Para 28 dias', installments: 1 },
    { code: 'A30', description: 'Para 30 dias', installments: 1 },
    { code: 'T54', description: 'Para 30 dias (R)', installments: 1 },
    { code: 'S01', description: '30/60', installments: 2 },
    { code: 'S10', description: '28/56', installments: 2 },
    { code: 'S29', description: 'A Vista/30/60', installments: 3 },
  ];
  it.each([
    ['28 dias', 'A28'],
    ['30 dias', 'A30'],
    ['30/60', 'S01'],
    ['28/56 dias', 'S10'],
    ['à vista', '000'],
    ['à vista/30/60', 'S29'],
    ['3 parcelas', '003'],
    ['1 dia', 'A01'],
  ])('real Omie terms: %s -> %s', (text, code) => expect(suggestPaymentTerm(text, real)).toBe(code));
});

describe('correctedFields', () => {
  it('lists only the fields the buyer changed', async () => {
    const { output } = await mockExtractor({ text: PRD_MESSAGE, today: '2026-09-25' });
    const base = {
      supplier: { new: { name: 'X' } },
      currency: 'USD' as const,
      delivery_days: 45,
      payment_terms_text: '28 dias',
      quote_date: '2026-09-25',
      source_text: PRD_MESSAGE,
      origin: 'whatsapp' as const,
      items: [{ description: 'Fonte Microsemi', brand: 'Microsemi', sku: null, quantity: 30, unit: 'un', unit_price: 111.46 }],
    };
    expect(correctedFields(output, base)).toEqual([]);
    expect(correctedFields(output, { ...base, freight_type: 'CIF', items: [{ ...base.items[0], sku: 'LRS-150-24' }] }).sort()).toEqual(['frete', 'itens.sku']);
  });
});
