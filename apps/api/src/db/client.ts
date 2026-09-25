import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type DB = PostgresJsDatabase<typeof schema>;

export interface Database {
  db: DB;
  /** Runs a multi-statement SQL script. */
  exec(sql: string): Promise<void>;
  /** Runs a multi-statement SQL script inside one transaction. */
  execInTransaction(sql: string): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Postgres (Supabase) when a connection string is given, otherwise embedded PGlite.
 * `pgliteDir` = "memory://" keeps the database in memory (tests).
 */
export async function openDatabase(opts: { databaseUrl?: string; pgliteDir: string }): Promise<Database> {
  if (opts.databaseUrl) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    // prepare:false keeps it compatible with Supabase's transaction-mode pooler.
    const sql = postgres(opts.databaseUrl, { prepare: false, max: 10 });
    return {
      db: drizzle(sql, { schema }),
      exec: async (script) => {
        await sql.unsafe(script);
      },
      execInTransaction: async (script) => {
        await sql.begin(async (tx) => {
          await tx.unsafe(script);
        });
      },
      close: () => sql.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  if (!opts.pgliteDir.startsWith('memory://')) await mkdir(opts.pgliteDir, { recursive: true });
  const client = new PGlite(opts.pgliteDir);
  await client.waitReady;
  return {
    // The PGlite and postgres-js drivers share the same query-builder surface.
    db: drizzle(client, { schema }) as unknown as DB,
    exec: async (script) => {
      await client.exec(script);
    },
    execInTransaction: async (script) => {
      await client.transaction(async (tx) => {
        await tx.exec(script);
      });
    },
    close: () => client.close(),
  };
}

export async function migrate(database: Database, log: (msg: string) => void = () => {}): Promise<string[]> {
  await database.exec(
    `create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now());
     alter table _migrations enable row level security;`,
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const safeName = file.replace(/'/g, "''");
    const rows = (await database.db.execute(`select 1 from _migrations where name = '${safeName}'`)) as unknown;
    const found = Array.isArray(rows) ? rows.length > 0 : ((rows as { rows?: unknown[] }).rows?.length ?? 0) > 0;
    if (found) continue;
    const script = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await database.execInTransaction(`${script}\ninsert into _migrations (name) values ('${safeName}');`);
    log(`migration applied: ${file}`);
    applied.push(file);
  }
  return applied;
}
