import { and, eq, isNull } from 'drizzle-orm';
import type { MeDTO, OmieStatus } from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { companies, invitations, memberships } from '../db/schema.js';
import type { AuthUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, HttpError } from '../lib/errors.js';
import { OmieError, type OmieGateway } from '../omie/gateway.js';
import { LiveOmie } from '../omie/live.js';
import { MockOmie } from '../omie/mock.js';
import { onlyDigits } from '@compras/shared';
import { assertSeat, isSuperadmin } from './billing.js';
import { logEvent } from './events.js';

/** Resolves the user's company membership, accepting a pending invitation on first login. */
export async function resolveMember(ctx: AppContext, user: AuthUser): Promise<Member | null> {
  const [m] = await ctx.db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (m) return { userId: m.userId, email: m.email, companyId: m.companyId, role: m.role };

  const [inv] = await ctx.db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, user.email), isNull(invitations.acceptedAt)))
    .limit(1);
  if (!inv) return null;
  await ctx.db.insert(memberships).values({ userId: user.id, companyId: inv.companyId, email: user.email, role: inv.role }).onConflictDoNothing();
  await ctx.db.update(invitations).set({ acceptedAt: new Date().toISOString() }).where(eq(invitations.id, inv.id));
  return { userId: user.id, email: user.email, companyId: inv.companyId, role: inv.role };
}

export async function getMe(ctx: AppContext, user: AuthUser, member: Member | null): Promise<MeDTO> {
  const mode = ctx.cfg.OMIE_MODE;
  const is_superadmin = isSuperadmin(ctx, user.email);
  if (!member) return { user, company: null, role: null, omie: { status: 'not_configured', checked_at: null, mode }, is_superadmin };
  const [c] = await ctx.db.select().from(companies).where(eq(companies.id, member.companyId)).limit(1);
  return {
    user,
    company: { id: c.id, name: c.name, cnpj: c.cnpj },
    role: member.role,
    omie: {
      status: mode === 'mock' ? 'connected' : (c.omieStatus as OmieStatus),
      checked_at: mode === 'mock' ? null : c.omieCheckedAt,
      mode,
    },
    is_superadmin,
  };
}

export async function createCompany(ctx: AppContext, user: AuthUser, input: { name: string; cnpj?: string | null }) {
  const existing = await resolveMember(ctx, user);
  if (existing) throw conflict('Você já pertence a uma empresa');
  const name = input.name.trim();
  if (!name) throw badRequest('Informe o nome da empresa');
  const [c] = await ctx.db
    .insert(companies)
    .values({ name, cnpj: input.cnpj ? onlyDigits(input.cnpj) : null })
    .returning();
  await ctx.db.insert(memberships).values({ userId: user.id, companyId: c.id, email: user.email, role: 'admin' });
  await logEvent(ctx, { companyId: c.id, userId: user.id, type: 'company_created', entityId: c.id });
  return c;
}

export async function inviteMember(ctx: AppContext, member: Member, input: { email: string; role?: 'admin' | 'buyer' }) {
  if (member.role !== 'admin') throw forbidden('Apenas administradores convidam usuários');
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('E-mail inválido');
  const [already] = await ctx.db.select().from(memberships).where(eq(memberships.email, email)).limit(1);
  if (already) throw conflict('Este usuário já pertence a uma empresa');
  const [pending] = await ctx.db
    .select()
    .from(invitations)
    .where(and(eq(invitations.companyId, member.companyId), eq(invitations.email, email), isNull(invitations.acceptedAt)))
    .limit(1);
  if (!pending) await assertSeat(ctx, member.companyId);
  await ctx.db
    .insert(invitations)
    .values({ companyId: member.companyId, email, role: input.role ?? 'buyer' })
    .onConflictDoUpdate({ target: [invitations.companyId, invitations.email], set: { role: input.role ?? 'buyer', acceptedAt: null } });
  return { email, role: input.role ?? 'buyer' };
}

export async function listMembers(ctx: AppContext, member: Member) {
  const members = await ctx.db.select().from(memberships).where(eq(memberships.companyId, member.companyId));
  const pending = await ctx.db
    .select()
    .from(invitations)
    .where(and(eq(invitations.companyId, member.companyId), isNull(invitations.acceptedAt)));
  return {
    members: members.map((m) => ({ email: m.email, role: m.role })),
    invitations: pending.map((i) => ({ email: i.email, role: i.role })),
  };
}

function liveGateway(ctx: AppContext, appKey: string, appSecret: string): OmieGateway {
  return ctx.makeLiveOmie
    ? ctx.makeLiveOmie(appKey, appSecret)
    : new LiveOmie(appKey, appSecret, fetch, (msg, data) => ctx.log.info({ ...data }, msg));
}

/** The Omie gateway for a company: simulated in OMIE_MODE=mock, otherwise its stored credentials. */
export async function getOmie(ctx: AppContext, companyId: string): Promise<OmieGateway> {
  if (ctx.cfg.OMIE_MODE === 'mock') return new MockOmie(companyId);
  const [c] = await ctx.db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c?.omieAppKeyEnc || !c.omieAppSecretEnc) {
    throw new HttpError(409, 'omie_not_configured', 'Conecte a conta Omie em Configurações antes de continuar.');
  }
  return liveGateway(ctx, ctx.secrets.decrypt(c.omieAppKeyEnc), ctx.secrets.decrypt(c.omieAppSecretEnc));
}

export async function saveOmieCredentials(ctx: AppContext, member: Member, input: { app_key: string; app_secret: string }) {
  if (member.role !== 'admin') throw forbidden('Apenas administradores conectam o Omie');
  const appKey = input.app_key.trim();
  const appSecret = input.app_secret.trim();
  if (!appKey || !appSecret) throw badRequest('Informe App Key e App Secret');
  const gateway = ctx.cfg.OMIE_MODE === 'mock' ? new MockOmie(member.companyId) : liveGateway(ctx, appKey, appSecret);
  try {
    await gateway.testConnection();
  } catch (err) {
    if (err instanceof OmieError) throw badRequest(`O Omie recusou as credenciais: ${err.message}`);
    throw err;
  }
  const now = new Date().toISOString();
  await ctx.db
    .update(companies)
    .set({
      omieAppKeyEnc: ctx.secrets.encrypt(appKey),
      omieAppSecretEnc: ctx.secrets.encrypt(appSecret),
      omieStatus: 'connected',
      omieCheckedAt: now,
    })
    .where(eq(companies.id, member.companyId));
  await logEvent(ctx, { companyId: member.companyId, userId: member.userId, type: 'omie_credentials_saved' });
  return { status: 'connected' as const, checked_at: now };
}

export async function checkOmie(ctx: AppContext, member: Member) {
  const now = new Date().toISOString();
  let status: OmieStatus = 'connected';
  let message: string | null = null;
  try {
    const gateway = await getOmie(ctx, member.companyId);
    await gateway.testConnection();
  } catch (err) {
    if (err instanceof HttpError && err.code === 'omie_not_configured') {
      status = 'not_configured';
      message = err.message;
    } else if (err instanceof OmieError) {
      status = err.retryable ? 'error' : 'invalid';
      message = err.message;
    } else throw err;
  }
  if (ctx.cfg.OMIE_MODE === 'live') {
    await ctx.db.update(companies).set({ omieStatus: status, omieCheckedAt: now }).where(eq(companies.id, member.companyId));
  }
  return { status, checked_at: now, message };
}
