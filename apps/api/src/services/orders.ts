import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  addDaysIso,
  formatDecimal,
  isoToBr,
  isValidCnpj,
  onlyDigits,
  orderNumber,
  type OrderDTO,
  type UpdateOrderInput,
} from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { purchaseOrderItems, purchaseOrders, quotes, requisitions, suppliers } from '../db/schema.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { OmieError } from '../omie/gateway.js';
import { getProducts, listPaymentTerms, productLabel, suggestPaymentTerm, suggestProduct, syncProducts } from './catalog.js';
import { getOmie } from './companies.js';
import { logEvent } from './events.js';
import { getQuote } from './quotes.js';
import { supplierDTO } from './suppliers.js';

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

type PORow = typeof purchaseOrders.$inferSelect;

async function getPO(ctx: AppContext, companyId: string, id: string): Promise<PORow> {
  const [po] = await ctx.db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, companyId))).limit(1);
  if (!po) throw notFound('Pedido de compra');
  return po;
}

export async function orderDTO(ctx: AppContext, po: PORow): Promise<OrderDTO> {
  const quote = await getQuote(ctx, po.companyId, po.quoteId);
  const [supplier] = await ctx.db.select().from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1);
  const poItems = await ctx.db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id)).orderBy(purchaseOrderItems.position);
  const products = await getProducts(ctx, po.companyId, poItems.map((i) => i.omieProductId).filter((x): x is number => x != null));
  const editable = po.status === 'draft' || po.status === 'error';

  const items = await Promise.all(
    poItems.map(async (pi) => {
      const qi = quote.items.find((i) => i.id === pi.quoteItemId)!;
      const product = products.find((p) => p.omie_id === pi.omieProductId);
      const suggestion = !pi.omieProductId && editable ? await suggestProduct(ctx, po.companyId, qi.description, qi.sku) : null;
      return {
        id: pi.id,
        quote_item_id: qi.id,
        description: qi.description,
        quantity: qi.quantity,
        unit: qi.unit,
        unit_price: qi.unit_price,
        omie_product_id: pi.omieProductId,
        omie_product_label: product ? productLabel(product) : pi.omieProductId ? `Produto ${pi.omieProductId}` : null,
        suggestion: suggestion ? { omie_id: suggestion.omie_id, label: productLabel(suggestion) } : null,
      };
    }),
  );

  const needsFx = quote.currency !== 'BRL';
  const supplierOk = !!supplier.omieId || (!!supplier.cnpj && isValidCnpj(supplier.cnpj));
  const checks = [
    {
      key: 'supplier',
      label: supplier.omieId ? 'Fornecedor vinculado ao Omie' : 'CNPJ do fornecedor para cadastrá-lo no Omie',
      ok: supplierOk,
    },
    { key: 'products', label: items.length > 1 ? 'Itens vinculados a produtos do Omie' : 'Item vinculado a um produto do Omie', ok: items.every((i) => i.omie_product_id != null) },
    { key: 'payment_term', label: 'Condição de parcela do Omie definida', ok: !!po.paymentTermCode },
  ];
  if (needsFx) checks.push({ key: 'exchange_rate', label: `Taxa de câmbio ${quote.currency} → BRL informada`, ok: !!po.exchangeRate && po.exchangeRate > 0 });

  const totalBrl = needsFx ? (po.exchangeRate ? round(quote.total * po.exchangeRate, 2) : null) : quote.total;
  return {
    id: po.id,
    number: orderNumber(po.seq),
    status: po.status,
    quote: {
      id: quote.id,
      number: quote.number,
      currency: quote.currency,
      payment_terms_text: quote.payment_terms_text,
      delivery_days: quote.delivery_days,
      delivery_date: quote.delivery_date,
      freight_type: quote.freight_type,
      freight_value: quote.freight_value,
    },
    requisition: quote.requisition,
    supplier: supplierDTO(supplier),
    payment_term_code: po.paymentTermCode,
    exchange_rate: po.exchangeRate,
    total_original: quote.total,
    total_brl: po.status === 'sent' ? po.totalBrl : totalBrl,
    items,
    omie_order_id: po.omieOrderId,
    omie_number: po.omieNumber,
    last_error: po.lastError,
    attempts: po.attempts,
    sent_at: po.sentAt,
    created_at: po.createdAt,
    checks,
    ready: checks.every((c) => c.ok),
  };
}

