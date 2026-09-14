export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

import { execFileSync } from 'child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import {
  compareVersions,
  compareWrapperVersions,
  healCheckWrapper,
  keptWrapperReason,
  readWrapperVersion,
  resolveCopySet,
} from '../src/lib/heal-check-wrapper';
import { evalInNodeEsm } from './check-template-esm';

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

    it('follows imports into subdirectories, resolved against the importing file', () => {
      // The lt-monorepo wrapper imports `./lib/audit-report.mjs`, which in turn
      // imports `./ansi.mjs` — i.e. `lib/ansi.mjs`, not `scripts/ansi.mjs`.
      mkdirSync(join(assetDir, 'lib'));
      writeFileSync(join(assetDir, 'lib', 'ansi.mjs'), 'export const C = {};\n');
      writeFileSync(join(assetDir, 'lib', 'report.mjs'), "import { C } from './ansi.mjs';\nexport const r = C;\n");
      writeFileSync(asset, `import {\n  r,\n} from './lib/report.mjs';\n${BUNDLED}`);
      writePkg({ check: 'pnpm test' });

      expect(resolveCopySet(asset).map((c) => c.rel).sort()).toEqual([
        'scripts/check.mjs',
        'scripts/lib/ansi.mjs',
        'scripts/lib/report.mjs',
      ]);
      expect(healCheckWrapper(root, asset)).toEqual(expect.arrayContaining(['scripts/lib/ansi.mjs']));
      expect(existsSync(join(root, 'scripts', 'lib', 'report.mjs'))).toBe(true);
    });

    it('never follows an import out of the asset dir', () => {
      const outside = join(assetDir, '..', `lt-heal-outside-${process.pid}.mjs`);
      writeFileSync(outside, 'export const x = 1;\n');
      try {
        writeFileSync(asset, `import { x } from './../${basename(outside)}';\n`);
        expect(resolveCopySet(asset).map((c) => c.rel)).toEqual(['scripts/check.mjs']);
      } finally {
        rmSync(outside, { force: true });
      }
    });

    it('ignores a directory whose name looks like a module', () => {
      mkdirSync(join(assetDir, 'dir.mjs'));
      writeFileSync(asset, "import { x } from './dir.mjs';\n");
      expect(resolveCopySet(asset).map((c) => c.rel)).toEqual(['scripts/check.mjs']);
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

  describe('version guard', () => {
    const marked = (version: string, body = 'console.log("wrapper");'): string =>
      `#!/usr/bin/env node\n// @lt-check-wrapper ${version}\n${body}\n`;
    const installProjectWrapper = (content: string): void => {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, 'scripts', 'check.mjs'), content);
    };

    it('never downgrades a project wrapper from a newer release', () => {
      writeFileSync(asset, marked('3.12.0'));
      installProjectWrapper(marked('3.13.0', 'console.log("newer");'));
      writePkg({ check: 'node scripts/check.mjs' });

      expect(healCheckWrapper(root, asset)).toEqual([
        "scripts/check.mjs (skipped: project wrapper 3.13.0 is newer than this CLI's 3.12.0 — update lt)",
      ]);
      expect(readScript()).toContain('newer');
      expect(existsSync(join(root, 'scripts', 'check.mjs.bak'))).toBe(false);
    });

    it('keeps a differing wrapper of the SAME release — the marker cannot tell which is newer', () => {
      // lt-monorepo main between releases carries the release it came from: v3.12.0
      // and main with a later fix both read 3.12.0. Overwriting on a tie would turn
      // that fix back in every project created from main.
      writeFileSync(asset, marked('3.12.0', 'console.log("cli copy");'));
      installProjectWrapper(marked('3.12.0', 'console.log("main after the release");'));
      writePkg({ check: 'node scripts/check.mjs' });

      const changed = healCheckWrapper(root, asset);

      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatch(/skipped: project wrapper differs from this CLI's copy of the same release 3\.12\.0/);
      expect(readScript()).toContain('main after the release');
    });

    it('still completes an identical same-release wrapper whose sibling is missing', () => {
      writeFileSync(join(assetDir, 'gate.mjs'), 'export const g = 1;\n');
      writeFileSync(asset, marked('3.12.0', "import { g } from './gate.mjs';"));
      installProjectWrapper(readFileSync(asset, 'utf8'));
      writePkg({ check: 'node scripts/check.mjs' });

      expect(keptWrapperReason(root, asset)).toBeNull();
      expect(healCheckWrapper(root, asset)).toEqual(['scripts/gate.mjs']);
    });

    it('updates a wrapper from an older release', () => {
      writeFileSync(asset, marked('3.13.0'));
      installProjectWrapper(marked('3.12.0'));
      writePkg({ check: 'node scripts/check.mjs' });
      expect(healCheckWrapper(root, asset)).toEqual(['scripts/check.mjs']);
      expect(readWrapperVersion(join(root, 'scripts', 'check.mjs'))).toBe('3.13.0');
    });

    it('updates an unmarked (legacy) wrapper as before', () => {
      writeFileSync(asset, marked('3.12.0'));
      installProjectWrapper('#!/usr/bin/env node\nconsole.log("legacy");\n');
      writePkg({ check: 'node scripts/check.mjs' });
      expect(healCheckWrapper(root, asset)).toEqual(['scripts/check.mjs']);
      expect(readScript()).toBe(marked('3.12.0'));
    });

    it('keeps a wrapper with an unrecognised marker, and one marked against an unmarked bundle', () => {
      installProjectWrapper(marked('next'));
      expect(compareWrapperVersions(root, asset).relation).toBe('unrecognised');
      expect(keptWrapperReason(root, asset)).toMatch(/unrecognised @lt-check-wrapper marker "next"/);

      installProjectWrapper(marked('3.12.0'));
      expect(compareWrapperVersions(root, asset)).toEqual({ bundled: null, project: '3.12.0', relation: 'project-newer' });
    });

    it('reads the marker in lt-monorepo\'s exact line format, CRLF included', () => {
      const file = join(assetDir, 'probe.mjs');
      writeFileSync(file, '#!/usr/bin/env node\r\n// @lt-check-wrapper 3.12.0\r\n/**\r\n');
      expect(readWrapperVersion(file)).toBe('3.12.0');
      // Prose that mentions the tag is not a marker.
      writeFileSync(file, '#!/usr/bin/env node\n/**\n * the `@lt-check-wrapper` line names the release\n * @lt-check-wrapper 9.9.9\n */\n');
      expect(readWrapperVersion(file)).toBeNull();
      expect(readWrapperVersion(join(assetDir, 'missing.mjs'))).toBeNull();
    });

    it('orders versions numerically, prereleases before their release', () => {
      expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0);
      expect(compareVersions('3.12.0', '3.12.0')).toBe(0);
      expect(compareVersions('3.13.0-rc.1', '3.13.0')).toBeLessThan(0);
      expect(compareVersions('3.13.0', '3.12.9-rc.1')).toBeGreaterThan(0);
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
    //
    // Matched on `from '…'` rather than on a whole `import … from …;` line: a
    // multi-line import block has no such line, and a subdirectory import
    // (`./lib/…`) was exactly what a basename-only match let slip through.
    const specs = [...written.matchAll(/\bfrom\s+['"](\.\/[^'"]+)['"]/g)].map(([, spec]) => spec);
    expect(specs.length).toBeGreaterThan(0); // the loop below must never be vacuous
    for (const spec of specs) {
      const target = spec.replace('./', '');
      expect(changed).toContain(`scripts/${target}`);
      expect(filesystem.exists(filesystem.path(root, 'scripts', target))).toBe('file');
    }

    // The decisive check: the INSTALLED wrapper loads in real Node, i.e. its
    // whole transitive import graph resolved inside the project. Importing it
    // does not start a check run (asserted in check-template.test.ts).
    const url = `file://${filesystem.path(root, 'scripts', 'check.mjs')}`;
    const loaded = evalInNodeEsm<boolean>(`const m = await import(${JSON.stringify(url)});\nreport(typeof m.buildGroups === 'function');`);
    expect(loaded).toBe(true);
  });
});
