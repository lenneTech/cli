import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import {
  CHECK_TEMPLATE_PIN_FILE,
  CHECK_TEMPLATE_REPOSITORY,
  readCheckTemplatePin,
  spawnedSiblings,
  syncCheckTemplate,
  verifyCheckTemplate,
} from '../src/lib/check-template-sync';

const TEMPLATE_DIR = join(process.cwd(), 'src', 'templates', 'check');

describe('bundled check template', () => {
  // The drift guard itself: the template must be exactly what the pin says,
  // which in turn is exactly what lt-monorepo had at that commit. Hermetic — the
  // pin carries the hashes, so no network is needed to catch a hand edit.
  const pin = readCheckTemplatePin(join(TEMPLATE_DIR, CHECK_TEMPLATE_PIN_FILE));

  it('is pinned to an lt-monorepo commit', () => {
    expect(pin).not.toBeNull();
    expect(pin?.repository).toBe(CHECK_TEMPLATE_REPOSITORY);
    expect(pin?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(pin?.files ?? {})).toContain('check.mjs');
  });

  it('matches its pin byte for byte — edit lt-monorepo and run `npm run sync:check-template`, never the copy', () => {
    expect(verifyCheckTemplate(TEMPLATE_DIR, pin!)).toEqual([]);
  });
});

