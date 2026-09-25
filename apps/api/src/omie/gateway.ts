import type { OmiePaymentTermDTO, OmieProductDTO } from '@compras/shared';

export class OmieError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public faultCode?: string,
  ) {
    super(message);
  }
}

export interface OmieSupplierInput {
  integrationCode: string; // our supplier id
  name: string;
  cnpj: string; // digits only
  phone?: string | null; // E.164
  email?: string | null;
}

export interface OmieOrderInput {
  cCodIntPed: string;
  nCodFor: number;
  cCodParc: string;
  nQtdeParc: number | null;
  dDtPrevisao: string | null; // DD/MM/YYYY
  cObs: string;
  cContato: string | null;
  items: { cCodIntItem: string; nCodProd: number; nQtde: number; nValUnit: number }[];
  freight: { cTpFrete: string | null; nValFrete: number | null } | null;
}

export interface OmieSupplierRecord {
  omie_id: number;
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  phones: { ddd: string | null; number: string }[];
  email: string | null;
  tags: string[];
}

export interface OmiePurchaseOrderRecord {
  omie_id: number;
  number: string | null;
  supplier_omie_id: number;
  created_on: string; // DD/MM/YYYY as Omie returns it
  stage: string | null;
  items: { omie_product_id: number | null; description: string; quantity: number; unit_price: number; total: number }[];
  freight: number;
}

export interface OmieGateway {
  /** Suppliers and clients (Omie keeps both in the same register; tags tell them apart). */
  listSuppliers(): Promise<OmieSupplierRecord[]>;
  /** Purchase orders created between two dates (DD/MM/YYYY), cancelled ones excluded. */
  listPurchaseOrders(from: string, to: string): Promise<OmiePurchaseOrderRecord[]>;
  readonly mode: 'live' | 'mock';
  testConnection(): Promise<void>;
  listProducts(): Promise<OmieProductDTO[]>;
  listPaymentTerms(): Promise<OmiePaymentTermDTO[]>;
  findSupplierByCnpj(cnpj: string): Promise<number | null>;
  createSupplier(input: OmieSupplierInput): Promise<number>;
  upsertPurchaseOrder(input: OmieOrderInput): Promise<{ nCodPed: number; cNumero: string | null }>;
}
