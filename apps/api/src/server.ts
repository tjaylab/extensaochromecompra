import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const { app } = await buildApp({ cfg });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: cfg.PORT, host: cfg.HOST });