/**
 * Creates (or reopens) the draft order for the selected quote. Selecting another proposal of the same
 * requisition drops that requisition's other unsent drafts, so each requisition has one active selection.
 */
export async function createDraft(ctx: AppContext, member: Member, quoteId: string): Promise<OrderDTO> {
  const quote = await getQuote(ctx, member.companyId, quoteId);
  if (quote.status === 'discarded') throw conflict('Cotação descartada');
  const [existing] = await ctx.db.select().from(purchaseOrders).where(eq(purchaseOrders.quoteId, quoteId)).limit(1);
  if (existing) {
    if (existing.status === 'sent' || existing.status === 'sending') throw conflict('Esta cotação já tem pedido enviado ao Omie', { order_id: existing.id });
    return orderDTO(ctx, existing);
  }

  if (quote.requisition) {
    const siblings = await ctx.db
      .select({ po: purchaseOrders })
      .from(purchaseOrders)
      .innerJoin(quotes, eq(quotes.id, purchaseOrders.quoteId))
      .where(and(eq(quotes.requisitionId, quote.requisition.id), ne(purchaseOrders.quoteId, quoteId)));
    if (siblings.some((s) => s.po.status === 'sent' || s.po.status === 'sending')) {
      throw conflict('Esta requisição já tem pedido enviado ao Omie');
    }
    for (const { po } of siblings) {
      await ctx.db.delete(purchaseOrders).where(eq(purchaseOrders.id, po.id));
      await ctx.db.update(quotes).set({ status: 'comparing' }).where(eq(quotes.id, po.quoteId));
    }
  }

  let paymentTermCode: string | null = null;
  try {
    await syncProducts(ctx, member.companyId);
    paymentTermCode = suggestPaymentTerm(quote.payment_terms_text, await listPaymentTerms(ctx, member.companyId));
  } catch (err) {
    // Omie unavailable: the draft is still created; the buyer sees the missing checks.
    if (!(err instanceof OmieError) && !(err instanceof HttpError)) throw err;
    ctx.log.warn({ err: String(err) }, 'omie catalog unavailable while creating draft');
  }

  const [po] = await ctx.db
    .insert(purchaseOrders)
    .values({ companyId: member.companyId, quoteId, supplierId: quote.supplier.id, paymentTermCode, createdBy: member.userId })
    .returning();
  await ctx.db.insert(purchaseOrderItems).values(quote.items.map((i) => ({ purchaseOrderId: po.id, quoteItemId: i.id, position: i.position })));
  await ctx.db.update(quotes).set({ status: 'selected' }).where(eq(quotes.id, quoteId));
  await logEvent(ctx, { companyId: member.companyId, userId: member.userId, type: 'order_draft_created', entityId: po.id });
  return orderDTO(ctx, po);
}

