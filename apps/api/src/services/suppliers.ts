import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { isValidCnpj, normalizePhone, normalizeSupplierName, onlyDigits, type SupplierDTO, type SupplierMatch } from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { suppliers } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

type SupplierRow = typeof suppliers.$inferSelect;

export function supplierDTO(s: SupplierRow): SupplierDTO {
  return { id: s.id, name: s.name, phone: s.phoneE164, cnpj: s.cnpj, email: s.email, omie_id: s.omieId };
}

export function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export async function getSupplier(ctx: AppContext, companyId: string, id: string) {
  const [s] = await ctx.db.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.companyId, companyId))).limit(1);
  if (!s) throw notFound('Fornecedor');
  return s;
}

/** Suggests the supplier for a captured message: phone match first, then name. */
export async function matchSupplier(
  ctx: AppContext,
  companyId: string,
  input: { contactPhone?: string | null; contactName?: string | null; extractedName?: string | null },
): Promise<SupplierMatch> {
  const phone = normalizePhone(input.contactPhone);
  if (phone) {
    const [byPhone] = await ctx.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.companyId, companyId), eq(suppliers.phoneE164, phone)))
      .limit(1);
    if (byPhone) return { supplier: supplierDTO(byPhone), reason: 'phone', suggestions: [] };
  }
  const names = [input.extractedName, stripContactDecorations(input.contactName)]
    .filter((n): n is string => !!n && !!n.trim())
    .map(normalizeSupplierName)
    .filter(Boolean);
  if (!names.length) return { supplier: null, reason: null, suggestions: [] };

  const all = await ctx.db.select().from(suppliers).where(eq(suppliers.companyId, companyId));
  const exact = all.find((s) => names.includes(s.nameNormalized));
  if (exact) return { supplier: supplierDTO(exact), reason: 'name', suggestions: [] };
  const suggestions = all
    .filter((s) => names.some((n) => tokenOverlap(n, s.nameNormalized) > 0))
    .sort((a, b) => Math.max(...names.map((n) => tokenOverlap(n, b.nameNormalized))) - Math.max(...names.map((n) => tokenOverlap(n, a.nameNormalized))))
    .slice(0, 5)
    .map(supplierDTO);
  return { supplier: null, reason: null, suggestions };
}

/** "Carlos (Microsemi)" -> "Microsemi": WhatsApp contact names often carry the company in parentheses. */
function stripContactDecorations(name?: string | null) {
  if (!name) return null;
  const inParens = name.match(/\(([^)]+)\)/);
  return inParens ? inParens[1] : name;
}

function tokenOverlap(a: string, b: string) {
  const ta = new Set(a.split(' ').filter((t) => t.length > 2));
  return b.split(' ').filter((t) => t.length > 2 && ta.has(t)).length;
}

/** Creates a supplier, or returns the existing one with the same phone, CNPJ or normalized name. */
export async function findOrCreateSupplier(
  ctx: AppContext,
  member: Member,
  input: { name: string; phone?: string | null; cnpj?: string | null; email?: string | null },
): Promise<SupplierRow> {
  const name = input.name.trim();
  if (!name) throw badRequest('Informe o nome do fornecedor');
  const phone = normalizePhone(input.phone);
  const cnpj = input.cnpj ? onlyDigits(input.cnpj) : null;
  if (cnpj && !isValidCnpj(cnpj)) throw badRequest('CNPJ inválido');
  const normalized = normalizeSupplierName(name);

  const conds = [eq(suppliers.nameNormalized, normalized)];
  if (phone) conds.push(eq(suppliers.phoneE164, phone));
  if (cnpj) conds.push(eq(suppliers.cnpj, cnpj));
  const [existing] = await ctx.db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.companyId, member.companyId), or(...conds)))
    .limit(1);
  if (existing) {
    // Fill in what the existing record is missing.
    const patch: Partial<SupplierRow> = {};
    if (!existing.phoneE164 && phone) patch.phoneE164 = phone;
    if (!existing.cnpj && cnpj) patch.cnpj = cnpj;
    if (!existing.email && input.email) patch.email = input.email.trim();
    if (Object.keys(patch).length) {
      try {
        const [updated] = await ctx.db.update(suppliers).set(patch).where(eq(suppliers.id, existing.id)).returning();
        return updated;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return existing;
  }
  try {
    const [created] = await ctx.db
      .insert(suppliers)
      .values({ companyId: member.companyId, name, nameNormalized: normalized, phoneE164: phone, cnpj, email: input.email?.trim() || null, createdBy: member.userId })
      .returning();
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Já existe um fornecedor com este telefone ou CNPJ');
    throw err;
  }
}

export async function listSuppliers(ctx: AppContext, member: Member, q?: string) {
  const where = q?.trim()
    ? and(eq(suppliers.companyId, member.companyId), or(ilike(suppliers.name, `%${q.trim()}%`), ilike(suppliers.cnpj, `%${onlyDigits(q)}%`)))
    : eq(suppliers.companyId, member.companyId);
  const rows = await ctx.db.select().from(suppliers).where(where).orderBy(asc(suppliers.name)).limit(200);
  return rows.map(supplierDTO);
}

export async function updateSupplier(
  ctx: AppContext,
  member: Member,
  id: string,
  input: { name?: string; phone?: string | null; cnpj?: string | null; email?: string | null },
) {
  const current = await getSupplier(ctx, member.companyId, id);
  const patch: Partial<SupplierRow> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw badRequest('Informe o nome do fornecedor');
    patch.name = input.name.trim();
    patch.nameNormalized = normalizeSupplierName(input.name);
  }
  if (input.phone !== undefined) patch.phoneE164 = normalizePhone(input.phone);
  if (input.cnpj !== undefined) {
    const cnpj = input.cnpj ? onlyDigits(input.cnpj) : null;
    if (cnpj && !isValidCnpj(cnpj)) throw badRequest('CNPJ inválido');
    if (current.omieId && cnpj !== current.cnpj) throw conflict('Fornecedor já vinculado ao Omie; altere o CNPJ no Omie');
    patch.cnpj = cnpj;
  }
  if (input.email !== undefined) patch.email = input.email?.trim() || null;
  try {
    const [updated] = await ctx.db.update(suppliers).set(patch).where(eq(suppliers.id, id)).returning();
    return supplierDTO(updated);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Já existe um fornecedor com este telefone ou CNPJ');
    throw err;
  }
}
