import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import {
  addDaysIso,
  brToIso,
  isValidCnpj,
  normalizePhone,
  normalizeSupplierName,
  phoneKey,
  quoteNumber,
  todayIso,
  isoToBr,
  type LinkSupplierInput,
  type OmieSupplierDTO,
  type SupplierContextDTO,
} from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { omiePurchaseOrders, omieSuppliers, omieSyncState, quoteItems, quotes, suppliers } from '../db/schema.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { OmieError } from '../omie/gateway.js';
import { getOmie } from './companies.js';
import { findOrCreateSupplier, isUniqueViolation, supplierDTO } from './suppliers.js';

const TTL_MS = { suppliers: 6 * 3600_000, orders: 3600_000 } as const;
type Kind = keyof typeof TTL_MS;
type OmieSupplierRow = typeof omieSuppliers.$inferSelect;
type SupplierRow = typeof suppliers.$inferSelect;

// ---------------------------------------------------------------------------
// Local copies of Omie suppliers and purchase orders
// ---------------------------------------------------------------------------

const running = new Map<string, Promise<void>>();

async function lastSync(ctx: AppContext, companyId: string, kind: Kind) {
  const [row] = await ctx.db
    .select()
    .from(omieSyncState)
    .where(and(eq(omieSyncState.companyId, companyId), eq(omieSyncState.kind, kind)))
    .limit(1);
  return row?.syncedAt ?? null;
}

async function markSync(ctx: AppContext, companyId: string, kind: Kind) {
  const now = new Date().toISOString();
  await ctx.db
    .insert(omieSyncState)
    .values({ companyId, kind, syncedAt: now })
    .onConflictDoUpdate({ target: [omieSyncState.companyId, omieSyncState.kind], set: { syncedAt: now } });
}

export async function syncOmieSuppliers(ctx: AppContext, companyId: string) {
  const gateway = await getOmie(ctx, companyId);
  const list = await gateway.listSuppliers();
  const now = new Date().toISOString();
  const rows = list.map((s) => ({
    companyId,
    omieId: s.omie_id,
    name: s.name,
    tradeName: s.trade_name,
    cnpj: s.cnpj,
    phoneKeys: [...new Set(s.phones.map((p) => phoneKey(p.number, p.ddd)).filter((k): k is string => !!k))],
    phones: s.phones.map((p) => [p.ddd, p.number].filter(Boolean).join(' ')),
    email: s.email,
    tags: s.tags,
    nameNormalized: normalizeSupplierName(s.trade_name || s.name),
    syncedAt: now,
  }));
  await ctx.db.transaction(async (tx) => {
    await tx.delete(omieSuppliers).where(eq(omieSuppliers.companyId, companyId));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(omieSuppliers).values(rows.slice(i, i + 500));
  });
  await markSync(ctx, companyId, 'suppliers');
  ctx.log.info({ companyId, count: rows.length }, 'omie suppliers synced');
}

export async function syncOmieOrders(ctx: AppContext, companyId: string) {
  const gateway = await getOmie(ctx, companyId);
  const today = todayIso();
  const list = await gateway.listPurchaseOrders(isoToBr(addDaysIso(today, -365)), isoToBr(today));
  const now = new Date().toISOString();
  const rows = list
    .map((p) => ({
      companyId,
      omieId: p.omie_id,
      number: p.number,
      supplierOmieId: p.supplier_omie_id,
      createdOn: brToIso(p.created_on) ?? today,
      stage: p.stage,
      total: Math.round((p.items.reduce((a, i) => a + i.total, 0) + (p.freight || 0)) * 100) / 100,
      items: p.items,
      syncedAt: now,
    }))
    .filter((r) => r.omieId && r.supplierOmieId);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(omiePurchaseOrders).where(eq(omiePurchaseOrders.companyId, companyId));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(omiePurchaseOrders).values(rows.slice(i, i + 500));
  });
  await markSync(ctx, companyId, 'orders');
  ctx.log.info({ companyId, count: rows.length }, 'omie purchase orders synced');
}

function refresh(ctx: AppContext, companyId: string, kind: Kind) {
  const key = `${companyId}:${kind}`;
  let p = running.get(key);
  if (!p) {
    p = (kind === 'suppliers' ? syncOmieSuppliers(ctx, companyId) : syncOmieOrders(ctx, companyId)).finally(() => running.delete(key));
    running.set(key, p);
  }
  return p;
}

