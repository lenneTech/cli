import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { healOxlintrcFilename } from '../src/lib/heal-oxlintrc';

describe('healOxlintrcFilename', () => {
  let root: string;
  let app: string;

  const CONFIG = '{ "rules": { "no-console": "warn" } }\n';
  const APP_PKG = `{
  "name": "app",
  "scripts": {
    "lint": "oxlint -c oxlint.json app/",
    "lint:fix": "oxlint --config=./oxlint.json --fix app/",
    "lint:other": "oxlint -c oxlint.jsonc app/"
  }
}
`;

  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  const gitInit = (): void => {
    git('init', '--quiet');
    git('add', '-A');
    git('-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', 'init');
  };

  // Fixtures in the OS tmpdir: `__tests__/temp-*` is gitignored, which would
  // silently disable the tracked/dirty guards under test.
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-heal-oxlintrc-'));
    app = join(root, 'projects', 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'oxlint.json'), CONFIG);
    writeFileSync(join(app, 'package.json'), APP_PKG);
    writeFileSync(join(root, 'package.json'), '{ "name": "demo", "scripts": { "check": "node scripts/check.mjs" } }\n');
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('renames a tracked config with git mv and follows `-c`/`--config` references', () => {
    gitInit();

    const result = healOxlintrcFilename(app, root);

    expect(result).toEqual({ action: 'renamed', changed: ['oxlint.json → .oxlintrc.json', 'package.json'] });
    expect(existsSync(join(app, 'oxlint.json'))).toBe(false);
    expect(readFileSync(join(app, '.oxlintrc.json'), 'utf8')).toBe(CONFIG);
    expect(git('status', '--porcelain', '--', 'projects/app/oxlint.json', 'projects/app/.oxlintrc.json')).toBe(
      'R  projects/app/oxlint.json -> projects/app/.oxlintrc.json',
    );
    const pkg = readFileSync(join(app, 'package.json'), 'utf8');
    expect(pkg).toContain('"lint": "oxlint -c .oxlintrc.json app/"');
    expect(pkg).toContain('"lint:fix": "oxlint --config=./.oxlintrc.json --fix app/"');
    expect(pkg).toContain('"lint:other": "oxlint -c oxlint.jsonc app/"'); // a different file stays
  });

  it('is a no-op once renamed, and without any oxlint.json', () => {
    gitInit();
    healOxlintrcFilename(app, root);
    expect(healOxlintrcFilename(app, root)).toEqual({ action: 'none', changed: [] });
  });

  it('renames an untracked config on disk — nothing is overwritten', () => {
    const result = healOxlintrcFilename(app, root);
    expect(result.action).toBe('renamed');
    expect(readFileSync(join(app, '.oxlintrc.json'), 'utf8')).toBe(CONFIG);
  });

  it('never merges when both files exist', () => {
    writeFileSync(join(app, '.oxlintrc.json'), '{}\n');
    const result = healOxlintrcFilename(app, root);
    expect(result.action).toBe('both-present');
    expect(result.detail).toMatch(/merge the rules from oxlint\.json by hand/);
    expect(readFileSync(join(app, 'oxlint.json'), 'utf8')).toBe(CONFIG);
    expect(readFileSync(join(app, '.oxlintrc.json'), 'utf8')).toBe('{}\n');
  });

  it('refuses a tracked config with uncommitted changes', () => {
    gitInit();
    writeFileSync(join(app, 'oxlint.json'), '{ "rules": {} }\n');
    const result = healOxlintrcFilename(app, root);
    expect(result.action).toBe('skipped');
    expect(result.detail).toMatch(/uncommitted changes/);
    expect(existsSync(join(app, '.oxlintrc.json'))).toBe(false);
  });

  it('refuses a symlinked config', () => {
    rmSync(join(app, 'oxlint.json'));
    writeFileSync(join(root, 'shared-oxlint.json'), CONFIG);
    symlinkSync(join(root, 'shared-oxlint.json'), join(app, 'oxlint.json'));
    expect(healOxlintrcFilename(app, root)).toEqual(
      expect.objectContaining({ action: 'skipped', detail: expect.stringMatching(/symlink/) }),
    );
  });

  describe('--fix-suggestions gate', () => {
    // Loading the config enables no-console; an auto-fix with --fix-suggestions
    // then deletes console calls. The rename must wait until the flag is gone.
    it('waits while the root check wrapper still passes the flag', () => {
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts', 'check.mjs'), "cmd.replace(/oxlint/, 'oxlint --fix --fix-suggestions');\n");
      const result = healOxlintrcFilename(app, root);
      expect(result.action).toBe('skipped');
      expect(result.detail).toMatch(/--fix-suggestions is still used in scripts\/check\.mjs/);
      expect(existsSync(join(app, 'oxlint.json'))).toBe(true);
    });

    it('waits while the app itself still passes the flag (script, own wrapper)', () => {
      writeFileSync(join(app, 'package.json'), APP_PKG.replace('--fix app/', '--fix --fix-suggestions app/'));
      mkdirSync(join(app, 'scripts'));
      writeFileSync(join(app, 'scripts', 'check.mjs'), "'oxlint --fix --fix-suggestions'\n");
      const result = healOxlintrcFilename(app, root);
      expect(result.action).toBe('skipped');
      expect(result.detail).toContain('projects/app/scripts/check.mjs, projects/app/package.json');
    });

    it('renames once the flag is gone everywhere', () => {
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts', 'check.mjs'), "cmd.replace(/oxlint/, 'oxlint --fix');\n");
      expect(healOxlintrcFilename(app, root).action).toBe('renamed');
    });
  });
});
