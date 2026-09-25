import { createHash } from 'node:crypto';
import { formatConversation, todayIso, type Attachment, type ConversationMessage, type ExtractionRequest, type ExtractionResponse } from '@compras/shared';
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
  const conversation = input.conversation?.filter((m) => m.text.trim()) ?? null;
  const attachments = input.attachments ?? [];
  const result = await ctx.extractor({ text: input.text, conversation, attachments, contactName: input.contact_name, today: todayIso() });
  // Everything sent to the model is kept on the extraction (audit and quality review). Files are
  // referenced by name, size and hash, not stored.
  const files = attachments.map((a) => attachmentLabel(a));
  const sent = [
    conversation?.length ? formatConversation(conversation) : null,
    input.text ? `Seleção: ${input.text}` : null,
    files.length ? files.map((f, i) => `${f} sha256:${createHash('sha256').update(attachments[i]!.data, 'base64').digest('hex').slice(0, 16)}`).join('\n') : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  const [row] = await ctx.db
    .insert(extractions)
    .values({
      companyId: member.companyId,
      userId: member.userId,
      sourceText: sent,
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
  return {
    extraction_id: row.id,
    data: result.output,
    source_text: withDocument(sourceExcerpt(input.text, conversation, result.output.mensagens_usadas), files, result.output.trecho_documento),
    supplier_match: supplierMatch,
    latency_ms: result.latencyMs,
  };
}

export function attachmentLabel(a: Attachment): string {
  const kb = Math.round((a.data.length * 3) / 4 / 1024);
  return `Arquivo: ${a.name?.trim() || (a.media_type === 'application/pdf' ? 'documento.pdf' : 'imagem')} (${a.media_type}, ${kb} KB)`;
}

/** With attachments, the quote keeps the file references and the lines the model transcribed from them. */
export function withDocument(excerpt: string, files: string[], transcript: string | null): string {
  if (!files.length) return excerpt;
  const doc = [files.join('\n'), transcript ? `Trecho do documento:\n${transcript}` : null].filter(Boolean).join('\n');
  return excerpt ? `${doc}\n\n${excerpt}` : doc;
}

/**
 * The original text the quote keeps: the selection when there is one, otherwise the messages the model
 * says it used (never the whole conversation, which may hold unrelated talk).
 */
export function sourceExcerpt(selection: string, conversation: ConversationMessage[] | null, used: number[]): string {
  const valid = used.filter((n) => conversation && n <= conversation.length);
  if (selection.trim()) {
    const context = conversation && valid.length ? formatConversation(conversation, { only: valid }) : '';
    return context && !context.includes(selection.trim()) ? `${selection.trim()}\n\nContexto da conversa:\n${context}` : selection.trim();
  }
  if (conversation?.length) return formatConversation(conversation, valid.length ? { only: valid } : {});
  return '';
}
