import type { OmiePaymentTermDTO, OmieProductDTO } from '@compras/shared';
import { OmieError, type OmieGateway, type OmieOrderInput, type OmieSupplierInput } from './gateway.js';

// In-memory Omie for development and tests. State is kept per company for the process lifetime.

const PRODUCTS: OmieProductDTO[] = [
  { omie_id: 4100412, code: 'PRD-00412', description: 'Fonte chaveada 24V 10A', unit: 'UN' },
  { omie_id: 4100398, code: 'PRD-00398', description: 'Fonte chaveada 24V 5A', unit: 'UN' },
  { omie_id: 4100977, code: 'PRD-00977', description: 'Fonte trilho DIN 24V 10A', unit: 'UN' },
  { omie_id: 4100220, code: 'PRD-00220', description: 'Cabo PP 3x2,5mm', unit: 'M' },
  { omie_id: 4100551, code: 'PRD-00551', description: 'Parafuso inox M6 x 20', unit: 'UN' },
];

const TERMS: OmiePaymentTermDTO[] = [
  { code: '000', description: 'À vista', installments: 1 },
  { code: 'A28', description: '28 dias', installments: 1 },
  { code: 'A30', description: '30 dias', installments: 1 },
  { code: 'S36', description: '30/60 dias', installments: 2 },
  { code: 'T39', description: '30/60/90 dias', installments: 3 },
];

interface MockState {
  suppliers: Map<string, number>; // cnpj -> id
  orders: Map<string, { nCodPed: number; cNumero: string; input: OmieOrderInput }>;
  nextId: number;
  failNext: { message: string; retryable: boolean }[];
}

const states = new Map<string, MockState>();

export function mockState(companyId: string): MockState {
  let s = states.get(companyId);
  if (!s) {
    s = { suppliers: new Map(), orders: new Map(), nextId: 187, failNext: [] };
    states.set(companyId, s);
  }
  return s;
}

export class MockOmie implements OmieGateway {
  readonly mode = 'mock' as const;
  private s: MockState;

  constructor(companyId: string) {
    this.s = mockState(companyId);
  }

  private maybeFail() {
    const f = this.s.failNext.shift();
    if (f) throw new OmieError(f.message, f.retryable);
  }

  async testConnection() {}
  async listProducts() {
    return PRODUCTS;
  }
  async listPaymentTerms() {
    return TERMS;
  }
  async findSupplierByCnpj(cnpj: string) {
    return this.s.suppliers.get(cnpj) ?? null;
  }
  async createSupplier(input: OmieSupplierInput) {
    this.maybeFail();
    const existing = this.s.suppliers.get(input.cnpj);
    if (existing) return existing;
    const id = 9000000 + this.s.suppliers.size + 1;
    this.s.suppliers.set(input.cnpj, id);
    return id;
  }
  async upsertPurchaseOrder(input: OmieOrderInput) {
    this.maybeFail();
    if (!TERMS.some((t) => t.code === input.cCodParc)) throw new OmieError(`Parcela [${input.cCodParc}] não cadastrada`, false);
    for (const item of input.items) {
      if (!PRODUCTS.some((p) => p.omie_id === item.nCodProd)) throw new OmieError(`Produto [${item.nCodProd}] não encontrado`, false);
    }
    // Upsert semantics: same integration code updates the same order.
    const existing = this.s.orders.get(input.cCodIntPed);
    if (existing) {
      existing.input = input;
      return { nCodPed: existing.nCodPed, cNumero: existing.cNumero };
    }
    const n = this.s.nextId++;
    const order = { nCodPed: 7700000 + n, cNumero: String(n).padStart(6, '0'), input };
    this.s.orders.set(input.cCodIntPed, order);
    return { nCodPed: order.nCodPed, cNumero: order.cNumero };
  }
}
