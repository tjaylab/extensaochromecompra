import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../config.js';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: string;
  email: string;
}

export type VerifyToken = (token: string) => Promise<AuthUser>;

export function createTokenVerifier(cfg: Config): VerifyToken {
  if (cfg.AUTH_MODE === 'dev') {
    return async (token) => {
      const m = token.match(/^dev:(.+@.+)$/);
      if (!m) throw new HttpError(401, 'unauthorized', 'Sessão inválida');
      const email = m[1].trim().toLowerCase();
      return { id: uuidFromString(email), email };
    };
  }

  const issuer = `${cfg.SUPABASE_URL!.replace(/\/$/, '')}/auth/v1`;
  const secret = cfg.SUPABASE_JWT_SECRET ? new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET) : null;
  const jwks = secret ? null : createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (token) => {
    let payload: JWTPayload;
    try {
      const opts = { issuer, audience: 'authenticated' };
      payload = secret ? (await jwtVerify(token, secret, opts)).payload : (await jwtVerify(token, jwks!, opts)).payload;
    } catch {
      throw new HttpError(401, 'unauthorized', 'Sessão expirada. Entre novamente.');
    }
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!payload.sub || !email) throw new HttpError(401, 'unauthorized', 'Sessão inválida');
    return { id: payload.sub, email };
  };
}

/** Deterministic UUID-shaped id for dev users. */
function uuidFromString(s: string): string {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
