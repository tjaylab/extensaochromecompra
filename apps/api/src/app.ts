import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Config } from './config.js';
import { JobRunner, type AppContext, type Member } from './context.js';
import { migrate, openDatabase, type Database } from './db/client.js';
import { createExtractor, type Extractor } from './extraction/extractor.js';
import { createTokenVerifier, type AuthUser, type VerifyToken } from './lib/auth.js';
import { Secrets } from './lib/crypto.js';
import { HttpError } from './lib/errors.js';
import type { OmieGateway } from './omie/gateway.js';
import { registerRoutes } from './routes.js';
import { resolveMember } from './services/companies.js';
import { resumeSendingOrders } from './services/orders.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    member: Member | null;
  }
}

export interface BuildOptions {
  cfg: Config;
  database?: Database;
  extractor?: Extractor;
  verifyToken?: VerifyToken;
  jobRetryBaseMs?: number;
  makeLiveOmie?: (appKey: string, appSecret: string) => OmieGateway;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions) {
  const { cfg } = opts;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: cfg.LOG_LEVEL, redact: ['req.headers.authorization', 'body.app_key', 'body.app_secret'] },
    bodyLimit: 256 * 1024,
  });

  const database = opts.database ?? (await openDatabase({ databaseUrl: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR }));
  await migrate(database, (m) => app.log.info(m));

  const ctx: AppContext = {
    cfg,
    db: database.db,
    secrets: new Secrets(cfg.ENCRYPTION_KEY, () => app.log.warn('ENCRYPTION_KEY not set: using an insecure development key')),
    extractor: opts.extractor ?? createExtractor(cfg),
    jobs: new JobRunner(app.log, opts.jobRetryBaseMs ?? 2000),
    log: app.log,
    makeLiveOmie: opts.makeLiveOmie,
  };
  if (cfg.EXTRACTION_MODE === 'mock' && !opts.extractor) app.log.warn('EXTRACTION_MODE=mock: messages are parsed by a simple local heuristic, not by Claude');
  if (cfg.OMIE_MODE === 'mock') app.log.warn('OMIE_MODE=mock: Omie is simulated in memory');

  const allowed = cfg.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, server-to-server
      if (allowed.length ? allowed.includes(origin) : origin.startsWith('chrome-extension://')) return cb(null, true);
      if (cfg.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      cb(null, false); // no CORS headers: the browser blocks the call
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  const verify = opts.verifyToken ?? createTokenVerifier(cfg);
  app.decorateRequest('user', null);
  app.decorateRequest('member', null);
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/v1/')) return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'unauthorized', 'Entre para continuar');
    req.user = await verify(token);
    req.member = await resolveMember(ctx, req.user);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.status >= 500) req.log.error({ err: err.cause ?? err }, err.code);
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation || (e.statusCode && e.statusCode < 500)) {
      return reply.status(e.statusCode ?? 400).send({ error: { code: 'bad_request', message: e.message ?? 'Requisição inválida' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Erro inesperado. Tente novamente.' } });
  });

  registerRoutes(app, ctx);

  app.addHook('onReady', async () => {
    const resumed = await resumeSendingOrders(ctx);
    if (resumed) app.log.info({ resumed }, 'resumed orders stuck in sending');
  });
  app.addHook('onClose', async () => {
    await ctx.jobs.idle();
    if (!opts.database) await database.close();
  });

  return { app, ctx, database };
}
