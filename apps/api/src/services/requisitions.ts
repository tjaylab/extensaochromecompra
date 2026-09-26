import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { requisitionNumber, type ComparisonDTO, type CreateRequisitionInput, type RequisitionDTO } from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { quotes, requisitionItems, requisitions } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { loadQuotes } from './quotes.js';

async function toDTOs(ctx: AppContext, rows: (typeof requisitions.$inferSelect)[]): Promise<RequisitionDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = await ctx.db.select().from(requisitionItems).where(inArray(requisitionItems.requisitionId, ids)).orderBy(requisitionItems.position);
  const qs = await ctx.db
    .select({ id: quotes.id, requisitionId: quotes.requisitionId })
    .from(quotes)
    .where(and(inArray(quotes.requisitionId, ids), ne(quotes.status, 'discarded')));
  return rows.map((r) => ({
    id: r.id,
    number: requisitionNumber(r.seq),
    title: r.title,
    status: r.status,
    items: items.filter((i) => i.requisitionId === r.id).map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit })),
    quote_count: qs.filter((q) => q.requisitionId === r.id).length,
    created_at: r.createdAt,
  }));
}

export async function listRequisitions(ctx: AppContext, member: Member, status?: string) {
  const where = status
    ? and(eq(requisitions.companyId, member.companyId), eq(requisitions.status, status as 'open'))
    : eq(requisitions.companyId, member.companyId);
  const rows = await ctx.db.select().from(requisitions).where(where).orderBy(desc(requisitions.createdAt), desc(requisitions.seq)).limit(200);
  return toDTOs(ctx, rows);
}

export async function getRequisition(ctx: AppContext, member: Member, id: string) {
  const [r] = await ctx.db.select().from(requisitions).where(and(eq(requisitions.id, id), eq(requisitions.companyId, member.companyId))).limit(1);
  if (!r) throw notFound('Comparativo');
  return (await toDTOs(ctx, [r]))[0];
}

export async function createRequisition(ctx: AppContext, member: Member, input: CreateRequisitionInput) {
  const [r] = await ctx.db.insert(requisitions).values({ companyId: member.companyId, title: input.title, createdBy: member.userId }).returning();
  if (input.items.length) {
    await ctx.db.insert(requisitionItems).values(
      input.items.map((i, idx) => ({ requisitionId: r.id, position: idx + 1, description: i.description, quantity: i.quantity, unit: i.unit ?? null })),
    );
  }
  return getRequisition(ctx, member, r.id);
}

/** Proposals side by side, with neutral badges. No automatic recommendation and no currency conversion. */
export async function getComparison(ctx: AppContext, member: Member, id: string): Promise<ComparisonDTO> {
  const requisition = await getRequisition(ctx, member, id);
  const qs = await loadQuotes(ctx, member.companyId, [eq(quotes.requisitionId, id), ne(quotes.status, 'discarded')]);
  const withDays = qs.filter((q) => q.delivery_days != null);
  const minDays = withDays.length > 1 ? Math.min(...withDays.map((q) => q.delivery_days!)) : null;
  const byCurrency = new Map<string, number[]>();
  for (const q of qs) byCurrency.set(q.currency, [...(byCurrency.get(q.currency) ?? []), q.total]);
  return {
    requisition,
    quotes: qs
      .slice()
      .reverse()
      .map((q) => {
        const badges: string[] = [];
        if (minDays != null && q.delivery_days === minDays) badges.push('Menor prazo');
        const totals = byCurrency.get(q.currency)!;
        if (totals.length > 1 && q.total === Math.min(...totals)) badges.push(`Menor total em ${q.currency}`);
        return { ...q, badges };
      }),
  };
}
