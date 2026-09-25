import type { OmiePaymentTermDTO, OmieProductDTO } from '@compras/shared';
import {
  OmieError,
  type OmieGateway,
  type OmieOrderInput,
  type OmiePurchaseOrderRecord,
  type OmieSupplierInput,
  type OmieSupplierRecord,
} from './gateway.js';

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

const SUPPLIERS: OmieSupplierRecord[] = [
  { omie_id: 9100001, name: 'MICROSEMI DISTRIBUIDORA LTDA', trade_name: 'Microsemi', cnpj: '04252011000110', phones: [{ ddd: '11', number: '7000-1234' }], email: 'vendas@microsemi.example', tags: ['Fornecedor'] },
  { omie_id: 9100002, name: 'ELETRONICA PAULISTA COMERCIO LTDA', trade_name: 'Eletrônica Paulista', cnpj: '11222333000181', phones: [{ ddd: '11', number: '3222-4100' }], email: null, tags: ['Fornecedor'] },
  { omie_id: 9100003, name: 'TECNOPARTS IMPORTACAO LTDA', trade_name: 'Tecnoparts', cnpj: '11444777000161', phones: [{ ddd: '19', number: '99810-2233' }], email: null, tags: ['Fornecedor', 'Transportadora'] },
  // Same phone as Microsemi but registered as a client: the supplier must win.
  { omie_id: 9100004, name: 'CARLOS ALBERTO ME', trade_name: null, cnpj: null, phones: [{ ddd: '11', number: '97000-1234' }], email: null, tags: ['Cliente'] },
];

/** DD/MM/YYYY, `days` before today. */
function daysAgo(days: number) {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function mockOrders(): OmiePurchaseOrderRecord[] {
  const fonte = { omie_product_id: 4100412, description: 'Fonte chaveada 24V 10A' };
  return [
    { omie_id: 7701001, number: '1301', supplier_omie_id: 9100001, created_on: daysAgo(20), stage: '15', freight: 0, items: [{ ...fonte, quantity: 20, unit_price: 598.5, total: 11970 }] },
    { omie_id: 7701002, number: '1288', supplier_omie_id: 9100001, created_on: daysAgo(75), stage: '15', freight: 0, items: [{ ...fonte, quantity: 10, unit_price: 612, total: 6120 }, { omie_product_id: 4100398, description: 'Fonte chaveada 24V 5A', quantity: 15, unit_price: 310, total: 4650 }] },
    { omie_id: 7701003, number: '1250', supplier_omie_id: 9100001, created_on: daysAgo(160), stage: '15', freight: 0, items: [{ ...fonte, quantity: 12, unit_price: 620, total: 7440 }] },
    { omie_id: 7701004, number: '1299', supplier_omie_id: 9100002, created_on: daysAgo(30), stage: '15', freight: 0, items: [{ omie_product_id: 4100220, description: 'Cabo PP 3x2,5mm', quantity: 500, unit_price: 8.42, total: 4210 }] },
  ];
}

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
  async listSuppliers() {
    return SUPPLIERS;
  }
  async listPurchaseOrders() {
    return mockOrders();
  }
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
