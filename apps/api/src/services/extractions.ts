import { todayIso, type ExtractionRequest, type ExtractionResponse } from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { extractions } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { logEvent } from './events.js';
import { matchSupplier } from './suppliers.js';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const recent = new Map<string, number[]>();

function rateLimit(userId: string) {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) throw new HttpError(429, 'rate_limited', 'Muitas interpretações em sequência. Aguarde um minuto.');
  hits.push(now);
  recent.set(userId, hits);
}

export async function runExtraction(ctx: AppContext, member: Member, input: ExtractionRequest): Promise<ExtractionResponse> {
  rateLimit(member.userId);
  const result = await ctx.extractor({ text: input.text, contactName: input.contact_name, today: todayIso() });
  const [row] = await ctx.db
    .insert(extractions)
    .values({
      companyId: member.companyId,
      userId: member.userId,
      sourceText: input.text,
      contactName: input.contact_name ?? null,
      contactPhone: input.contact_phone ?? null,
      output: result.output,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    })
    .returning({ id: extractions.id });
  const supplierMatch = await matchSupplier(ctx, member.companyId, {
    contactPhone: input.contact_phone,
    contactName: input.contact_name,
    extractedName: result.output.fornecedor_nome,
  });
  await logEvent(ctx, {
    companyId: member.companyId,
    userId: member.userId,
    type: 'extraction_completed',
    entityId: row.id,
    data: { latency_ms: result.latencyMs, model: result.model, items: result.output.itens.length },
  });
  return { extraction_id: row.id, data: result.output, supplier_match: supplierMatch, latency_ms: result.latencyMs };
}
