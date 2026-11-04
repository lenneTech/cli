/**
 * Vitest `setupFiles`, listed FIRST: points every per-user state file the CLI knows about at a
 * throwaway directory before a test file imports anything from `src/`.
 *
 * Why: vitest evaluates a file's imports before its first statement (ES module order). A
 * `process.env.LT_DEV_REGISTRY_PATH = …` written between two imports, which ts-jest ran in place,
 * now runs after `dev-state.ts` and `caddy.ts` have captured their paths at import time. The first
 * vitest run (2026-11-03) wrote test fixtures into the real `~/.lenneTech/projects.json` and
 * `~/.lenneTech/Caddyfile` exactly that way. Set here, the values are in place before any module
 * of the test file is evaluated. They are set unconditionally: a developer shell that exports one
 * of them at a real file must not hand that file to the suite.
 *
 * `__tests__/test-isolation.test.ts` fails when a module resolves one of these paths outside the
 * temp directory, so a new per-user file has to be added here before it can reach a real one.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'lt-test-user-state-'));

process.env.CLAUDE_CONFIG_DIR = join(root, 'claude');
process.env.LT_CLAUDE_PERMISSION_LEDGER = join(root, 'claude-plugin-permissions.json');
process.env.LT_CONFIG_DIR = join(root, 'lenneTech');
process.env.LT_DEV_CADDYFILE = join(root, 'Caddyfile');
process.env.LT_DEV_REGISTRY_PATH = join(root, 'projects.json');
process.env.LT_DEV_SESSION_SALT_PATH = join(root, 'dev-session-salt');
process.env.LT_MARKETPLACE_CONFIG = join(root, 'claude-marketplaces.json');
// Not a file, but per-user state all the same: the developer's running Caddy. A reload replaces
// its whole config, and one red test did exactly that on 2026-11-05 (DEV-4005). Port 1 has no
// listener on a developer machine, so every probe reads "not running" and every reload fails.
process.env.LT_DEV_CADDY_ADMIN = '127.0.0.1:1';
// Not per-user state, but the same rule: `lt fullstack update` and `lt dev doctor` fetch the check
// wrapper from lt-monorepo. A path that does not exist fails fast and offline; a suite that needs
// a release points this at its own fixture repository.
process.env.LT_CHECK_WRAPPER_SOURCE = join(root, 'no-lt-monorepo');

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});
