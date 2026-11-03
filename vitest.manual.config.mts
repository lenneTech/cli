import { defineConfig } from 'vitest/config';

import base from './vitest.config.mts';

/**
 * `npm run test:manual`: the `*.manual.ts` suites, which need a real service or OS integration
 * (live MongoDB, real launchctl + caddy) and are therefore excluded from `npm test`, not skipped.
 * Each keeps its own guard so a manual run self-skips instead of touching a live setup.
 *
 * Spread, not `mergeConfig`: vite merges arrays by concatenating them, so `include` would become
 * `*.test.ts` + `*.manual.ts` and the manual run would collect every regular suite as well.
 */
export default defineConfig({ ...base, test: { ...base.test, include: ['__tests__/*.manual.ts'] } });
