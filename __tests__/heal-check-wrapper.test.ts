export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

import { execFileSync } from 'child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { healCheckWrapper, resolveCopySet } from '../src/lib/heal-check-wrapper';

describe('healCheckWrapper', () => {
  let root: string;
  let assetDir: string;
  let asset: string;
  const BUNDLED = '#!/usr/bin/env node\nconsole.log("canonical check wrapper");\n';

  const readPkg = (): { scripts: Record<string, string> } => JSON.parse(filesystem.read(filesystem.path(root, 'package.json')) || '{}');
  const writePkg = (scripts: Record<string, string>): void => filesystem.write(filesystem.path(root, 'package.json'), { name: 'demo', scripts });
  const readScript = (): string => filesystem.read(filesystem.path(root, 'scripts', 'check.mjs')) || '';

  // Fixtures live in the OS tmpdir, NOT under `__tests__/`: `.gitignore` ignores
  // `__tests__/temp-*`, and an ignored path makes `git status --porcelain`
  // report nothing — which silently disables the very guard several of these
  // tests exist to exercise.
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-heal-check-'));
    assetDir = mkdtempSync(join(tmpdir(), 'lt-heal-asset-'));
    asset = join(assetDir, 'check.mjs');
    writeFileSync(asset, BUNDLED);
  });

  afterEach(() => {
    filesystem.remove(root);
    filesystem.remove(assetDir);
  });

  /** Turn the fixture into a real git repo, optionally committing what is there. */
  const gitInit = (commit = true): void => {
    const run = (...args: string[]): void => {
      execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
    };
    run('init');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'Test');
    if (commit) {
      run('add', '-A');
      run('commit', '-m', 'init');
    }
  };

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

  describe('import closure', () => {
    /** Give the bundled asset a relative import plus the file it names. */
    const addSibling = (name: string, body = 'export const x = 1;\n', importer = asset): void => {
      writeFileSync(join(assetDir, name), body);
      writeFileSync(importer, `import { x } from "./${name}";\n${readFileSync(importer, 'utf8')}`);
    };

    it('ships every module the wrapper imports, under the name it imports it by', () => {
      addSibling('helper.mjs');
      writePkg({ check: 'pnpm test' });
      const changed = healCheckWrapper(root, asset).sort();
      expect(changed).toEqual(['package.json', 'scripts/check.mjs', 'scripts/helper.mjs']);
      expect(existsSync(join(root, 'scripts', 'helper.mjs'))).toBe(true);
    });

    it('follows the closure transitively', () => {
      addSibling('first.mjs');
      addSibling('second.mjs', 'export const y = 2;\n', join(assetDir, 'first.mjs'));
      expect(resolveCopySet(asset).map((c) => c.rel).sort()).toEqual([
        'scripts/check.mjs',
        'scripts/first.mjs',
        'scripts/second.mjs',
      ]);
    });

    it('ignores files in the asset dir that the wrapper does not import', () => {
      writeFileSync(join(assetDir, 'unrelated.mjs'), 'export const nope = 1;\n');
      expect(resolveCopySet(asset).map((c) => c.rel)).toEqual(['scripts/check.mjs']);
    });

    it('never claims scripts/check.mjs twice when the asset has another name', () => {
      // The asset always lands as scripts/check.mjs. A check.mjs sitting BESIDE a
      // differently-named asset must not map onto that same target.
      const renamed = join(assetDir, 'check-v2.mjs');
      writeFileSync(renamed, 'import { x } from "./check.mjs";\n');
      const rels = resolveCopySet(renamed).map((c) => c.rel);
      expect(rels).toEqual(['scripts/check.mjs']);
      expect(new Set(rels).size).toBe(rels.length);
    });

    it('matches both quote styles — the bundled files are formatted by the consuming project', () => {
      writeFileSync(join(assetDir, 'single.mjs'), 'export const a = 1;\n');
      writeFileSync(join(assetDir, 'double.mjs'), 'export const b = 2;\n');
      writeFileSync(asset, "import { a } from './single.mjs';\nimport { b } from \"./double.mjs\";\n");
      expect(resolveCopySet(asset).map((c) => c.rel).sort()).toEqual([
        'scripts/check.mjs',
        'scripts/double.mjs',
        'scripts/single.mjs',
      ]);
    });
  });

  describe('protecting local work', () => {
    it('skips the WHOLE set when a tracked member has uncommitted changes', () => {
      writePkg({ check: 'node scripts/check.mjs', 'check:raw': 'pnpm test' });
      filesystem.write(filesystem.path(root, 'scripts', 'check.mjs'), 'HAND-EDITED, EXISTS NOWHERE ELSE');
      gitInit();
      filesystem.write(filesystem.path(root, 'scripts', 'check.mjs'), 'HAND-EDITED, then changed again');

      const changed = healCheckWrapper(root, asset);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain('skipped: uncommitted changes');
      expect(readScript()).toBe('HAND-EDITED, then changed again');
    });

    it('does not partially update the set — the atomicity that prevents version drift', () => {
      // The real migration path: a project healed BEFORE the wrapper grew a
      // sibling has a tracked, committed check.mjs. The first heal adds the
      // sibling as an UNTRACKED file. If the next heal updated check.mjs while
      // skipping that sibling, the two would land on different versions and the
      // project's `check` would die on the import.
      writeFileSync(join(assetDir, 'gate.mjs'), 'export const gate = 1;\n');
      writeFileSync(asset, `import { gate } from "./gate.mjs";\n${BUNDLED}`);
      writePkg({ check: 'pnpm test' });
      healCheckWrapper(root, asset);
      gitInit();

      // Hand-edit the sibling only, then ship a new bundled version of BOTH.
      filesystem.write(filesystem.path(root, 'scripts', 'gate.mjs'), 'export const gate = "LOCAL EDIT";\n');
      writeFileSync(join(assetDir, 'gate.mjs'), 'export const gate = 3;\n');
      writeFileSync(asset, `import { gate } from "./gate.mjs";\n${BUNDLED}// v3\n`);

      const changed = healCheckWrapper(root, asset);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain('skipped');
      // Neither moved — no drift.
      expect(readScript()).not.toContain('v3');
      expect(readFileSync(join(root, 'scripts', 'gate.mjs'), 'utf8')).toContain('LOCAL EDIT');
    });

    it('overwrites a tracked-and-clean file (git can restore it)', () => {
      writePkg({ check: 'node scripts/check.mjs', 'check:raw': 'pnpm test' });
      filesystem.write(filesystem.path(root, 'scripts', 'check.mjs'), 'OLD BUT COMMITTED');
      gitInit();

      expect(healCheckWrapper(root, asset)).toEqual(['scripts/check.mjs']);
      expect(readScript()).toBe(BUNDLED);
    });

    it('backs up an unversioned file instead of destroying it', () => {
      // Not tracked, so git holds no copy: an overwrite would be unrecoverable.
      // Refusing outright is not an option either — the wrapper's own previous
      // output is untracked until the user commits it, and a refusal there would
      // block every future update.
      writePkg({ check: 'node scripts/check.mjs', 'check:raw': 'pnpm test' });
      filesystem.write(filesystem.path(root, 'scripts', 'check.mjs'), 'UNVERSIONED CONTENT');
      gitInit(false);

      expect(healCheckWrapper(root, asset)).toEqual(['scripts/check.mjs']);
      expect(readScript()).toBe(BUNDLED);
      expect(readFileSync(join(root, 'scripts', 'check.mjs.bak'), 'utf8')).toBe('UNVERSIONED CONTENT');
    });

    it('keeps the FIRST backup across repeated runs', () => {
      writePkg({ check: 'node scripts/check.mjs', 'check:raw': 'pnpm test' });
      filesystem.write(filesystem.path(root, 'scripts', 'check.mjs'), 'ORIGINAL');
      healCheckWrapper(root, asset);
      writeFileSync(asset, `${BUNDLED}// newer\n`);
      healCheckWrapper(root, asset);
      expect(readFileSync(join(root, 'scripts', 'check.mjs.bak'), 'utf8')).toBe('ORIGINAL');
    });

    it('refuses to write through a symlink', () => {
      // copyFileSync follows the link and writes to its target — outside the
      // project — while git reports the unchanged link blob as clean.
      writePkg({ check: 'node scripts/check.mjs', 'check:raw': 'pnpm test' });
      const outside = join(assetDir, 'outside.mjs');
      writeFileSync(outside, 'MUST NOT BE OVERWRITTEN');
      filesystem.dir(filesystem.path(root, 'scripts'));
      symlinkSync(outside, join(root, 'scripts', 'check.mjs'));

      const changed = healCheckWrapper(root, asset);
      expect(changed.join(' ')).toContain('skipped');
      expect(readFileSync(outside, 'utf8')).toBe('MUST NOT BE OVERWRITTEN');
      expect(lstatSync(join(root, 'scripts', 'check.mjs')).isSymbolicLink()).toBe(true);
    });
  });

  it('installs the REAL bundled wrapper asset (integration) as valid, complete content', () => {
    const realAsset = filesystem.path(process.cwd(), 'src', 'templates', 'check', 'check.mjs');
    writePkg({ check: 'pnpm test' });
    const changed = healCheckWrapper(root, realAsset).sort();
    // A superset check, not an exact match: a genuine new sibling must not break
    // this test — that is what the closure assertion below is for.
    expect(changed).toEqual(expect.arrayContaining(['package.json', 'scripts/check.mjs']));
    const written = readScript();
    expect(written).toContain('Running checks for'); // the wrapper's banner
    expect(written).toContain('Check PASSED');
    expect(written.length).toBeGreaterThan(500);

    // Every relative import the wrapper makes has to have landed next to it.
    // Shipping `check.mjs` alone installs a file that dies on its first import
    // with ERR_MODULE_NOT_FOUND — before running a single step, so the project
    // has no `check` at all. Derived from the file rather than hard-coded, so
    // the next sibling is covered without touching this test.
    //
    // Both quote styles: these templates are formatted by the CONSUMING
    // project's formatter, so their quote style is not ours to assume. Matching
    // only one is how this assertion silently became vacuous once before.
    const specs = [...written.matchAll(/^import .* from ['"](\.\/[^'"]+)['"];$/gm)].map(([, spec]) => spec);
    expect(specs.length).toBeGreaterThan(0); // the loop below must never be vacuous
    for (const spec of specs) {
      const sibling = spec.replace('./', '');
      expect(changed).toContain(`scripts/${sibling}`);
      expect(filesystem.exists(filesystem.path(root, 'scripts', sibling))).toBe('file');
    }
  });
});
