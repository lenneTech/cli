import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { pickPackageManager } from '../src/lib/dev-package-manager';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'lt-pm-'));
}

function touch(dir: string, name: string): void {
  writeFileSync(join(dir, name), '');
}

describe('pickPackageManager', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeDir();
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('lockfile detection', () => {
    it('picks pnpm when pnpm-lock.yaml is present', () => {
      touch(dir, 'pnpm-lock.yaml');
      const pm = pickPackageManager(dir, {});
      expect(pm.bin).toBe('pnpm');
      expect(pm.name).toBe('pnpm');
    });

    it('picks yarn when yarn.lock is present', () => {
      touch(dir, 'yarn.lock');
      const pm = pickPackageManager(dir, {});
      expect(pm.bin).toBe('yarn');
      expect(pm.name).toBe('yarn');
    });

    it('picks npm when package-lock.json is present', () => {
      touch(dir, 'package-lock.json');
      const pm = pickPackageManager(dir, {});
      expect(pm.bin).toBe('npm');
      expect(pm.name).toBe('npm');
    });

    it('prefers pnpm-lock.yaml over yarn.lock when both exist', () => {
      // Two lockfiles is a project state error, but `lt dev` must not
      // explode on it — pnpm wins by historical precedent (the CLI
      // shipped pnpm-first for years).
      touch(dir, 'pnpm-lock.yaml');
      touch(dir, 'yarn.lock');
      const pm = pickPackageManager(dir, {});
      expect(pm.bin).toBe('pnpm');
    });

    it('prefers pnpm-lock.yaml over package-lock.json when both exist', () => {
      touch(dir, 'pnpm-lock.yaml');
      touch(dir, 'package-lock.json');
      const pm = pickPackageManager(dir, {});
      expect(pm.bin).toBe('pnpm');
    });

    it('prefers yarn.lock over package-lock.json when both exist', () => {
      touch(dir, 'yarn.lock');
      touch(dir, 'package-lock.json');
      const pm = pickPackageManager(dir, {});
      expect(pm.bin).toBe('yarn');
    });

    it('falls back to pnpm when no lockfile is present', () => {
      // Historical default — fresh scaffolds and vendored monorepos
      // without a lockfile must keep working exactly as before.
      const pm = pickPackageManager(dir, {});
      expect(pm.bin).toBe('pnpm');
      expect(pm.name).toBe('pnpm');
    });
  });

  describe('env overrides', () => {
    it('LT_PM_BIN overrides every lockfile signal', () => {
      // CI pipeline pin: even with a pnpm-lock checked in, the
      // operator can force a different manager (e.g. corepack-managed
      // yarn). Wins over the legacy LT_PNPM_BIN too.
      touch(dir, 'pnpm-lock.yaml');
      const pm = pickPackageManager(dir, { LT_PM_BIN: '/opt/yarn/bin/yarn', LT_PNPM_BIN: 'pnpm' });
      expect(pm.bin).toBe('/opt/yarn/bin/yarn');
      expect(pm.name).toBe('yarn');
    });

    it('LT_PNPM_BIN still works as a legacy alias for backwards compatibility', () => {
      // Older CI configs set LT_PNPM_BIN long before LT_PM_BIN existed.
      // Removing it would silently regress those pipelines, so we keep
      // it as a lower-precedence override.
      const pm = pickPackageManager(dir, { LT_PNPM_BIN: '/usr/local/bin/pnpm' });
      expect(pm.bin).toBe('/usr/local/bin/pnpm');
      expect(pm.name).toBe('pnpm');
    });

    it('infers name=unknown for a bin path that does not match a known manager', () => {
      // Custom corporate wrapper script — we still spawn it but don't
      // guess its identity for log lines.
      const pm = pickPackageManager(dir, { LT_PM_BIN: '/opt/internal/wrap-deps' });
      expect(pm.bin).toBe('/opt/internal/wrap-deps');
      expect(pm.name).toBe('unknown');
    });
  });

  describe('command synthesis', () => {
    it('runScript prefixes with `run` so npm is happy', () => {
      // `npm dev` is not a reserved alias and fails; `npm run dev`
      // works everywhere. We standardise on `run` so call sites can
      // emit one arg array regardless of which manager is selected.
      touch(dir, 'package-lock.json');
      const pm = pickPackageManager(dir, {});
      expect(pm.runScript('dev')).toEqual(['run', 'dev']);
      expect(pm.runScript('test:e2e', ['--shard=1/2'])).toEqual(['run', 'test:e2e', '--shard=1/2']);
    });

    it('installArgs is portable across managers', () => {
      // `<bin> install` is the one verb that works identically on all
      // three managers — no `add`, no `i` shortcut.
      const pm = pickPackageManager(dir, {});
      expect(pm.installArgs).toEqual(['install']);
    });

    it('exec inserts `--` for npm so option flags reach the binary', () => {
      // The bug that motivates this: `npm exec playwright test
      // --shard=1/2` makes npm treat `--shard` as ITS own flag (and
      // crash). The `--` separator forces npm to hand everything after
      // it to playwright unchanged. pnpm/yarn route through verbatim
      // and don't need the separator.
      touch(dir, 'package-lock.json');
      const npm = pickPackageManager(dir, {});
      expect(npm.exec('playwright', ['test', '--shard=1/2'])).toEqual([
        'exec',
        '--',
        'playwright',
        'test',
        '--shard=1/2',
      ]);

      rmSync(join(dir, 'package-lock.json'));
      touch(dir, 'pnpm-lock.yaml');
      const pnpm = pickPackageManager(dir, {});
      expect(pnpm.exec('playwright', ['test', '--shard=1/2'])).toEqual([
        'exec',
        'playwright',
        'test',
        '--shard=1/2',
      ]);
    });
  });

  describe('per-component detection in a monorepo', () => {
    it('returns different managers for sibling api/app dirs', () => {
      // The monorepo case the bug report was filed for: a project with
      // an npm api and an pnpm app must drive each component with the
      // correct manager.
      const apiDir = join(dir, 'api');
      const appDir = join(dir, 'app');
      mkdirSync(apiDir);
      mkdirSync(appDir);
      touch(apiDir, 'package-lock.json');
      touch(appDir, 'pnpm-lock.yaml');
      expect(pickPackageManager(apiDir, {}).bin).toBe('npm');
      expect(pickPackageManager(appDir, {}).bin).toBe('pnpm');
    });
  });
});
