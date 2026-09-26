import type {
  Attachment,
  ComparisonDTO,
  ConversationMessage,
  CreateQuoteInput,
  CreateRequisitionInput,
  ExtractionResponse,
  MeDTO,
  MetricsDTO,
  OmiePaymentTermDTO,
  OmieProductDTO,
  OrderDTO,
  QuoteDTO,
  RequisitionDTO,
  SupplierDTO,
  SupplierContextDTO,
  SupplierSearchDTO,
  RegisterOmieSupplierInput,
  UpdateOmiePhoneInput,
  ScanRequest,
  ScanResponse,
  LinkSupplierInput,
  UpdateOrderInput,
  UpdateQuoteInput,
} from '@compras/shared';
import { getToken } from './auth';
import { env } from './env';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(env.apiUrl + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique sua internet.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? `Erro ${res.status}`, e.details);
  }
  return data as T;
}

/** A file download (the order PDF), as a File named by the server. */
async function requestFile(path: string): Promise<File> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(env.apiUrl + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique sua internet.');
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => null))?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? `Erro ${res.status}`);
  }
  const blob = await res.blob();
  return new File([blob], res.headers.get('X-File-Name') ?? 'pedido.pdf', { type: blob.type || 'application/pdf' });
}

const qs = (params: Record<string, string | undefined | null>) => {
  const p = Object.entries(params).filter(([, v]) => v != null && v !== '') as [string, string][];
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};

export const api = {
  me: () => request<MeDTO>('GET', '/v1/me'),
  createCompany: (body: { name: string; cnpj?: string | null }) => request<MeDTO>('POST', '/v1/company', body),
  members: () => request<{ members: { email: string; role: string }[]; invitations: { email: string; role: string }[] }>('GET', '/v1/company/members'),
  invite: (email: string, role: 'admin' | 'buyer') => request('POST', '/v1/company/invitations', { email, role }),
  saveOmie: (app_key: string, app_secret: string) => request<{ status: string; checked_at: string }>('PUT', '/v1/company/omie-credentials', { app_key, app_secret }),
  checkOmie: () => request<{ status: string; checked_at: string; message: string | null }>('POST', '/v1/company/omie-check'),

  extract: (body: { text: string; conversation?: ConversationMessage[] | null; attachments?: Attachment[] | null; contact_name?: string | null; contact_phone?: string | null }) =>
    request<ExtractionResponse>('POST', '/v1/extractions', body),

  suppliers: (q?: string) => request<SupplierDTO[]>('GET', `/v1/suppliers${qs({ q })}`),
  supplierContext: (name: string | null, phone: string | null) =>
    request<SupplierContextDTO>('GET', `/v1/suppliers/context${qs({ name, phone })}`),
  linkSupplier: (body: LinkSupplierInput) => request<SupplierContextDTO>('POST', '/v1/suppliers/link', body),
  searchSuppliers: (q: string) => request<SupplierSearchDTO>('GET', `/v1/suppliers/search${qs({ q })}`),
  registerOmieSupplier: (body: RegisterOmieSupplierInput) => request<SupplierContextDTO>('POST', '/v1/suppliers/omie', body),
  updateOmiePhone: (body: UpdateOmiePhoneInput) => request<SupplierContextDTO>('POST', '/v1/suppliers/omie-phone', body),
  scan: (body: ScanRequest) => request<ScanResponse>('POST', '/v1/extractions/scan', body),
  updateSupplier: (id: string, body: Partial<Pick<SupplierDTO, 'name' | 'phone' | 'cnpj' | 'email'>>) => request<SupplierDTO>('PATCH', `/v1/suppliers/${id}`, body),

  createQuote: (body: CreateQuoteInput) => request<QuoteDTO>('POST', '/v1/quotes', body),
  quotes: (f: { status?: string; supplier_id?: string; requisition_id?: string; from?: string; to?: string } = {}) => request<QuoteDTO[]>('GET', `/v1/quotes${qs(f)}`),
  quote: (id: string) => request<QuoteDTO>('GET', `/v1/quotes/${id}`),
  updateQuote: (id: string, body: UpdateQuoteInput) => request<QuoteDTO>('PATCH', `/v1/quotes/${id}`, body),

  requisitions: (status?: string) => request<RequisitionDTO[]>('GET', `/v1/requisitions${qs({ status })}`),
  createRequisition: (body: CreateRequisitionInput) => request<RequisitionDTO>('POST', '/v1/requisitions', body),
  comparison: (id: string) => request<ComparisonDTO>('GET', `/v1/requisitions/${id}/comparison`),

  products: (q?: string) => request<OmieProductDTO[]>('GET', `/v1/omie/products${qs({ q })}`),
  paymentTerms: () => request<OmiePaymentTermDTO[]>('GET', '/v1/omie/payment-terms'),
  syncOmie: () => request('POST', '/v1/omie/sync'),

  createOrder: (quote_id: string) => request<OrderDTO>('POST', '/v1/purchase-orders', { quote_id }),
  orders: () => request<OrderDTO[]>('GET', '/v1/purchase-orders'),
  order: (id: string) => request<OrderDTO>('GET', `/v1/purchase-orders/${id}`),
  updateOrder: (id: string, body: UpdateOrderInput) => request<OrderDTO>('PATCH', `/v1/purchase-orders/${id}`, body),
  sendOrder: (id: string) => request<OrderDTO>('POST', `/v1/purchase-orders/${id}/send`),
  orderPdf: (id: string) => requestFile(`/v1/purchase-orders/${id}/pdf`),
  emailOrder: (id: string, to: string, message?: string) => request<{ sent: boolean; to: string }>('POST', `/v1/purchase-orders/${id}/email`, { to, message }),

  event: (type: string, entity_id?: string, data?: Record<string, unknown>) => request('POST', '/v1/events', { type, entity_id, data }).catch(() => {}),
  metrics: () => request<MetricsDTO>('GET', '/v1/metrics'),
};
