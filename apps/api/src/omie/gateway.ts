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

export interface OmieGateway {
  readonly mode: 'live' | 'mock';
  testConnection(): Promise<void>;
  listProducts(): Promise<OmieProductDTO[]>;
  listPaymentTerms(): Promise<OmiePaymentTermDTO[]>;
  findSupplierByCnpj(cnpj: string): Promise<number | null>;
  createSupplier(input: OmieSupplierInput): Promise<number>;
  upsertPurchaseOrder(input: OmieOrderInput): Promise<{ nCodPed: number; cNumero: string | null }>;
}
