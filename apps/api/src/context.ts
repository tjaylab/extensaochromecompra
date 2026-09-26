import type { Config } from './config.js';
import type { DB } from './db/client.js';
import type { Extractor, Scanner } from './extraction/extractor.js';
import type { Secrets } from './lib/crypto.js';
import type { OmieGateway } from './omie/gateway.js';

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

export interface Member {
  userId: string;
  email: string;
  companyId: string;
  role: 'admin' | 'buyer';
}

export interface AppContext {
  cfg: Config;
  db: DB;
  secrets: Secrets;
  extractor: Extractor;
  scanner: Scanner;
  jobs: JobRunner;
  log: Logger;
  /** Overridable in tests to inject a fake live gateway. */
  makeLiveOmie?: (appKey: string, appSecret: string) => OmieGateway;
}

/**
 * Minimal in-process job runner with retries and exponential backoff.
 * Good enough for the pilot (one API instance); orders left in "sending" are resumed on boot.
 */
export class JobRunner {
  private running = new Map<string, Promise<void>>();

  constructor(
    private log: Logger,
    private baseDelayMs = 2000,
    private maxAttempts = 5,
  ) {}

  /** Runs fn(attempt) until it resolves, throws a non-retryable error, or attempts run out. */
  enqueue(key: string, fn: (attempt: number) => Promise<void>, isRetryable: (err: unknown) => boolean, onGiveUp: (err: unknown) => Promise<void>) {
    if (this.running.has(key)) return;
    const p = (async () => {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        try {
          await fn(attempt);
          return;
        } catch (err) {
          const retry = isRetryable(err) && attempt < this.maxAttempts;
          this.log.warn({ key, attempt, retry, err: String(err) }, 'job attempt failed');
          if (!retry) {
            await onGiveUp(err).catch((e) => this.log.error({ key, err: String(e) }, 'job give-up handler failed'));
            return;
          }
          await new Promise((r) => setTimeout(r, this.baseDelayMs * 2 ** (attempt - 1)));
        }
      }
    })().finally(() => this.running.delete(key));
    this.running.set(key, p);
  }

  /** Resolves when every job currently running has finished (tests, graceful shutdown). */
  async idle() {
    while (this.running.size) await Promise.all([...this.running.values()]);
  }
}
