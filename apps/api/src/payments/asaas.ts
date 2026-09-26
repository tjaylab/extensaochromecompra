import type { BillingCycle } from '@compras/shared';
import type { Config } from '../config.js';

// Asaas (asaas.com): customers, recurring subscriptions (Pix, boleto or card) and the invoice page the buyer pays on.
// Docs: https://docs.asaas.com — every call sends the account's API key in the "access_token" header.

export type BillingType = 'UNDEFINED' | 'PIX' | 'BOLETO' | 'CREDIT_CARD';

export interface SubscriptionInput {
  customer: string;
  value: number;
  cycle: BillingCycle;
  billingType: BillingType;
  description: string;
  /** Our company id: comes back on every payment webhook. */
  externalReference: string;
  nextDueDate: string; // YYYY-MM-DD
}

export interface PaymentsGateway {
  createCustomer(input: { name: string; cpfCnpj: string; email: string; externalReference: string }): Promise<string>;
  createSubscription(input: SubscriptionInput): Promise<string>;
  updateSubscription(id: string, input: Pick<SubscriptionInput, 'value' | 'cycle' | 'billingType' | 'description'>): Promise<void>;
  cancelSubscription(id: string): Promise<void>;
  /** Payment page of the subscription's first open (or latest) invoice. */
  invoiceUrl(subscriptionId: string): Promise<string | null>;
}

export class PaymentsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const CYCLE = { monthly: 'MONTHLY', yearly: 'YEARLY' } as const;

export class LiveAsaas implements PaymentsGateway {
  private base: string;

  constructor(
    private apiKey: string,
    env: 'sandbox' | 'production',
    private http: typeof fetch = fetch,
  ) {
    this.base = env === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.http(this.base + path, {
        method,
        headers: { access_token: this.apiKey, 'Content-Type': 'application/json', 'User-Agent': 'ProcureMate' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new PaymentsError(`Asaas indisponível: ${String((err as Error)?.message ?? err)}`, 503);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = (data?.errors as { description?: string }[] | undefined)?.map((e) => e.description).filter(Boolean).join('; ');
      throw new PaymentsError(msg || `Asaas respondeu ${res.status}`, res.status);
    }
    return data as T;
  }

  async createCustomer(input: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    const r = await this.call<{ id: string }>('POST', '/customers', { ...input, notificationDisabled: false });
    return r.id;
  }

  async createSubscription(input: SubscriptionInput) {
    const r = await this.call<{ id: string }>('POST', '/subscriptions', { ...input, cycle: CYCLE[input.cycle] });
    return r.id;
  }

  async updateSubscription(id: string, input: Pick<SubscriptionInput, 'value' | 'cycle' | 'billingType' | 'description'>) {
    await this.call('PUT', `/subscriptions/${encodeURIComponent(id)}`, { ...input, cycle: CYCLE[input.cycle], updatePendingPayments: true });
  }

  async cancelSubscription(id: string) {
    await this.call('DELETE', `/subscriptions/${encodeURIComponent(id)}`);
  }

  async invoiceUrl(subscriptionId: string) {
    const r = await this.call<{ data: { invoiceUrl?: string; status: string }[] }>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`);
    const open = r.data.find((p) => p.status === 'PENDING' || p.status === 'OVERDUE') ?? r.data[0];
    return open?.invoiceUrl ?? null;
  }
}

/** In-memory Asaas for tests and local development. */
export class MockAsaas implements PaymentsGateway {
  customers = new Map<string, { name: string; cpfCnpj: string; email: string; externalReference: string }>();
  subscriptions = new Map<string, SubscriptionInput & { canceled?: boolean }>();
  private seq = 0;

  async createCustomer(input: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    const id = `cus_mock${++this.seq}`;
    this.customers.set(id, input);
    return id;
  }
  async createSubscription(input: SubscriptionInput) {
    const id = `sub_mock${++this.seq}`;
    this.subscriptions.set(id, input);
    return id;
  }
  async updateSubscription(id: string, input: Pick<SubscriptionInput, 'value' | 'cycle' | 'billingType' | 'description'>) {
    const s = this.subscriptions.get(id);
    if (!s) throw new PaymentsError('Assinatura não encontrada', 404);
    this.subscriptions.set(id, { ...s, ...input });
  }
  async cancelSubscription(id: string) {
    const s = this.subscriptions.get(id);
    if (s) s.canceled = true;
  }
  async invoiceUrl(subscriptionId: string) {
    return this.subscriptions.has(subscriptionId) ? `https://sandbox.asaas.com/i/${subscriptionId}` : null;
  }
}

/** Live when an API key is set (or PAYMENTS_MODE=live), otherwise simulated; null = payments not set up. */
export function createPayments(cfg: Config): PaymentsGateway | null {
  const mode = cfg.PAYMENTS_MODE ?? (cfg.ASAAS_API_KEY ? 'live' : cfg.NODE_ENV === 'production' ? null : 'mock');
  if (mode === 'mock') return new MockAsaas();
  if (mode === 'live' && cfg.ASAAS_API_KEY) return new LiveAsaas(cfg.ASAAS_API_KEY, cfg.ASAAS_ENV);
  return null;
}
