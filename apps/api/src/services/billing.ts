import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  GRACE_DAYS,
  isValidCnpj,
  onlyDigits,
  PLAN_IDS,
  planPrice,
  PLANS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  type AdminCompanyDTO,
  type AdminSubscriptionInput,
  type BillingDTO,
  type CheckoutDTO,
  type CheckoutInput,
  type Feature,
  type PlanLimits,
  type SubscriptionStatus,
} from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { aiUsage, companies, invitations, memberships, subscriptions } from '../db/schema.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { PaymentsError } from '../payments/asaas.js';
import { logEvent } from './events.js';

type Subscription = typeof subscriptions.$inferSelect;

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

/** The company's subscription; companies without one start the trial now. */
export async function ensureSubscription(ctx: AppContext, companyId: string): Promise<Subscription> {
  const [found] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1);
  if (found) return found;
  const now = new Date();
  const ends = iso(new Date(now.getTime() + TRIAL_DAYS * DAY));
  await ctx.db
    .insert(subscriptions)
    .values({ companyId, plan: TRIAL_PLAN, status: 'trialing', trialEndsAt: ends, periodStart: iso(now), periodEnd: ends })
    .onConflictDoNothing();
  const [s] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1);
  return s!;
}

export function limitsOf(s: Subscription): PlanLimits {
  const plan = PLANS[s.plan] ?? PLANS[TRIAL_PLAN];
  return {
    seats: s.customSeats ?? plan.limits.seats,
    readings: (s.customReadings ?? plan.limits.readings) + s.extraReadings,
  };
}

/** Readings are counted per month, also on yearly plans: from the latest monthly anniversary of the period start. */
export function usageWindow(s: Subscription, now = new Date()): { start: Date; end: Date } {
  const start = new Date(s.periodStart);
  if (s.status === 'trialing') return { start, end: new Date(s.trialEndsAt ?? s.periodEnd) };
  let from = start;
  for (let i = 0; i < 240 && addMonths(from, 1) <= now; i++) from = addMonths(from, 1);
  return { start: from, end: addMonths(from, 1) };
}

/** Status as the buyer sees it, and whether AI readings still run. */
export function standing(s: Subscription, now = new Date()): { status: SubscriptionStatus; inactive: boolean } {
  if (s.status === 'canceled') return { status: 'canceled', inactive: true };
  if (s.status === 'trialing') return { status: 'trialing', inactive: now > new Date(s.trialEndsAt ?? s.periodEnd) };
  const end = new Date(s.periodEnd);
  const status: SubscriptionStatus = s.status === 'past_due' || now > end ? 'past_due' : 'active';
  return { status, inactive: now.getTime() > end.getTime() + GRACE_DAYS * DAY };
}

