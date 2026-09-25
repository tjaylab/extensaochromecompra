import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'happy-dom', include: ['lib/**/*.test.ts'], alias: { 'wxt/utils/define-content-script': new URL('./dev/define-content-script.stub.ts', import.meta.url).pathname } } });
