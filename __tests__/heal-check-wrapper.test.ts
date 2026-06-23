export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

import { healCheckWrapper } from '../src/lib/heal-check-wrapper';

describe('healCheckWrapper', () => {
  let root: string;
  let asset: string;
  const BUNDLED = '#!/usr/bin/env node\nconsole.log("canonical check wrapper");\n';

  const readPkg = (): { scripts: Record<string, string> } => JSON.parse(filesystem.read(filesystem.path(root, 'package.json')) || '{}');
  const writePkg = (scripts: Record<string, string>): void => filesystem.write(filesystem.path(root, 'package.json'), { name: 'demo', scripts });
  const readScript = (): string => filesystem.read(filesystem.path(root, 'scripts', 'check.mjs')) || '';

  beforeEach(() => {
    root = filesystem.path('__tests__', `temp-heal-check-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    filesystem.dir(root);
    asset = filesystem.path(root, '_bundled-check.mjs');
    filesystem.write(asset, BUNDLED);
  });

  afterEach(() => {
    filesystem.remove(root);
  });

  it('installs the wrapper and rewires check -> check.mjs, original chain -> check:raw', () => {
    writePkg({ check: 'pnpm audit && pnpm run lint && pnpm test && pnpm run build' });
    const changed = healCheckWrapper(root, asset).sort();
    expect(changed).toEqual(['package.json', 'scripts/check.mjs']);
    const pkg = readPkg();
    expect(pkg.scripts.check).toBe('node scripts/check.mjs');
    expect(pkg.scripts['check:raw']).toBe('pnpm audit && pnpm run lint && pnpm test && pnpm run build');
    expect(readScript()).toBe(BUNDLED);
  });

  it('is idempotent (no changes on a second run)', () => {
    writePkg({ check: 'pnpm test' });
    healCheckWrapper(root, asset);
    expect(healCheckWrapper(root, asset)).toEqual([]);
  });

  it('keeps an existing check:raw instead of overwriting it', () => {
    writePkg({ check: 'pnpm run lint', 'check:raw': 'CUSTOM existing raw chain' });
    healCheckWrapper(root, asset);
    const pkg = readPkg();
    expect(pkg.scripts.check).toBe('node scripts/check.mjs');
    expect(pkg.scripts['check:raw']).toBe('CUSTOM existing raw chain');
  });

  it('refreshes scripts/check.mjs when it drifts from the bundled asset', () => {
    writePkg({ check: 'node scripts/check.mjs', 'check:raw': 'pnpm test' });
    filesystem.write(filesystem.path(root, 'scripts', 'check.mjs'), 'OLD CONTENT');
    const changed = healCheckWrapper(root, asset);
    expect(changed).toEqual(['scripts/check.mjs']);
    expect(readScript()).toBe(BUNDLED);
  });

  it('no-ops when the package has no check script', () => {
    writePkg({ build: 'tsc' });
    expect(healCheckWrapper(root, asset)).toEqual([]);
    expect(filesystem.exists(filesystem.path(root, 'scripts', 'check.mjs'))).toBeFalsy();
  });

  it('no-ops when the bundled asset is missing', () => {
    writePkg({ check: 'pnpm test' });
    expect(healCheckWrapper(root, filesystem.path(root, 'does-not-exist.mjs'))).toEqual([]);
  });

  it('handles a monorepo root chain (pnpm -r run check) -> becomes check:raw', () => {
    writePkg({ check: 'pnpm audit && pnpm -r --parallel run check' });
    healCheckWrapper(root, asset);
    const pkg = readPkg();
    expect(pkg.scripts.check).toBe('node scripts/check.mjs');
    expect(pkg.scripts['check:raw']).toBe('pnpm audit && pnpm -r --parallel run check');
  });

  it('installs the REAL bundled wrapper asset (integration) as valid, complete content', () => {
    const realAsset = filesystem.path(process.cwd(), 'src', 'templates', 'check', 'check.mjs');
    writePkg({ check: 'pnpm test' });
    const changed = healCheckWrapper(root, realAsset).sort();
    expect(changed).toEqual(['package.json', 'scripts/check.mjs']);
    const written = readScript();
    expect(written).toContain('Running checks for'); // the wrapper's banner
    expect(written).toContain('Check PASSED');
    expect(written.length).toBeGreaterThan(500);
  });
});
