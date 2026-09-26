import { and, desc, eq, gte, inArray, lte, ne, type SQL } from 'drizzle-orm';
import {
  brToIso,
  quoteNumber,
  requisitionNumber,
  type CreateQuoteInput,
  type ExtractionOutput,
  type QuoteDTO,
  type QuoteStatus,
  type UpdateQuoteInput,
} from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { extractions, quoteItems, quotes, requisitions, suppliers } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logEvent } from './events.js';
import { findOrCreateSupplier, getSupplier, supplierDTO } from './suppliers.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function loadQuotes(ctx: AppContext, companyId: string, extra: SQL[] = []): Promise<QuoteDTO[]> {
  const rows = await ctx.db
    .select({ q: quotes, s: suppliers, r: requisitions })
    .from(quotes)
    .innerJoin(suppliers, eq(suppliers.id, quotes.supplierId))
    .leftJoin(requisitions, eq(requisitions.id, quotes.requisitionId))
    .where(and(eq(quotes.companyId, companyId), ...extra))
    .orderBy(desc(quotes.createdAt), desc(quotes.seq))
    .limit(500);
  if (!rows.length) return [];
  const items = await ctx.db
    .select()
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, rows.map((r) => r.q.id)))
    .orderBy(quoteItems.position);
  return rows.map(({ q, s, r }) => {
    const its = items
      .filter((i) => i.quoteId === q.id)
      .map((i) => ({
        id: i.id,
        position: i.position,
        description: i.description,
        brand: i.brand,
        sku: i.sku,
        quantity: i.quantity,
        unit: i.unit,
        unit_price: i.unitPrice,
        total: round2(i.quantity * i.unitPrice),
      }));
    return {
      id: q.id,
      number: quoteNumber(q.seq),
      status: q.status,
      supplier: supplierDTO(s),
      requisition: r ? { id: r.id, number: requisitionNumber(r.seq), title: r.title } : null,
      currency: q.currency,
      delivery_days: q.deliveryDays,
      delivery_date: q.deliveryDate,
      delivery_text: q.deliveryText,
      payment_terms_text: q.paymentTermsText,
      freight_type: q.freightType,
      freight_value: q.freightValue,
      validity_text: q.validityText,
      quote_date: q.quoteDate,
      source_text: q.sourceText,
      origin: q.origin,
      registration_ms: q.registrationMs,
      total: round2(its.reduce((a, i) => a + i.total, 0)),
      items: its,
      created_at: q.createdAt,
    };
  });
}

export async function getQuote(ctx: AppContext, companyId: string, id: string): Promise<QuoteDTO> {
  const [q] = await loadQuotes(ctx, companyId, [eq(quotes.id, id)]);
  if (!q) throw notFound('Cotação');
  return q;
}

async function assertRequisition(ctx: AppContext, companyId: string, id: string) {
  const [r] = await ctx.db.select().from(requisitions).where(and(eq(requisitions.id, id), eq(requisitions.companyId, companyId))).limit(1);
  if (!r) throw notFound('Comparativo');
  if (r.status === 'cancelled') throw conflict('Comparativo cancelado');
  return r;
}

export async function createQuote(ctx: AppContext, member: Member, input: CreateQuoteInput): Promise<QuoteDTO> {
  const quoteDate = brToIso(input.quote_date);
  if (!quoteDate) throw badRequest('Data da cotação inválida');
  const deliveryDate = input.delivery_date ? brToIso(input.delivery_date) : null;
  if (input.delivery_date && !deliveryDate) throw badRequest('Data de entrega inválida');

  const supplier =
    'id' in input.supplier ? await getSupplier(ctx, member.companyId, input.supplier.id) : await findOrCreateSupplier(ctx, member, input.supplier.new);
  if (input.requisition_id) await assertRequisition(ctx, member.companyId, input.requisition_id);

  let extraction: ExtractionOutput | null = null;
  if (input.extraction_id) {
    const [e] = await ctx.db
      .select()
      .from(extractions)
      .where(and(eq(extractions.id, input.extraction_id), eq(extractions.companyId, member.companyId)))
      .limit(1);
    if (!e) throw notFound('Extração');
    extraction = e.output as ExtractionOutput;
  }
  const corrected = extraction ? correctedFields(extraction, input) : [];

  const [q] = await ctx.db
    .insert(quotes)
    .values({
      companyId: member.companyId,
      supplierId: supplier.id,
      requisitionId: input.requisition_id ?? null,
      extractionId: input.extraction_id ?? null,
      status: input.requisition_id ? 'comparing' : 'registered',
      currency: input.currency,
      deliveryDays: input.delivery_days ?? null,
      deliveryDate,
      deliveryText: input.delivery_text?.trim() || null,
      paymentTermsText: input.payment_terms_text?.trim() || null,
      freightType: input.freight_type ?? null,
      freightValue: input.freight_value ?? null,
      validityText: input.validity_text?.trim() || null,
      quoteDate,
      sourceText: input.source_text,
      origin: input.origin,
      registrationMs: input.registration_ms ?? null,
      correctedFields: corrected,
      createdBy: member.userId,
    })
    .returning();
  await ctx.db.insert(quoteItems).values(
    input.items.map((i, idx) => ({
      quoteId: q.id,
      position: idx + 1,
      description: i.description.trim(),
      brand: i.brand?.trim() || null,
      sku: i.sku?.trim() || null,
      quantity: i.quantity,
      unit: i.unit?.trim() || null,
      unitPrice: i.unit_price,
    })),
  );
  await logEvent(ctx, {
    companyId: member.companyId,
    userId: member.userId,
    type: 'quote_saved',
    entityId: q.id,
    data: { registration_ms: input.registration_ms ?? null, origin: input.origin, corrected_fields: corrected },
  });
  return getQuote(ctx, member.companyId, q.id);
}

