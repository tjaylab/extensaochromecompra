import { loadConfig } from '../config.js';
import { migrate, openDatabase } from './client.js';

const cfg = loadConfig();
const database = await openDatabase({ databaseUrl: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR });
const applied = await migrate(database, console.log);
console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
await database.close();
