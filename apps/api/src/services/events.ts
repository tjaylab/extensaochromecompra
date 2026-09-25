import type { AppContext } from '../context.js';
import { events } from '../db/schema.js';

export async function logEvent(
  ctx: AppContext,
  e: { companyId: string | null; userId: string | null; type: string; entityId?: string | null; data?: Record<string, unknown> | null },
) {
  try {
    await ctx.db.insert(events).values({
      companyId: e.companyId,
      userId: e.userId,
      type: e.type,
      entityId: e.entityId ?? null,
      data: e.data ?? null,
    });
  } catch (err) {
    // Instrumentation never breaks the user's action.
    ctx.log.warn({ err: String(err), type: e.type }, 'failed to log event');
  }
}
