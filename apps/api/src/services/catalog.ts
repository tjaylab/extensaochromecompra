import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { normalizeSupplierName, type OmiePaymentTermDTO, type OmieProductDTO } from '@compras/shared';
import type { AppContext } from '../context.js';
import { omiePaymentTerms, omieProducts } from '../db/schema.js';
import { getOmie } from './companies.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function isFresh(ctx: AppContext, table: typeof omieProducts | typeof omiePaymentTerms, companyId: string) {
  const [row] = await ctx.db
    .select({ last: sql<string | null>`max(${table.syncedAt})` })
    .from(table)
    .where(eq(table.companyId, companyId));
  return !!row?.last && Date.now() - new Date(row.last).getTime() < CACHE_TTL_MS;
}

export async function syncProducts(ctx: AppContext, companyId: string, force = false) {
  if (!force && (await isFresh(ctx, omieProducts, companyId))) return;
  const gateway = await getOmie(ctx, companyId);
  const products = await gateway.listProducts();
  const now = new Date().toISOString();
  await ctx.db.transaction(async (tx) => {
    await tx.delete(omieProducts).where(eq(omieProducts.companyId, companyId));
    for (let i = 0; i < products.length; i += 500) {
      await tx.insert(omieProducts).values(
        products.slice(i, i + 500).map((p) => ({ companyId, omieId: p.omie_id, code: p.code, description: p.description, unit: p.unit, syncedAt: now })),
      );
    }
  });
  ctx.log.info({ companyId, count: products.length }, 'omie products synced');
}

export async function syncPaymentTerms(ctx: AppContext, companyId: string, force = false) {
  if (!force && (await isFresh(ctx, omiePaymentTerms, companyId))) return;
  const gateway = await getOmie(ctx, companyId);
  const terms = await gateway.listPaymentTerms();
  const now = new Date().toISOString();
  await ctx.db.transaction(async (tx) => {
    await tx.delete(omiePaymentTerms).where(eq(omiePaymentTerms.companyId, companyId));
    if (terms.length) {
      await tx.insert(omiePaymentTerms).values(
        terms.map((t) => ({ companyId, code: t.code, description: t.description, installments: t.installments, syncedAt: now })),
      );
    }
  });
}

const productDTO = (p: typeof omieProducts.$inferSelect): OmieProductDTO => ({ omie_id: p.omieId, code: p.code, description: p.description, unit: p.unit });
export const productLabel = (p: { code: string; description: string }) => `${p.code} · ${p.description}`;

export async function searchProducts(ctx: AppContext, companyId: string, q?: string): Promise<OmieProductDTO[]> {
  await syncProducts(ctx, companyId);
  const term = q?.trim();
  const where = term
    ? and(eq(omieProducts.companyId, companyId), or(ilike(omieProducts.description, `%${term}%`), ilike(omieProducts.code, `%${term}%`)))
    : eq(omieProducts.companyId, companyId);
  const rows = await ctx.db.select().from(omieProducts).where(where).orderBy(asc(omieProducts.description)).limit(30);
  return rows.map(productDTO);
}

export async function getProducts(ctx: AppContext, companyId: string, ids: number[]) {
  if (!ids.length) return [];
  const rows = await ctx.db.select().from(omieProducts).where(and(eq(omieProducts.companyId, companyId), inArray(omieProducts.omieId, ids)));
  return rows.map(productDTO);
}

/** Best cached product for a free-text description (token overlap), or null. */
export async function suggestProduct(ctx: AppContext, companyId: string, description: string, sku?: string | null) {
  const rows = await ctx.db.select().from(omieProducts).where(eq(omieProducts.companyId, companyId));
  if (sku) {
    const bySku = rows.find((r) => r.code.toLowerCase() === sku.toLowerCase());
    if (bySku) return productDTO(bySku);
  }
  const tokens = new Set(normalizeSupplierName(description).split(' ').filter((t) => t.length > 2).map(stem));
  let best: { row: (typeof rows)[number]; score: number } | null = null;
  for (const r of rows) {
    const score = normalizeSupplierName(r.description).split(' ').filter((t) => tokens.has(stem(t))).length;
    if (score > 0 && (!best || score > best.score)) best = { row: r, score };
  }
  return best ? productDTO(best.row) : null;
}

const stem = (t: string) => t.replace(/(oes|aes|es|s)$/, '');

export async function listPaymentTerms(ctx: AppContext, companyId: string): Promise<OmiePaymentTermDTO[]> {
  await syncPaymentTerms(ctx, companyId);
  const rows = await ctx.db.select().from(omiePaymentTerms).where(eq(omiePaymentTerms.companyId, companyId)).orderBy(asc(omiePaymentTerms.code));
  return rows.map((t) => ({ code: t.code, description: t.description, installments: t.installments }));
}

/** Maps the supplier's text ("28 dias", "30/60", "à vista") to a cached Omie payment term code. */
export function suggestPaymentTerm(text: string | null, terms: OmiePaymentTermDTO[]): string | null {
  if (!text) return null;
  const t = normalizeSupplierName(text);
  if (/antecipad/.test(t)) return terms.find((x) => /antecipad/i.test(normalizeSupplierName(x.description)))?.code ?? null;
  // "à vista/30/60" and "A Vista/30/60" both become "0/30/60".
  const sequence = (s: string) =>
    normalizeSupplierName(s)
      .replace(/\ba vista\b|\bvista\b/g, ' 0 ')
      .match(/\d+/g)
      ?.map(Number)
      .join('/') ?? '';
  const wanted = sequence(text);
  if (!wanted) return null;
  const score = (d: string) => {
    const n = normalizeSupplierName(d);
    return (/\bdias?\b/.test(t) && /\bdias?\b/.test(n) ? 2 : 0) + (/parcela/.test(t) && /parcela/.test(n) ? 2 : 0) - (/\(r\)/i.test(d) ? 1 : 0);
  };
  const matches = terms.filter((x) => sequence(x.description) === wanted).sort((a, b) => score(b.description) - score(a.description) || a.code.localeCompare(b.code));
  return matches[0]?.code ?? null;
}