/** Which extracted fields the buyer changed before saving (quality metric for the extraction). */
export function correctedFields(e: ExtractionOutput, input: CreateQuoteInput): string[] {
  const s = (v: unknown) => (v == null ? '' : String(v).trim().toLowerCase());
  const n = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10000) / 10000);
  const out = new Set<string>();
  if (e.moeda !== input.currency) out.add('moeda');
  if ((e.prazo_entrega_dias ?? null) !== (input.delivery_days ?? null) || s(e.prazo_entrega_data) !== s(brToIso(input.delivery_date))) out.add('prazo_entrega');
  if (s(e.condicao_pagamento) !== s(input.payment_terms_text)) out.add('condicao_pagamento');
  if ((e.frete_tipo ?? null) !== (input.freight_type ?? null) || n(e.frete_valor) !== n(input.freight_value)) out.add('frete');
  if (s(e.validade_proposta) !== s(input.validity_text)) out.add('validade');
  if (e.itens.length !== input.items.length) out.add('itens.quantidade_de_itens');
  input.items.forEach((item, idx) => {
    const x = e.itens[idx];
    if (!x) return;
    if (s(x.descricao) !== s(item.description)) out.add('itens.descricao');
    if (s(x.marca) !== s(item.brand)) out.add('itens.marca');
    if (s(x.sku) !== s(item.sku)) out.add('itens.sku');
    if (n(x.quantidade) !== n(item.quantity)) out.add('itens.quantidade');
    if (s(x.unidade) !== s(item.unit)) out.add('itens.unidade');
    if (n(x.valor_unitario) !== n(item.unit_price)) out.add('itens.valor_unitario');
  });
  return [...out];
}

export async function listQuotes(
  ctx: AppContext,
  member: Member,
  f: { status?: string; supplier_id?: string; requisition_id?: string; from?: string; to?: string },
) {
  const where: SQL[] = [];
  if (f.status) where.push(eq(quotes.status, f.status as QuoteStatus));
  else where.push(ne(quotes.status, 'discarded'));
  if (f.supplier_id) where.push(eq(quotes.supplierId, f.supplier_id));
  if (f.requisition_id) where.push(eq(quotes.requisitionId, f.requisition_id));
  const from = brToIso(f.from);
  const to = brToIso(f.to);
  if (from) where.push(gte(quotes.quoteDate, from));
  if (to) where.push(lte(quotes.quoteDate, to));
  return loadQuotes(ctx, member.companyId, where);
}

export async function updateQuote(ctx: AppContext, member: Member, id: string, input: UpdateQuoteInput) {
  const current = await getQuote(ctx, member.companyId, id);
  if (current.status === 'ordered' || current.status === 'selected') throw conflict('Cotação com pedido em andamento não pode ser alterada');
  const patch: Partial<typeof quotes.$inferInsert> = {};
  if (input.requisition_id !== undefined) {
    if (input.requisition_id) await assertRequisition(ctx, member.companyId, input.requisition_id);
    patch.requisitionId = input.requisition_id;
    if (current.status !== 'discarded') patch.status = input.requisition_id ? 'comparing' : 'registered';
  }
  if (input.status === 'discarded') patch.status = 'discarded';
  else if (input.status) patch.status = (patch.requisitionId ?? current.requisition?.id) ? 'comparing' : 'registered';
  await ctx.db.update(quotes).set(patch).where(eq(quotes.id, id));
  return getQuote(ctx, member.companyId, id);
}