async function readingsSince(ctx: AppContext, companyId: string, since: Date) {
  const [r] = await ctx.db
    .select({ n: count(), input: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)`, output: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.companyId, companyId), gte(aiUsage.createdAt, iso(since))));
  return { readings: Number(r?.n ?? 0), input: Number(r?.input ?? 0), output: Number(r?.output ?? 0) };
}

async function seatsUsed(ctx: AppContext, companyId: string) {
  const [m] = await ctx.db.select({ n: count() }).from(memberships).where(eq(memberships.companyId, companyId));
  const [i] = await ctx.db
    .select({ n: count() })
    .from(invitations)
    .where(and(eq(invitations.companyId, companyId), isNull(invitations.acceptedAt)));
  return Number(m?.n ?? 0) + Number(i?.n ?? 0);
}

async function evaluate(ctx: AppContext, companyId: string) {
  const s = await ensureSubscription(ctx, companyId);
  const limits = limitsOf(s);
  const window = usageWindow(s);
  const used = await readingsSince(ctx, companyId, window.start);
  const st = standing(s);
  const blocked: BillingDTO['blocked_reason'] = st.inactive ? 'subscription_inactive' : used.readings >= limits.readings ? 'reading_limit' : null;
  return { s, limits, window, used, st, blocked };
}

export async function getBilling(ctx: AppContext, member: Member): Promise<BillingDTO> {
  const { s, limits, window, used, st, blocked } = await evaluate(ctx, member.companyId);
  return {
    plan: PLANS[s.plan],
    status: st.status,
    cycle: s.cycle,
    limits,
    period: { start: iso(window.start), end: iso(window.end) },
    trial_ends_at: s.trialEndsAt,
    usage: { readings: used.readings, seats: await seatsUsed(ctx, member.companyId) },
    can_read: !blocked,
    blocked_reason: blocked,
    invoice_url: st.status === 'active' ? null : s.invoiceUrl,
    payments_enabled: !!ctx.payments,
    discount_percent: s.discountPercent,
    plans: PLAN_IDS.map((id) => PLANS[id]),
  };
}

// --- Enforcement ------------------------------------------------------------------------------

/** Called before every AI call. */
export async function assertCanRead(ctx: AppContext, companyId: string) {
  const { blocked, limits, s } = await evaluate(ctx, companyId);
  if (blocked === 'subscription_inactive') {
    throw new HttpError(
      402,
      'subscription_inactive',
      s.status === 'trialing'
        ? 'O período de teste terminou. Escolha um plano em Gestão > Plano e uso para a IA voltar a ler as cotações.'
        : 'A assinatura está inativa ou com pagamento em atraso. Regularize em Gestão > Plano e uso para a IA voltar a ler.',
    );
  }
  if (blocked === 'reading_limit') {
    throw new HttpError(
      402,
      'reading_limit',
      `As ${limits.readings.toLocaleString('pt-BR')} leituras de IA do seu plano acabaram neste mês. Você ainda pode registrar cotações à mão, ou mudar de plano em Gestão > Plano e uso.`,
    );
  }
}

export async function recordUsage(ctx: AppContext, member: Member, kind: 'extraction' | 'scan', tokens: { inputTokens: number | null; outputTokens: number | null }) {
  await ctx.db.insert(aiUsage).values({ companyId: member.companyId, userId: member.userId, kind, inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens });
}

export async function assertSeat(ctx: AppContext, companyId: string) {
  const s = await ensureSubscription(ctx, companyId);
  const { seats } = limitsOf(s);
  if (seats != null && (await seatsUsed(ctx, companyId)) >= seats) {
    throw new HttpError(402, 'seat_limit', `Seu plano permite ${seats === 1 ? '1 comprador' : `${seats} compradores`}. Mude de plano em Gestão > Plano e uso para convidar mais pessoas.`);
  }
}

export async function assertFeature(ctx: AppContext, companyId: string, feature: Feature, label: string) {
  const s = await ensureSubscription(ctx, companyId);
  if (!PLANS[s.plan].features.includes(feature)) {
    throw new HttpError(402, 'feature_unavailable', `${label} faz parte do plano Profissional. Mude de plano em Gestão > Plano e uso.`);
  }
}

// --- Checkout (Asaas) -------------------------------------------------------------------------

export async function checkout(ctx: AppContext, member: Member, input: CheckoutInput): Promise<CheckoutDTO> {
  if (member.role !== 'admin') throw forbidden('Apenas administradores mudam o plano');
  const payments = ctx.payments;
  if (!payments) throw new HttpError(409, 'payments_not_configured', 'O pagamento online ainda não está ativo. Fale com a equipe ProcureMate para mudar de plano.');
  const plan = PLANS[input.plan];
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, member.companyId)).limit(1);
  const cnpj = onlyDigits(input.cnpj || company!.cnpj || '');
  if (!isValidCnpj(cnpj)) throw badRequest('Informe o CNPJ da empresa para emitir a cobrança');
  if (cnpj !== company!.cnpj) await ctx.db.update(companies).set({ cnpj }).where(eq(companies.id, member.companyId));

  const s = await ensureSubscription(ctx, member.companyId);
  const value = planPrice(plan, input.cycle, s.discountPercent);
  const description = `ProcureMate ${plan.name} (${input.cycle === 'yearly' ? 'anual' : 'mensal'})${s.discountPercent ? ` · ${s.discountPercent}% de desconto` : ''}`;
  try {
    const customer =
      s.asaasCustomerId ?? (await payments.createCustomer({ name: company!.name, cpfCnpj: cnpj, email: input.email || member.email, externalReference: member.companyId }));
    let subscriptionId = s.asaasSubscriptionId;
    if (subscriptionId) {
      await payments.updateSubscription(subscriptionId, { value, cycle: input.cycle, billingType: input.billing_type, description });
    } else {
      subscriptionId = await payments.createSubscription({
        customer,
        value,
        cycle: input.cycle,
        billingType: input.billing_type,
        description,
        externalReference: member.companyId,
        nextDueDate: new Date().toISOString().slice(0, 10),
      });
    }
    const invoiceUrl = await payments.invoiceUrl(subscriptionId);
    // The new plan applies right away; the status turns "active" when Asaas confirms the payment.
    await ctx.db
      .update(subscriptions)
      .set({ plan: input.plan, cycle: input.cycle, asaasCustomerId: customer, asaasSubscriptionId: subscriptionId, invoiceUrl, updatedAt: iso(new Date()) })
      .where(eq(subscriptions.companyId, member.companyId));
    await logEvent(ctx, { companyId: member.companyId, userId: member.userId, type: 'plan_checkout', data: { plan: input.plan, cycle: input.cycle, value } });
    return { invoice_url: invoiceUrl, billing: await getBilling(ctx, member) };
  } catch (err) {
    if (err instanceof PaymentsError) throw new HttpError(err.status >= 500 ? 503 : 400, 'payments_error', `Não foi possível gerar a cobrança: ${err.message}`);
    throw err;
  }
}

/** Asaas webhook: payment confirmed / overdue, subscription removed. Idempotent. */
export async function handleAsaasWebhook(ctx: AppContext, token: string | undefined, body: unknown) {
  if (!ctx.cfg.ASAAS_WEBHOOK_TOKEN) throw new HttpError(503, 'webhook_not_configured', 'Webhook não configurado');
  if (token !== ctx.cfg.ASAAS_WEBHOOK_TOKEN) throw new HttpError(401, 'unauthorized', 'Token do webhook inválido');
  const e = body as { event?: string; payment?: { id?: string; subscription?: string; externalReference?: string; dueDate?: string; paymentDate?: string; invoiceUrl?: string }; subscription?: { id?: string; externalReference?: string } };
  const subId = e.payment?.subscription ?? e.subscription?.id ?? null;
  const ref = e.payment?.externalReference ?? e.subscription?.externalReference ?? null;
  const [s] = subId
    ? await ctx.db.select().from(subscriptions).where(eq(subscriptions.asaasSubscriptionId, subId)).limit(1)
    : ref
      ? await ctx.db.select().from(subscriptions).where(eq(subscriptions.companyId, ref)).limit(1)
      : [];
  if (!s) return { ok: true, ignored: 'unknown subscription' };

  const now = new Date();
  const set: Partial<Subscription> = { updatedAt: iso(now) };
  switch (e.event) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED': {
      // The paid invoice covers one cycle from its due date (or from today, if paid late after the period ended).
      const due = e.payment?.dueDate ? new Date(`${e.payment.dueDate}T00:00:00Z`) : now;
      const start = due.getTime() > now.getTime() - 45 * DAY ? due : now;
      Object.assign(set, {
        status: 'active',
        periodStart: iso(start),
        periodEnd: iso(addMonths(start, s.cycle === 'yearly' ? 12 : 1)),
        trialEndsAt: null,
        extraReadings: 0,
        invoiceUrl: null,
      });
      break;
    }
    case 'PAYMENT_OVERDUE':
      Object.assign(set, { status: 'past_due', invoiceUrl: e.payment?.invoiceUrl ?? s.invoiceUrl });
      break;
    case 'PAYMENT_CREATED':
      Object.assign(set, { invoiceUrl: e.payment?.invoiceUrl ?? s.invoiceUrl });
      break;
    case 'SUBSCRIPTION_DELETED':
    case 'SUBSCRIPTION_INACTIVATED':
      Object.assign(set, { status: 'canceled' });
      break;
    default:
      return { ok: true, ignored: e.event ?? 'no event' };
  }
  await ctx.db.update(subscriptions).set(set).where(eq(subscriptions.companyId, s.companyId));
  await logEvent(ctx, { companyId: s.companyId, userId: null, type: 'billing_webhook', data: { event: e.event, payment: e.payment?.id ?? null } });
  return { ok: true };
}

// --- ProcureMate team -------------------------------------------------------------------------

export function isSuperadmin(ctx: AppContext, email: string | null | undefined) {
  const list = (ctx.cfg.SUPERADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

function assertSuperadmin(ctx: AppContext, email: string) {
  if (!isSuperadmin(ctx, email)) throw forbidden('Área restrita à equipe ProcureMate');
}

async function adminRow(ctx: AppContext, c: typeof companies.$inferSelect): Promise<AdminCompanyDTO> {
  const { s, limits, used, st } = await evaluate(ctx, c.id);
  return {
    id: c.id,
    name: c.name,
    cnpj: c.cnpj,
    created_at: c.createdAt,
    plan: s.plan,
    status: st.inactive && st.status === 'trialing' ? 'canceled' : st.status,
    cycle: s.cycle,
    period_end: s.status === 'trialing' ? (s.trialEndsAt ?? s.periodEnd) : s.periodEnd,
    trial_ends_at: s.trialEndsAt,
    seats: { used: await seatsUsed(ctx, c.id), limit: limits.seats },
    readings: { used: used.readings, limit: limits.readings },
    tokens: { input: used.input, output: used.output },
    asaas_subscription_id: s.asaasSubscriptionId,
    discount_percent: s.discountPercent,
  };
}

export async function adminListCompanies(ctx: AppContext, email: string): Promise<AdminCompanyDTO[]> {
  assertSuperadmin(ctx, email);
  const all = await ctx.db.select().from(companies).orderBy(companies.createdAt);
  return Promise.all(all.map((c) => adminRow(ctx, c)));
}

export async function adminUpdateSubscription(ctx: AppContext, email: string, companyId: string, input: AdminSubscriptionInput): Promise<AdminCompanyDTO> {
  assertSuperadmin(ctx, email);
  const [c] = await ctx.db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw notFound('Empresa');
  const s = await ensureSubscription(ctx, companyId);
  const now = new Date();
  const set: Partial<Subscription> = { updatedAt: iso(now) };
  if (input.plan) set.plan = input.plan;
  if (input.cycle) set.cycle = input.cycle;
  if (input.status) set.status = input.status;
  if (input.extra_readings !== undefined) set.extraReadings = input.extra_readings;
  if (input.custom_seats !== undefined) set.customSeats = input.custom_seats;
  if (input.custom_readings !== undefined) set.customReadings = input.custom_readings;
  if (input.discount_percent !== undefined) set.discountPercent = input.discount_percent;
  if (input.trial_ends_at !== undefined) {
    set.trialEndsAt = input.trial_ends_at ? iso(new Date(input.trial_ends_at)) : null;
    if (set.trialEndsAt && (input.status ?? s.status) === 'trialing') set.periodEnd = set.trialEndsAt;
  }
  if (input.period_end) set.periodEnd = iso(new Date(input.period_end));
  if (input.mark_paid) {
    const cycle = input.cycle ?? s.cycle;
    Object.assign(set, {
      status: 'active',
      periodStart: iso(now),
      periodEnd: input.period_end ? iso(new Date(input.period_end)) : iso(addMonths(now, cycle === 'yearly' ? 12 : 1)),
      trialEndsAt: null,
      invoiceUrl: null,
    });
  }
  await ctx.db.update(subscriptions).set(set).where(eq(subscriptions.companyId, companyId));
  // Keep the Asaas subscription's price in step with the plan and the discount.
  if (s.asaasSubscriptionId && ctx.payments && (input.plan || input.cycle || input.discount_percent !== undefined)) {
    const plan = PLANS[input.plan ?? s.plan];
    const cycle = input.cycle ?? s.cycle;
    const discount = input.discount_percent ?? s.discountPercent;
    try {
      await ctx.payments.updateSubscription(s.asaasSubscriptionId, {
        value: planPrice(plan, cycle, discount),
        cycle,
        billingType: 'UNDEFINED',
        description: `ProcureMate ${plan.name} (${cycle === 'yearly' ? 'anual' : 'mensal'})${discount ? ` · ${discount}% de desconto` : ''}`,
      });
    } catch (err) {
      throw new HttpError(502, 'payments_error', `Salvo no ProcureMate, mas o Asaas recusou a atualização: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await logEvent(ctx, { companyId, userId: null, type: 'subscription_admin_update', data: { by: email, ...input } });
  return adminRow(ctx, c);
}