describe('syncCheckTemplate', () => {
  let upstream: string;
  let templateDir: string;

  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  /** Write files into the fixture upstream and commit them; returns the commit SHA. */
  const commit = (files: Record<string, null | string>): string => {
    for (const [name, content] of Object.entries(files)) {
      const file = join(upstream, name);
      if (content === null) {
        rmSync(file, { force: true });
      } else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
    }
    git('add', '-A');
    git('-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };

  const wrapper = (version: string, imports: string[]): string =>
    `#!/usr/bin/env node\n// @lt-check-wrapper ${version}\n${imports.map((i, n) => `import { x${n} } from '${i}';`).join('\n')}\n`;

  beforeEach(() => {
    upstream = mkdtempSync(join(tmpdir(), 'lt-sync-upstream-'));
    templateDir = mkdtempSync(join(tmpdir(), 'lt-sync-template-'));
    execFileSync('git', ['init', '--quiet', upstream]);
  });

  afterEach(() => {
    rmSync(upstream, { force: true, recursive: true });
    rmSync(templateDir, { force: true, recursive: true });
  });

  it('copies the wrapper with its transitive imports and pins commit, version and hashes', () => {
    const sha = commit({
      'scripts/check.mjs': wrapper('3.13.0', ['./lib/report.mjs', './gate.mjs']),
      'scripts/gate.mjs': 'export const x1 = 1;\n',
      'scripts/lib/ansi.mjs': 'export const C = {};\n',
      'scripts/lib/report.mjs': "import { C } from './ansi.mjs';\nexport const x0 = C;\n",
      'scripts/unrelated.mjs': 'export const nope = 1;\n',
    });

    const pin = syncCheckTemplate({ from: upstream, ref: sha, templateDir });

    expect(pin.commit).toBe(sha);
    expect(pin.version).toBe('3.13.0');
    expect(pin.repository).toBe(CHECK_TEMPLATE_REPOSITORY); // never the local path
    expect(Object.keys(pin.files)).toEqual(['check.mjs', 'gate.mjs', 'lib/ansi.mjs', 'lib/report.mjs']);
    expect(existsSync(join(templateDir, 'unrelated.mjs'))).toBe(false);
    expect(readFileSync(join(templateDir, 'lib', 'report.mjs'), 'utf8')).toContain("from './ansi.mjs'");
    expect(readCheckTemplatePin(join(templateDir, CHECK_TEMPLATE_PIN_FILE))).toEqual(pin);
    expect(verifyCheckTemplate(templateDir, pin)).toEqual([]);
  });

  it('resolves a tag and removes files the new pin no longer contains', () => {
    const first = commit({
      'scripts/check.mjs': wrapper('3.13.0', ['./lib/old.mjs']),
      'scripts/lib/old.mjs': 'export const x0 = 1;\n',
    });
    syncCheckTemplate({ from: upstream, ref: first, templateDir });

    commit({ 'scripts/check.mjs': wrapper('3.14.0', []), 'scripts/lib/old.mjs': null });
    git('tag', 'v3.14.0');
    writeFileSync(join(templateDir, 'README.md'), 'not part of any pin\n');

    const pin = syncCheckTemplate({ from: upstream, ref: 'v3.14.0', templateDir });

    expect(pin.ref).toBe('v3.14.0');
    expect(pin.version).toBe('3.14.0');
    expect(existsSync(join(templateDir, 'lib', 'old.mjs'))).toBe(false);
    expect(existsSync(join(templateDir, 'README.md'))).toBe(true);
  });

  it('refuses a source without a version marker', () => {
    const sha = commit({ 'scripts/check.mjs': '#!/usr/bin/env node\nconsole.log("unversioned");\n' });
    expect(() => syncCheckTemplate({ from: upstream, ref: sha, templateDir })).toThrow(/no @lt-check-wrapper marker/);
    expect(existsSync(join(templateDir, CHECK_TEMPLATE_PIN_FILE))).toBe(false);
  });

  describe('a sibling the template STARTS instead of importing', () => {
    // resolveCopySet follows imports. A `node scripts/x.mjs` is invisible to it, so the
    // file is never shipped, the pin test stays green, and only the generated project
    // breaks — a check that reports success without ever asking the real question.
    const wrapperSpawning = (call: string): string =>
      `#!/usr/bin/env node\n// @lt-check-wrapper 3.13.1\nexport const x = 1;\n${call}\n`;

    it('refuses to sync, naming the file and the choice', () => {
      const sha = commit({
        'scripts/check.mjs': wrapperSpawning("execFileSync('node', ['scripts/remove.mjs', 'node_modules']);"),
        'scripts/remove.mjs': 'export const removed = true;\n',
      });

      expect(() => syncCheckTemplate({ from: upstream, ref: sha, templateDir })).toThrow(/remove\.mjs/);
      expect(() => syncCheckTemplate({ from: upstream, ref: sha, templateDir })).toThrow(
        /starts sibling script\(s\) it does not ship/,
      );
      // Nothing half-written: no pin, so the next run starts clean.
      expect(existsSync(join(templateDir, CHECK_TEMPLATE_PIN_FILE))).toBe(false);
    });

    it('catches every call shape, and never the wrapper itself', () => {
      writeFileSync(
        join(templateDir, 'check.mjs'),
        [
          '// @lt-check-wrapper 3.13.1',
          "spawn('node', ['scripts/watchdog.mjs']);",
          "await run('node ./scripts/seed.mjs --force');",
          "execSync('bash scripts/mongo-watchdog.sh');",
          "// a mention of scripts/check.mjs itself must not count",
        ].join('\n'),
      );

      expect(spawnedSiblings(templateDir, ['check.mjs'])).toEqual([
        'mongo-watchdog.sh',
        'seed.mjs',
        'watchdog.mjs',
      ]);
    });

    it('stays quiet when the sibling is shipped, and for a pure import', () => {
      writeFileSync(
        join(templateDir, 'check.mjs'),
        "// @lt-check-wrapper 3.13.1\nimport { g } from './gate.mjs';\nspawn('node', ['scripts/gate.mjs']);\n",
      );
      writeFileSync(join(templateDir, 'gate.mjs'), 'export const g = 1;\n');

      expect(spawnedSiblings(templateDir, ['check.mjs']).filter((n) => n !== 'gate.mjs')).toEqual([]);
      const pin = { commit: 'a'.repeat(40), files: { 'check.mjs': '', 'gate.mjs': '' }, ref: 'x', repository: CHECK_TEMPLATE_REPOSITORY, version: '3.13.1' };
      expect(verifyCheckTemplate(templateDir, pin).filter((p) => p.includes('STARTED'))).toEqual([]);
    });
  });

  describe('verifyCheckTemplate', () => {
    let pinned: ReturnType<typeof syncCheckTemplate>;

    beforeEach(() => {
      const sha = commit({
        'scripts/check.mjs': wrapper('3.13.0', ['./lib/a.mjs']),
        'scripts/lib/a.mjs': 'export const x0 = 1;\n',
      });
      pinned = syncCheckTemplate({ from: upstream, ref: sha, templateDir });
    });

    it('reports a hand edit', () => {
      writeFileSync(join(templateDir, 'lib', 'a.mjs'), 'export const x0 = 2;\n');
      expect(verifyCheckTemplate(templateDir, pinned)).toEqual([expect.stringMatching(/^lib\/a\.mjs: differs from/)]);
    });

    it('reports a pinned file that is gone', () => {
      rmSync(join(templateDir, 'lib', 'a.mjs'));
      expect(verifyCheckTemplate(templateDir, pinned)).toContain('lib/a.mjs: pinned but missing');
    });

    it('reports an import added by hand that the pin does not cover', () => {
      writeFileSync(join(templateDir, 'extra.mjs'), 'export const y = 1;\n');
      const check = join(templateDir, 'check.mjs');
      writeFileSync(check, `${readFileSync(check, 'utf8')}import { y } from './extra.mjs';\n`);
      expect(verifyCheckTemplate(templateDir, pinned)).toEqual(
        expect.arrayContaining(['extra.mjs: imported by the wrapper but not pinned']),
      );
    });

    it('reports a marker that no longer matches the pinned version', () => {
      const check = join(templateDir, 'check.mjs');
      writeFileSync(check, readFileSync(check, 'utf8').replace('3.13.0', '3.13.1'));
      expect(verifyCheckTemplate(templateDir, pinned)).toEqual(
        expect.arrayContaining(['check.mjs: marker 3.13.1 does not match pinned version 3.13.0']),
      );
    });
  });
});
