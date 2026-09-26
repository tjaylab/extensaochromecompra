import { z } from 'zod';

// Plans and subscriptions. The catalog lives in code (not the database) so the API and the panel always agree;
// a company on "empresa" can have its own limits set by the ProcureMate team.

export const PLAN_IDS = ['essencial', 'profissional', 'empresa'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type BillingCycle = 'monthly' | 'yearly';
export type Feature = 'order_email' | 'reports' | 'priority_support';

export interface PlanLimits {
  /** Buyers (members plus pending invitations). null = unlimited. */
  seats: number | null;
  /** AI readings per billing period (messages, PDFs, images). */
  readings: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in BRL. */
  monthly: number;
  /** Yearly price in BRL: 10 months (2 free). */
  yearly: number;
  limits: PlanLimits;
  features: Feature[];
  /** What the plan card lists. */
  highlights: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  essencial: {
    id: 'essencial',
    name: 'Essencial',
    monthly: 197,
    yearly: 1970,
    limits: { seats: 1, readings: 300 },
    features: [],
    highlights: ['1 comprador', '300 leituras de IA por mês', 'Integração com o Omie'],
  },
  profissional: {
    id: 'profissional',
    name: 'Profissional',
    monthly: 497,
    yearly: 4970,
    limits: { seats: 3, readings: 1500 },
    features: ['order_email', 'reports'],
    highlights: ['Até 3 compradores', '1.500 leituras de IA por mês', 'Pedido por e-mail ao fornecedor', 'Relatórios'],
  },
  empresa: {
    id: 'empresa',
    name: 'Empresa',
    monthly: 1200,
    yearly: 12000,
    limits: { seats: null, readings: 5000 },
    features: ['order_email', 'reports', 'priority_support'],
    highlights: ['Compradores ilimitados', 'Leituras sob medida', 'Suporte prioritário'],
  },
};

/** New companies start here, for TRIAL_DAYS. */
export const TRIAL_PLAN: PlanId = 'profissional';
export const TRIAL_DAYS = 14;
/** Days an overdue subscription keeps working before AI readings stop. */
export const GRACE_DAYS = 7;
/** Share of the readings at which the panel warns. */
export const USAGE_WARNING = 0.8;

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: 'Em teste',
  active: 'Ativa',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
};

export interface BillingDTO {
  plan: Plan;
  status: SubscriptionStatus;
  cycle: BillingCycle;
  /** Effective limits (plan, custom overrides and extra readings). */
  limits: PlanLimits;
  period: { start: string; end: string };
  trial_ends_at: string | null;
  usage: { readings: number; seats: number };
  /** AI readings are allowed right now (not over the limit, subscription in good standing). */
  can_read: boolean;
  /** Why readings are blocked, for the panel. */
  blocked_reason: 'reading_limit' | 'subscription_inactive' | null;
  /** Payment page of the open invoice (Asaas), when there is one. */
  invoice_url: string | null;
  /** Online payment is set up on the server. */
  payments_enabled: boolean;
  plans: Plan[];
}

export const CheckoutInput = z.object({
  plan: z.enum(PLAN_IDS),
  cycle: z.enum(['monthly', 'yearly']).default('monthly'),
  billing_type: z.enum(['UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD']).default('UNDEFINED'),
  /** Needed by Asaas when the company has no CNPJ on file. */
  cnpj: z.string().nullish(),
  email: z.string().email('E-mail inválido').nullish(),
});
export type CheckoutInput = z.infer<typeof CheckoutInput>;

export interface CheckoutDTO {
  invoice_url: string | null;
  billing: BillingDTO;
}

// --- ProcureMate team (super admin) ---------------------------------------

export interface AdminCompanyDTO {
  id: string;
  name: string;
  cnpj: string | null;
  created_at: string;
  plan: PlanId;
  status: SubscriptionStatus;
  cycle: BillingCycle;
  period_end: string;
  trial_ends_at: string | null;
  seats: { used: number; limit: number | null };
  readings: { used: number; limit: number };
  /** AI tokens this period, for the cost estimate. */
  tokens: { input: number; output: number };
  asaas_subscription_id: string | null;
}

export const AdminSubscriptionInput = z.object({
  plan: z.enum(PLAN_IDS).optional(),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled']).optional(),
  cycle: z.enum(['monthly', 'yearly']).optional(),
  /** Extends the trial or the current period: ISO date. */
  trial_ends_at: z.string().nullish(),
  period_end: z.string().optional(),
  extra_readings: z.number().int().min(0).max(1_000_000).optional(),
  custom_seats: z.number().int().min(1).max(10_000).nullish(),
  custom_readings: z.number().int().min(0).max(10_000_000).nullish(),
  /** Marks the period as paid (manual billing): active until period_end or one cycle from today. */
  mark_paid: z.boolean().optional(),
});
export type AdminSubscriptionInput = z.infer<typeof AdminSubscriptionInput>;
