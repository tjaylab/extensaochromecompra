import { and, eq } from 'drizzle-orm';
import type { MetricsDTO } from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { memberships, purchaseOrders, quotes } from '../db/schema.js';
import { forbidden } from '../lib/errors.js';

/** Pilot indicators from the PRD: time per quote, recurring use, extraction quality. */
export async function getMetrics(ctx: AppContext, member: Member): Promise<MetricsDTO> {
  if (member.role !== 'admin') throw forbidden('Apenas administradores veem as métricas');
  const qs = await ctx.db
    .select({ origin: quotes.origin, ms: quotes.registrationMs, extraction: quotes.extractionId, corrected: quotes.correctedFields, by: quotes.createdBy })
    .from(quotes)
    .where(eq(quotes.companyId, member.companyId));
  const members = await ctx.db.select().from(memberships).where(eq(memberships.companyId, member.companyId));
  const sent = await ctx.db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.companyId, member.companyId), eq(purchaseOrders.status, 'sent')));

  const times = qs
    .filter((q) => q.origin === 'whatsapp' && q.ms != null)
    .map((q) => q.ms! / 1000)
    .sort((a, b) => a - b);
  const median = times.length ? (times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2) : null;
  const extracted = qs.filter((q) => q.extraction);
  const fieldCounts = new Map<string, number>();
  for (const q of extracted) for (const f of q.corrected) fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
  const byUser = new Map<string, number>();
  for (const q of qs) byUser.set(q.by, (byUser.get(q.by) ?? 0) + 1);

  return {
    quotes_total: qs.length,
    quotes_whatsapp: qs.filter((q) => q.origin === 'whatsapp').length,
    median_registration_seconds: median != null ? Math.round(median) : null,
    under_one_minute_pct: times.length ? Math.round((100 * times.filter((t) => t < 60).length) / times.length) : null,
    corrected_fields_pct: extracted.length ? Math.round((100 * extracted.filter((q) => q.corrected.length).length) / extracted.length) : null,
    corrected_by_field: [...fieldCounts.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
    quotes_by_user: [...byUser.entries()]
      .map(([userId, count]) => ({ email: members.find((m) => m.userId === userId)?.email ?? 'usuário removido', count }))
      .sort((a, b) => b.count - a.count),
    orders_sent: sent.length,
  };
}