export async function updateOrder(ctx: AppContext, member: Member, id: string, input: UpdateOrderInput): Promise<OrderDTO> {
  const po = await getPO(ctx, member.companyId, id);
  if (po.status !== 'draft' && po.status !== 'error') throw conflict('Pedido já enviado não pode ser alterado');

  const patch: Partial<PORow> = {};
  if (input.payment_term_code !== undefined) {
    if (input.payment_term_code) {
      const terms = await listPaymentTerms(ctx, member.companyId);
      if (!terms.some((t) => t.code === input.payment_term_code)) throw badRequest('Condição de parcela não encontrada no Omie');
    }
    patch.paymentTermCode = input.payment_term_code;
  }
  if (input.exchange_rate !== undefined) patch.exchangeRate = input.exchange_rate;
  if (Object.keys(patch).length) await ctx.db.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id));

  if (input.supplier_cnpj !== undefined) {
    const [s] = await ctx.db.select().from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1);
    if (s.omieId) throw conflict('Fornecedor já vinculado ao Omie');
    const cnpj = input.supplier_cnpj ? onlyDigits(input.supplier_cnpj) : null;
    if (cnpj && !isValidCnpj(cnpj)) throw badRequest('CNPJ inválido');
    try {
      await ctx.db.update(suppliers).set({ cnpj }).where(eq(suppliers.id, s.id));
    } catch (err) {
      if ((err as { code?: string }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw conflict('Outro fornecedor já usa este CNPJ');
      }
      throw err;
    }
  }

  if (input.items?.length) {
    const ids = input.items.map((i) => i.omie_product_id).filter((x): x is number => x != null);
    const found = await getProducts(ctx, member.companyId, ids);
    for (const i of input.items) {
      if (i.omie_product_id != null && !found.some((p) => p.omie_id === i.omie_product_id)) throw badRequest('Produto não encontrado no Omie');
      await ctx.db
        .update(purchaseOrderItems)
        .set({ omieProductId: i.omie_product_id })
        .where(and(eq(purchaseOrderItems.id, i.id), eq(purchaseOrderItems.purchaseOrderId, id)));
    }
  }
  return orderDTO(ctx, await getPO(ctx, member.companyId, id));
}

/** Validates and queues the order. Calling it again while sending or after sent never sends twice. */
export async function sendOrder(ctx: AppContext, member: Member, id: string): Promise<OrderDTO> {
  const po = await getPO(ctx, member.companyId, id);
  if (po.status === 'sending' || po.status === 'sent') return orderDTO(ctx, po);
  const dto = await orderDTO(ctx, po);
  if (!dto.ready) throw badRequest('Complete os itens pendentes antes de enviar', { checks: dto.checks.filter((c) => !c.ok) });

  const [claimed] = await ctx.db
    .update(purchaseOrders)
    .set({ status: 'sending', lastError: null, attempts: 0, totalBrl: dto.total_brl })
    .where(and(eq(purchaseOrders.id, id), inArray(purchaseOrders.status, ['draft', 'error'])))
    .returning();
  if (!claimed) return orderDTO(ctx, await getPO(ctx, member.companyId, id));
  await logEvent(ctx, { companyId: member.companyId, userId: member.userId, type: 'order_send_requested', entityId: id });
  enqueueSend(ctx, claimed.id, member.companyId);
  return orderDTO(ctx, claimed);
}

export function enqueueSend(ctx: AppContext, poId: string, companyId: string) {
  ctx.jobs.enqueue(
    `send:${poId}`,
    (attempt) => deliverOrder(ctx, poId, companyId, attempt),
    (err) => err instanceof OmieError && err.retryable,
    async (err) => {
      const message = err instanceof OmieError ? err.message : 'Erro inesperado ao enviar. Tente novamente.';
      await ctx.db.update(purchaseOrders).set({ status: 'error', lastError: message }).where(eq(purchaseOrders.id, poId));
      await logEvent(ctx, { companyId, userId: null, type: 'order_send_failed', entityId: poId, data: { message } });
    },
  );
}

