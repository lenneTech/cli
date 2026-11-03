import { defineConfig } from 'vitest/config';

/**
 * Test runner for `npm test`. Replaced jest + ts-jest on 2026-11-03: jest-config depends on
 * deepmerge, whose GHSA-gcqx-w48m-w2h4 has no patched release, and the audit gate fails on it.
 */
export default defineConfig({
  // Probe extensionless files in Node's order, `.js` before `.mjs`. Vite's default tries `.mjs`
  // first and then loads a package such as graphql twice (its ESM build for an `import`, the CJS
  // build for every `require`). Same line as in nest-server's vitest configs.
  resolve: { extensions: ['.js', '.mjs', '.mts', '.ts', '.jsx', '.tsx', '.json'] },
  test: {
    // Console output goes straight to the process streams instead of through vitest's
    // worker→main RPC, whose in-flight calls are rejected at worker teardown and fail a run with
    // every test green (`EnvironmentTeardownError`). nest-server measured it at about 1 in 10 runs.
    disableConsoleIntercept: true,
    environment: 'node',
    globals: true,
    hookTimeout: 60_000,
    // Top-level only, as jest's `<rootDir>/*.test.ts` was: `*.manual.ts` needs a real service
    // (`npm run test:manual`) and is excluded, not skipped, and a stray
    // `__tests__/temp-*/…/*.test.ts` left by an aborted run is never collected.
    include: ['__tests__/*.test.ts'],
    // A fresh module graph per file: several suites set process-wide state (env, cwd, HOME).
    isolate: true,
    pool: 'forks',
    // Isolation FIRST: it must set the per-user state paths before anything imports src/.
    setupFiles: ['__tests__/support/isolate-user-state.setup.ts', '__tests__/support/signal-guard.setup.ts'],
    testTimeout: 60_000,
  },
});
