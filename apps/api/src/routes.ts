import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateQuoteInput,
  CreateRequisitionInput,
  EventInput,
  ExtractionRequest,
  LinkSupplierInput,
  RegisterOmieSupplierInput,
  ScanRequest,
  UpdateOmiePhoneInput,
  UpdateOrderInput,
  UpdateQuoteInput,
} from '@compras/shared';
import { AdminSubscriptionInput, CheckoutInput } from '@compras/shared';
import type { AppContext, Member } from './context.js';
import { badRequest, HttpError } from './lib/errors.js';
import { listPaymentTerms, searchProducts, syncPaymentTerms, syncProducts } from './services/catalog.js';
import { checkOmie, createCompany, getMe, inviteMember, listMembers, resolveMember, saveOmieCredentials } from './services/companies.js';
import { adminListCompanies, adminUpdateSubscription, checkout, getBilling, handleAsaasWebhook } from './services/billing.js';
import { logEvent } from './services/events.js';
import { runExtraction, runScan } from './services/extractions.js';
import { getMetrics } from './services/metrics.js';
import { emailOrder, renderOrderPdf } from './services/order-document.js';
import { createDraft, getOrder, listOrders, sendOrder, updateOrder } from './services/orders.js';
import { createQuote, getQuote, listQuotes, updateQuote } from './services/quotes.js';
import { createRequisition, getComparison, getRequisition, listRequisitions } from './services/requisitions.js';
import { listSuppliers, updateSupplier } from './services/suppliers.js';
import {
  getSupplierContext,
  linkSupplier,
  registerSupplierInOmie,
  searchSuppliers,
  syncOmieOrders,
  syncOmieSuppliers,
  updateOmiePhone,
} from './services/supplier-context.js';

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
    Promise.all([
      syncProducts(ctx, m.companyId, true),
      syncPaymentTerms(ctx, m.companyId, true),
      syncOmieSuppliers(ctx, m.companyId),
      syncOmieOrders(ctx, m.companyId),
    ]).catch((err) =>
      ctx.log.warn({ err: String(err) }, 'catalog warm-up failed'),
    );
    return result;
  });

  app.post('/v1/company/omie-check', async (req) => checkOmie(ctx, member(req)));

  // --- Extraction -----------------------------------------------------------
  // Up to 3 files of 8 MB each, base64-encoded.
  app.post('/v1/extractions', { bodyLimit: 40 * 1024 * 1024 }, async (req) => runExtraction(ctx, member(req), parse(ExtractionRequest, req.body)));
  // Every proposal in a stretch of conversation (the panel reads as the buyer scrolls).
  app.post('/v1/extractions/scan', async (req) => runScan(ctx, member(req), parse(ScanRequest, req.body)));

  // --- Suppliers ------------------------------------------------------------
  app.get('/v1/suppliers', async (req) => listSuppliers(ctx, member(req), (req.query as { q?: string }).q));

  // The supplier of the open WhatsApp conversation, with purchase and quote history.
  app.get('/v1/suppliers/context', async (req) => {
    const q = parse(z.object({ name: z.string().max(200).optional(), phone: z.string().max(40).optional() }), req.query);
    if (!q.name && !q.phone) throw badRequest('Informe o nome ou o telefone do contato');
    return getSupplierContext(ctx, member(req), { name: q.name ?? null, phone: q.phone ?? null });
  });
  app.post('/v1/suppliers/link', async (req) => linkSupplier(ctx, member(req), parse(LinkSupplierInput, req.body)));
  // Search our register and Omie's when the automatic suggestion missed.
  app.get('/v1/suppliers/search', async (req) => searchSuppliers(ctx, member(req), (req.query as { q?: string }).q ?? ''));
  app.post('/v1/suppliers/omie', async (req) => registerSupplierInOmie(ctx, member(req), parse(RegisterOmieSupplierInput, req.body)));
  app.post('/v1/suppliers/omie-phone', async (req) => updateOmiePhone(ctx, member(req), parse(UpdateOmiePhoneInput, req.body)));

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
  app.get('/v1/purchase-orders/:id/pdf', async (req, reply) => {
    const { file, name } = await renderOrderPdf(ctx, member(req), parse(Id, req.params).id);
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${name}"`).header('X-File-Name', name).send(file);
  });
  app.post('/v1/purchase-orders/:id/email', async (req) => {
    const body = parse(z.object({ to: z.string(), message: z.string().max(4000).nullish() }), req.body);
    return emailOrder(ctx, member(req), parse(Id, req.params).id, body);
  });

  // --- Instrumentation ------------------------------------------------------
  app.post('/v1/events', async (req) => {
    const m = member(req);
    const body = parse(EventInput, req.body);
    await logEvent(ctx, { companyId: m.companyId, userId: m.userId, type: body.type, entityId: body.entity_id, data: body.data ?? null });
    return { ok: true };
  });

  app.get('/v1/metrics', async (req) => getMetrics(ctx, member(req)));

  // --- Plan and usage ------------------------------------------------------
  app.get('/v1/billing', async (req) => getBilling(ctx, member(req)));
  app.post('/v1/billing/checkout', async (req) => checkout(ctx, member(req), parse(CheckoutInput, req.body)));

  // Asaas calls this (outside /v1: no user session; authenticated by the webhook token).
  app.post('/webhooks/asaas', async (req) => handleAsaasWebhook(ctx, req.headers['asaas-access-token'] as string | undefined, req.body));

  // --- ProcureMate team (SUPERADMIN_EMAILS) --------------------------------
  app.get('/v1/admin/companies', async (req) => adminListCompanies(ctx, req.user!.email));
  app.patch('/v1/admin/companies/:id/subscription', async (req) =>
    adminUpdateSubscription(ctx, req.user!.email, parse(Id, req.params).id, parse(AdminSubscriptionInput, req.body)),
  );
}