async function deliverOrder(ctx: AppContext, poId: string, companyId: string, attempt: number) {
  await ctx.db.update(purchaseOrders).set({ attempts: attempt }).where(eq(purchaseOrders.id, poId));
  const po = await getPO(ctx, companyId, poId);
  if (po.status !== 'sending') return;
  const quote = await getQuote(ctx, companyId, po.quoteId);
  const [supplier] = await ctx.db.select().from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1);
  const poItems = await ctx.db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id)).orderBy(purchaseOrderItems.position);
  const [terms, gateway] = await Promise.all([listPaymentTerms(ctx, companyId), getOmie(ctx, companyId)]);

  // 1. Supplier in Omie: reuse the stored link, else find by CNPJ, else create with the "Fornecedor" tag.
  let omieSupplierId = supplier.omieId;
  if (!omieSupplierId) {
    omieSupplierId =
      (await gateway.findSupplierByCnpj(supplier.cnpj!)) ??
      (await gateway.createSupplier({ integrationCode: supplier.id, name: supplier.name, cnpj: supplier.cnpj!, phone: supplier.phoneE164, email: supplier.email }));
    await ctx.db.update(suppliers).set({ omieId: omieSupplierId }).where(eq(suppliers.id, supplier.id));
  }

  // 2. The order, in BRL. Omie's purchase order has no currency field: the original currency and rate go in the notes.
  const fx = quote.currency === 'BRL' ? 1 : po.exchangeRate!;
  const deliveryIso = quote.delivery_date ?? (quote.delivery_days != null ? addDaysIso(quote.quote_date, quote.delivery_days) : null);
  const obs = [
    `Gerado pelo Compras WhatsApp a partir da cotação ${quote.number}${quote.requisition ? ` (${quote.requisition.number})` : ''}.`,
    quote.currency !== 'BRL' ? `Moeda original ${quote.currency}, total ${quote.currency} ${formatDecimal(quote.total)}, taxa ${formatDecimal(fx)}.` : null,
    quote.payment_terms_text ? `Condição proposta pelo fornecedor: ${quote.payment_terms_text}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const result = await gateway.upsertPurchaseOrder({
    cCodIntPed: orderNumber(po.seq),
    nCodFor: omieSupplierId,
    cCodParc: po.paymentTermCode!,
    nQtdeParc: terms.find((t) => t.code === po.paymentTermCode)?.installments ?? null,
    dDtPrevisao: deliveryIso ? isoToBr(deliveryIso) : null,
    cObs: obs,
    cContato: null,
    // NF-e freight modality codes: 0 = CIF (supplier pays), 1 = FOB (buyer pays).
    freight: quote.freight_type || quote.freight_value
      ? { cTpFrete: quote.freight_type === 'CIF' ? '0' : quote.freight_type === 'FOB' ? '1' : null, nValFrete: quote.freight_value ? round(quote.freight_value * fx, 2) : null }
      : null,
    items: poItems.map((pi) => {
      const qi = quote.items.find((i) => i.id === pi.quoteItemId)!;
      return { cCodIntItem: `${orderNumber(po.seq)}-${pi.position}`, nCodProd: pi.omieProductId!, nQtde: qi.quantity, nValUnit: round(qi.unit_price * fx, 4) };
    }),
  });

  await ctx.db
    .update(purchaseOrders)
    .set({ status: 'sent', omieOrderId: result.nCodPed, omieNumber: result.cNumero, sentAt: new Date().toISOString(), lastError: null })
    .where(eq(purchaseOrders.id, po.id));
  await ctx.db.update(quotes).set({ status: 'ordered' }).where(eq(quotes.id, quote.id));
  if (quote.requisition) await ctx.db.update(requisitions).set({ status: 'ordered' }).where(eq(requisitions.id, quote.requisition.id));
  await logEvent(ctx, { companyId, userId: null, type: 'order_sent', entityId: po.id, data: { omie_order_id: result.nCodPed, attempts: attempt } });
}

export async function getOrder(ctx: AppContext, member: Member, id: string) {
  return orderDTO(ctx, await getPO(ctx, member.companyId, id));
}

export async function listOrders(ctx: AppContext, member: Member) {
  const rows = await ctx.db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.companyId, member.companyId), ne(purchaseOrders.status, 'draft')))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(100);
  return Promise.all(rows.map((po) => orderDTO(ctx, po)));
}

/** Orders interrupted mid-send (API restart) go back on the queue. UpsertPedCompra makes the retry safe. */
export async function resumeSendingOrders(ctx: AppContext) {
  const rows = await ctx.db.select().from(purchaseOrders).where(eq(purchaseOrders.status, 'sending'));
  for (const po of rows) enqueueSend(ctx, po.id, po.companyId);
  return rows.length;
}
