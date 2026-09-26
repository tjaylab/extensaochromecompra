import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  // Postgres connection string (Supabase: Project Settings > Database > Connection string, pooler / transaction mode).
  // Empty = embedded PGlite for local development.
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./.data/pglite'),
  // "supabase": verify Supabase Auth JWTs. "dev": accept "dev:<email>" tokens (local only).
  AUTH_MODE: z.enum(['supabase', 'dev']).default('supabase'),
  SUPABASE_URL: z.string().optional(),
  // Legacy HS256 JWT secret. When empty, tokens are verified against the project's JWKS.
  SUPABASE_JWT_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Required when the API key is not scoped to a workspace (Console > Settings > Workspaces).
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  EXTRACTION_MODE: z.enum(['claude', 'mock']).optional(),
  CLAUDE_MODEL: z.string().default('claude-opus-5'),
  CLAUDE_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  // "live" calls app.omie.com.br with each company's credentials. "mock" simulates Omie in memory.
  OMIE_MODE: z.enum(['live', 'mock']).default('live'),
  // 32 bytes, base64. Encrypts Omie credentials at rest.
  ENCRYPTION_KEY: z.string().optional(),
  // Comma-separated allowed origins, e.g. chrome-extension://abcdef... Empty = any chrome-extension:// origin.
  CORS_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  // Optional: e-mail purchase orders to suppliers (resend.com). Without it the panel opens the buyer's e-mail app.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(), // e.g. "Compras Um Grau e Meio <compras@seudominio.com.br>"
});

export type Config = z.infer<typeof Env> & { EXTRACTION_MODE: 'claude' | 'mock' };

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof Env>, string>> = {}): Config {
  const parsed = Env.parse({ ...process.env, ...overrides });
  const extractionMode = parsed.EXTRACTION_MODE ?? (parsed.ANTHROPIC_API_KEY ? 'claude' : 'mock');
  const cfg = { ...parsed, EXTRACTION_MODE: extractionMode };
  if (cfg.NODE_ENV === 'production') {
    if (cfg.AUTH_MODE === 'dev') throw new Error('AUTH_MODE=dev is not allowed in production');
    if (!cfg.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
    if (!cfg.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required in production');
    if (cfg.EXTRACTION_MODE === 'mock') throw new Error('EXTRACTION_MODE=mock is not allowed in production');
  }
  if (cfg.AUTH_MODE === 'supabase' && !cfg.SUPABASE_URL) {
    throw new Error('SUPABASE_URL is required when AUTH_MODE=supabase');
  }
  return cfg;
}
