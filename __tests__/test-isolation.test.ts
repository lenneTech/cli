import { realpathSync } from 'fs';
import { tmpdir } from 'os';
import { relative, resolve } from 'path';

import { paths as caddyPaths } from '../src/lib/caddy';
import { getClaudeConfigDir } from '../src/lib/claude-cli';
import { paths as devStatePaths } from '../src/lib/dev-state';
import { getLtConfigDir, getMarketplaceConfigPath } from '../src/lib/marketplace-config';
import { getPermissionLedgerPath } from '../src/lib/plugin-permissions';
import config from '../vitest.config.mts';
import manualConfig from '../vitest.manual.config.mts';

/**
 * No test may read or write the developer's own state files. The first vitest run wrote fixtures
 * into the real `~/.lenneTech/projects.json` and Caddyfile, because two modules capture their path
 * at import time (see `support/isolate-user-state.setup.ts`). This file imports those modules the
 * way every other test does and checks where they ended up pointing.
 */
describe('test isolation', () => {
  // `.native` on both sides: on the Windows runner `tmpdir()` is the 8.3 short form
  // (`RUNNER~1`), which only the native call expands (see `dev-ticket.test.ts`).
  const temp = realpathSync.native(tmpdir());
  const insideTemp = (path: string): boolean => {
    const rel = relative(temp, realpathSync.native(resolve(path, '..')));
    return rel !== '' && !rel.startsWith('..');
  };

  it('points every per-user state file of the CLI into the temp directory', () => {
    const resolved = {
      caddyfile: caddyPaths.caddyfile,
      claudeConfigDir: getClaudeConfigDir(),
      ltConfigDir: getLtConfigDir(),
      marketplaceConfig: getMarketplaceConfigPath(),
      permissionLedger: getPermissionLedgerPath(),
      registry: devStatePaths.registry,
      sessionSalt: process.env.LT_DEV_SESSION_SALT_PATH ?? '',
    };
    const outside = Object.entries(resolved).filter(([, path]) => !insideTemp(path));
    expect(outside).toEqual([]);
  });

  it('arms the isolation before every other setup file', () => {
    expect(config.test?.setupFiles?.[0]).toBe('__tests__/support/isolate-user-state.setup.ts');
  });

  it('keeps the isolation for the manual run, which collects only *.manual.ts', () => {
    expect(manualConfig.test?.setupFiles?.[0]).toBe('__tests__/support/isolate-user-state.setup.ts');
    expect(manualConfig.test?.include).toEqual(['__tests__/*.manual.ts']);
  });
});
