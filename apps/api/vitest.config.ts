import { defineConfig } from 'vitest/config';

// Each test file boots its own PGlite database; on a cold start several at once can exceed the default 10 s.
export default defineConfig({ test: { hookTimeout: 30_000, testTimeout: 30_000 } });