/**
 * First use waits for the copy; afterwards a stale copy is served immediately and refreshed in the background.
 * Returns false when Omie is not connected or unreachable and there is no copy yet.
 */
async function ensureCopy(ctx: AppContext, companyId: string, kind: Kind): Promise<boolean> {
  const last = await lastSync(ctx, companyId, kind);
  if (last && Date.now() - new Date(last).getTime() < TTL_MS[kind]) return true;
  const p = refresh(ctx, companyId, kind);
  if (last) {
    p.catch((err) => ctx.log.warn({ err: String(err), kind }, 'omie refresh failed'));
    return true;
  }
  try {
    await p;
    return true;
  } catch (err) {
    if (err instanceof OmieError || (err instanceof HttpError && err.code === 'omie_not_configured')) {
      ctx.log.warn({ err: String(err), kind }, 'omie copy unavailable');
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Matching the open conversation to a supplier
// ---------------------------------------------------------------------------

const omieDTO = (s: OmieSupplierRow): OmieSupplierDTO => ({
  omie_id: s.omieId,
  name: s.name,
  trade_name: s.tradeName,
  cnpj: s.cnpj,
  phones: s.phones,
  email: s.email,
  is_supplier: s.tags.some((t) => /fornecedor/i.test(t)),
});

const bySupplierTag = (a: OmieSupplierRow, b: OmieSupplierRow) => Number(omieDTO(b).is_supplier) - Number(omieDTO(a).is_supplier);

/** "Carlos (Microsemi)" -> ["carlos microsemi", "microsemi"]: WhatsApp names often carry the company in parentheses. */
function contactNames(name: string | null | undefined): string[] {
  if (!name?.trim()) return [];
  const out = [normalizeSupplierName(name)];
  const inParens = name.match(/\(([^)]+)\)/)?.[1];
  if (inParens) out.push(normalizeSupplierName(inParens));
  return [...new Set(out.filter(Boolean))];
}

function tokenOverlap(a: string, b: string) {
  const ta = new Set(a.split(' ').filter((t) => t.length > 2));
  return b.split(' ').filter((t) => t.length > 2 && ta.has(t)).length;
}

interface Resolution {
  match: SupplierContextDTO['match'];
  supplier: SupplierRow | null;
  omie: OmieSupplierRow | null;
  candidates: OmieSupplierRow[];
}

async function resolve(ctx: AppContext, member: Member, contact: { name: string | null; phone: string | null }, omieOk: boolean): Promise<Resolution> {
  const key = phoneKey(contact.phone);
  const names = contactNames(contact.name);
  const locals = await ctx.db.select().from(suppliers).where(eq(suppliers.companyId, member.companyId));
  const omieById = async (id: number) =>
    omieOk
      ? ((await ctx.db.select().from(omieSuppliers).where(and(eq(omieSuppliers.companyId, member.companyId), eq(omieSuppliers.omieId, id))).limit(1))[0] ?? null)
      : null;

  // 1. Phone: our register first, then Omie's (a supplier wins over a client with the same number).
  if (key) {
    const local = locals.find((s) => phoneKey(s.phoneE164) === key);
    if (local) return { match: 'phone', supplier: local, omie: local.omieId ? await omieById(local.omieId) : null, candidates: [] };
    if (omieOk) {
      const found = await ctx.db
        .select()
        .from(omieSuppliers)
        .where(and(eq(omieSuppliers.companyId, member.companyId), sql`${key} = any(${omieSuppliers.phoneKeys})`));
      const best = found.sort(bySupplierTag)[0];
      if (best) return { match: 'phone', supplier: locals.find((s) => s.omieId === best.omieId) ?? null, omie: best, candidates: [] };
    }
  }

  // 2. A contact name the buyer already confirmed for a supplier.
  const byAlias = locals.find((s) => s.whatsappAliases.some((a) => names.includes(a)));
  if (byAlias) return { match: 'alias', supplier: byAlias, omie: byAlias.omieId ? await omieById(byAlias.omieId) : null, candidates: [] };

  // 3. Exact name, else candidates for the buyer to confirm.
  if (!names.length) return { match: null, supplier: null, omie: null, candidates: [] };
  const localByName = locals.find((s) => names.includes(s.nameNormalized));
  if (localByName) return { match: 'name', supplier: localByName, omie: localByName.omieId ? await omieById(localByName.omieId) : null, candidates: [] };
  if (!omieOk) return { match: null, supplier: null, omie: null, candidates: [] };
  const all = await ctx.db.select().from(omieSuppliers).where(eq(omieSuppliers.companyId, member.companyId));
  const exact = all.filter((s) => names.includes(s.nameNormalized) || names.includes(normalizeSupplierName(s.name))).sort(bySupplierTag)[0];
  if (exact) return { match: 'name', supplier: locals.find((s) => s.omieId === exact.omieId) ?? null, omie: exact, candidates: [] };
  const scored = all
    .filter((s) => omieDTO(s).is_supplier)
    .map((s) => ({ s, score: Math.max(...names.map((n) => Math.max(tokenOverlap(n, s.nameNormalized), tokenOverlap(n, normalizeSupplierName(s.name))))) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.s);
  return { match: null, supplier: null, omie: null, candidates: scored };
}

/** Our supplier for an Omie register: reuse or create it, filling in the Omie link, CNPJ and phone. */
async function linkLocal(ctx: AppContext, member: Member, omie: OmieSupplierRow, existing: SupplierRow | null, phone: string | null): Promise<SupplierRow> {
  const cnpj = omie.cnpj && isValidCnpj(omie.cnpj) ? omie.cnpj : null;
  let local =
    existing ??
    (await ctx.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.companyId, member.companyId), eq(suppliers.omieId, omie.omieId)))
      .limit(1))[0] ??
    (await findOrCreateSupplier(ctx, member, { name: omie.tradeName || omie.name, phone, cnpj, email: omie.email }));
  const patch: Partial<SupplierRow> = {};
  if (!local.omieId) patch.omieId = omie.omieId;
  if (!local.cnpj && cnpj) patch.cnpj = cnpj;
  if (!local.phoneE164 && normalizePhone(phone)) patch.phoneE164 = normalizePhone(phone);
  if (Object.keys(patch).length) {
    try {
      [local] = await ctx.db.update(suppliers).set(patch).where(eq(suppliers.id, local.id)).returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return local!;
}

// ---------------------------------------------------------------------------
// Context: supplier + purchase history + quote history
// ---------------------------------------------------------------------------

export async function getSupplierContext(ctx: AppContext, member: Member, contact: { name: string | null; phone: string | null }): Promise<SupplierContextDTO> {
  const [suppliersOk, ordersOk] = await Promise.all([ensureCopy(ctx, member.companyId, 'suppliers'), ensureCopy(ctx, member.companyId, 'orders')]);
  const r = await resolve(ctx, member, contact, suppliersOk);
  // Recognized in Omie by phone or exact name: keep our register linked (next time it is instant).
  if (r.omie && (r.match === 'phone' || r.match === 'name')) r.supplier = await linkLocal(ctx, member, r.omie, r.supplier, contact.phone);
  return buildContext(ctx, member, contact, r, ordersOk);
}

/** The buyer confirms which supplier this conversation is: stored as a phone and/or contact-name alias. */
export async function linkSupplier(ctx: AppContext, member: Member, input: LinkSupplierInput): Promise<SupplierContextDTO> {
  const contact = { name: input.contact_name ?? null, phone: input.contact_phone ?? null };
  let local: SupplierRow;
  let omie: OmieSupplierRow | null = null;
  if (input.omie_id) {
    [omie] = await ctx.db.select().from(omieSuppliers).where(and(eq(omieSuppliers.companyId, member.companyId), eq(omieSuppliers.omieId, input.omie_id))).limit(1);
    if (!omie) throw notFound('Fornecedor do Omie');
    local = await linkLocal(ctx, member, omie, null, contact.phone);
  } else if (input.supplier_id) {
    const [s] = await ctx.db.select().from(suppliers).where(and(eq(suppliers.id, input.supplier_id), eq(suppliers.companyId, member.companyId))).limit(1);
    if (!s) throw notFound('Fornecedor');
    local = s;
  } else throw badRequest('Escolha o fornecedor');

  const aliases = [...new Set([...local.whatsappAliases, ...contactNames(contact.name).slice(0, 1)])];
  const patch: Partial<SupplierRow> = { whatsappAliases: aliases };
  if (!local.phoneE164 && normalizePhone(contact.phone)) patch.phoneE164 = normalizePhone(contact.phone);
  try {
    [local] = await ctx.db.update(suppliers).set(patch).where(eq(suppliers.id, local.id)).returning();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  return getSupplierContext(ctx, member, contact);
}

async function buildContext(ctx: AppContext, member: Member, contact: SupplierContextDTO['contact'], r: Resolution, ordersOk: boolean): Promise<SupplierContextDTO> {
  const omieId = r.omie?.omieId ?? r.supplier?.omieId ?? null;
  const since = addDaysIso(todayIso(), -365);
  const orders = omieId
    ? await ctx.db
        .select()
        .from(omiePurchaseOrders)
        .where(and(eq(omiePurchaseOrders.companyId, member.companyId), eq(omiePurchaseOrders.supplierOmieId, omieId), gte(omiePurchaseOrders.createdOn, since)))
        .orderBy(desc(omiePurchaseOrders.createdOn))
    : [];
  const spent = orders.reduce((a, o) => a + o.total, 0);

  const products = new Map<string, { description: string; quantity: number; total: number; last_unit_price: number; last_date: string }>();
  for (const o of orders) {
    for (const i of o.items) {
      const k = i.omie_product_id ? String(i.omie_product_id) : i.description.toLowerCase();
      const p = products.get(k);
      // Orders are newest first: the first time a product appears is its latest price.
      if (!p) products.set(k, { description: i.description, quantity: i.quantity, total: i.total, last_unit_price: i.unit_price, last_date: o.createdOn });
      else {
        p.quantity += i.quantity;
        p.total += i.total;
      }
    }
  }

  const qs = r.supplier
    ? await ctx.db
        .select({ q: quotes, total: sql<number>`coalesce(sum(${quoteItems.quantity} * ${quoteItems.unitPrice}), 0)`.mapWith(Number) })
        .from(quotes)
        .leftJoin(quoteItems, eq(quoteItems.quoteId, quotes.id))
        .where(and(eq(quotes.companyId, member.companyId), eq(quotes.supplierId, r.supplier.id), ne(quotes.status, 'discarded')))
        .groupBy(quotes.id)
        .orderBy(desc(quotes.createdAt))
    : [];
  const days = qs.map((x) => x.q.deliveryDays).filter((d): d is number => d != null);
  const quoteView = (x: (typeof qs)[number]) => ({
    id: x.q.id,
    number: quoteNumber(x.q.seq),
    date: x.q.quoteDate,
    total: Math.round(x.total * 100) / 100,
    currency: x.q.currency,
    status: x.q.status,
  });

  const [syncedAt] = await ctx.db
    .select({ at: omieSyncState.syncedAt })
    .from(omieSyncState)
    .where(and(eq(omieSyncState.companyId, member.companyId), eq(omieSyncState.kind, 'orders')))
    .limit(1);

  return {
    contact,
    match: r.match,
    supplier: r.supplier ? supplierDTO(r.supplier) : null,
    omie_supplier: r.omie ? omieDTO(r.omie) : null,
    candidates: r.candidates.map(omieDTO),
    omie: {
      available: ordersOk,
      synced_at: syncedAt?.at ?? null,
      orders_12m: orders.length,
      spent_12m: Math.round(spent * 100) / 100,
      average_ticket: orders.length ? Math.round((spent / orders.length) * 100) / 100 : null,
      last_order: orders[0] ? { number: orders[0].number, date: orders[0].createdOn, total: orders[0].total } : null,
      recent_orders: orders.slice(0, 3).map((o) => ({
        number: o.number,
        date: o.createdOn,
        total: o.total,
        items: o.items.map((i) => i.description).join(', '),
      })),
      top_products: [...products.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100, quantity: Math.round(p.quantity * 1000) / 1000 })),
    },
    quotes: {
      total: qs.length,
      ordered: qs.filter((x) => x.q.status === 'ordered').length,
      last: qs[0] ? quoteView(qs[0]) : null,
      average_delivery_days: days.length ? Math.round(days.reduce((a, d) => a + d, 0) / days.length) : null,
      recent: qs.slice(0, 3).map(quoteView),
    },
  };
}
