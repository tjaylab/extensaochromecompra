import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateQuoteInput,
  CreateRequisitionInput,
  EventInput,
  ExtractionRequest,
  UpdateOrderInput,
  UpdateQuoteInput,
} from '@compras/shared';
import type { AppContext, Member } from './context.js';
import { badRequest, HttpError } from './lib/errors.js';
import { listPaymentTerms, searchProducts, syncPaymentTerms, syncProducts } from './services/catalog.js';
import { checkOmie, createCompany, getMe, inviteMember, listMembers, resolveMember, saveOmieCredentials } from './services/companies.js';
import { logEvent } from './services/events.js';
import { runExtraction } from './services/extractions.js';
import { getMetrics } from './services/metrics.js';
import { createDraft, getOrder, listOrders, sendOrder, updateOrder } from './services/orders.js';
import { createQuote, getQuote, listQuotes, updateQuote } from './services/quotes.js';
import { createRequisition, getComparison, getRequisition, listRequisitions } from './services/requisitions.js';
import { listSuppliers, updateSupplier } from './services/suppliers.js';

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(first?.message && !first.message.startsWith('Invalid') ? first.message : 'Dados inválidos', r.error.issues);
  }
  return r.data;
}

function member(req: FastifyRequest): Member {
  if (!req.member) throw new HttpError(403, 'no_company', 'Crie ou entre em uma empresa para continuar');
  return req.member;
}

const Id = z.object({ id: z.string().uuid() });

export function registerRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/health', async () => ({ ok: true }));

  // --- Session and company -------------------------------------------------
  app.get('/v1/me', async (req) => getMe(ctx, req.user!, req.member));

  app.post('/v1/company', async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1, 'Informe o nome da empresa'), cnpj: z.string().nullish() }), req.body);
    await createCompany(ctx, req.user!, body);
    return getMe(ctx, req.user!, await resolveMember(ctx, req.user!));
  });

  app.get('/v1/company/members', async (req) => listMembers(ctx, member(req)));

  app.post('/v1/company/invitations', async (req) => {
    const body = parse(z.object({ email: z.string(), role: z.enum(['admin', 'buyer']).optional() }), req.body);
    return inviteMember(ctx, member(req), body);
  });

  app.put('/v1/company/omie-credentials', async (req) => {
    const body = parse(z.object({ app_key: z.string(), app_secret: z.string() }), req.body);
    const m = member(req);
    const result = await saveOmieCredentials(ctx, m, body);
    // Warm the catalog cache in the background.
    Promise.all([syncProducts(ctx, m.companyId, true), syncPaymentTerms(ctx, m.companyId, true)]).catch((err) =>
      ctx.log.warn({ err: String(err) }, 'catalog warm-up failed'),
    );
    return result;
  });

  app.post('/v1/company/omie-check', async (req) => checkOmie(ctx, member(req)));

  // --- Extraction -----------------------------------------------------------
  app.post('/v1/extractions', async (req) => runExtraction(ctx, member(req), parse(ExtractionRequest, req.body)));

  // --- Suppliers ------------------------------------------------------------
  app.get('/v1/suppliers', async (req) => listSuppliers(ctx, member(req), (req.query as { q?: string }).q));

  app.patch('/v1/suppliers/:id', async (req) => {
    const { id } = parse(Id, req.params);
    const body = parse(
      z.object({ name: z.string().optional(), phone: z.string().nullish(), cnpj: z.string().nullish(), email: z.string().nullish() }),
      req.body,
    );
    return updateSupplier(ctx, member(req), id, body);
  });

  // --- Quotes ---------------------------------------------------------------
  app.post('/v1/quotes', async (req) => createQuote(ctx, member(req), parse(CreateQuoteInput, req.body)));

  app.get('/v1/quotes', async (req) => {
    const q = parse(
      z.object({
        status: z.string().optional(),
        supplier_id: z.string().uuid().optional(),
        requisition_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      req.query,
    );
    return listQuotes(ctx, member(req), q);
  });

  app.get('/v1/quotes/:id', async (req) => getQuote(ctx, member(req).companyId, parse(Id, req.params).id));

  app.patch('/v1/quotes/:id', async (req) => updateQuote(ctx, member(req), parse(Id, req.params).id, parse(UpdateQuoteInput, req.body)));

  // --- Requisitions ---------------------------------------------------------
  app.get('/v1/requisitions', async (req) => listRequisitions(ctx, member(req), (req.query as { status?: string }).status));
  app.post('/v1/requisitions', async (req) => createRequisition(ctx, member(req), parse(CreateRequisitionInput, req.body)));
  app.get('/v1/requisitions/:id', async (req) => getRequisition(ctx, member(req), parse(Id, req.params).id));
  app.get('/v1/requisitions/:id/comparison', async (req) => getComparison(ctx, member(req), parse(Id, req.params).id));

  // --- Omie catalog ---------------------------------------------------------
  app.get('/v1/omie/products', async (req) => searchProducts(ctx, member(req).companyId, (req.query as { q?: string }).q));
  app.get('/v1/omie/payment-terms', async (req) => listPaymentTerms(ctx, member(req).companyId));
  app.post('/v1/omie/sync', async (req) => {
    const m = member(req);
    await Promise.all([syncProducts(ctx, m.companyId, true), syncPaymentTerms(ctx, m.companyId, true)]);
    return { ok: true };
  });

  // --- Purchase orders ------------------------------------------------------
  app.post('/v1/purchase-orders', async (req) => {
    const body = parse(z.object({ quote_id: z.string().uuid() }), req.body);
    return createDraft(ctx, member(req), body.quote_id);
  });
  app.get('/v1/purchase-orders', async (req) => listOrders(ctx, member(req)));
  app.get('/v1/purchase-orders/:id', async (req) => getOrder(ctx, member(req), parse(Id, req.params).id));
  app.patch('/v1/purchase-orders/:id', async (req) => updateOrder(ctx, member(req), parse(Id, req.params).id, parse(UpdateOrderInput, req.body)));
  app.post('/v1/purchase-orders/:id/send', async (req) => sendOrder(ctx, member(req), parse(Id, req.params).id));

  // --- Instrumentation ------------------------------------------------------
  app.post('/v1/events', async (req) => {
    const m = member(req);
    const body = parse(EventInput, req.body);
    await logEvent(ctx, { companyId: m.companyId, userId: m.userId, type: body.type, entityId: body.entity_id, data: body.data ?? null });
    return { ok: true };
  });

  app.get('/v1/metrics', async (req) => getMetrics(ctx, member(req)));
}
