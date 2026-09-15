import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { findDangerousFixFlagUsage, healDangerousOxlintFixFlags, healOxlintrcFilename } from '../src/lib/heal-oxlintrc';

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

  describe('healDangerousOxlintFixFlags', () => {
    const OLD_APP_PKG = `{
  "name": "app",
  "scripts": {
    "lint:fix": "oxlint --fix --fix-suggestions app/ scripts/ server/",
    "lint:danger": "oxlint --fix --fix-dangerously app/"
  },
  "lint-staged": {
    "app/**/*.{ts,vue}": [
      "oxlint --fix --fix-suggestions",
      "oxfmt"
    ]
  }
}
`;
    const OLD_APP_CHECK = "// Never `--fix-suggestions` in prose stays untouched\nreturn cmd.replace(/oxlint/, 'oxlint --fix --fix-suggestions');\n";

    beforeEach(() => {
      writeFileSync(join(app, 'package.json'), OLD_APP_PKG);
      mkdirSync(join(app, 'scripts'));
      writeFileSync(join(app, 'scripts', 'check.mjs'), OLD_APP_CHECK);
      writeFileSync(join(root, '.lintstagedrc.json'), '{ "*.ts": "oxlint --fix --fix-suggestions" }\n');
    });

    it('removes both flags from every tracked, clean file and keeps --fix and the formatting', () => {
      gitInit();

      const result = healDangerousOxlintFixFlags(app, root);

      expect(result).toEqual({
        changed: ['.lintstagedrc.json', 'projects/app/package.json', 'projects/app/scripts/check.mjs'],
        skipped: [],
      });
      expect(readFileSync(join(app, 'package.json'), 'utf8')).toBe(
        OLD_APP_PKG.replace(/ --fix-suggestions/g, '').replace(' --fix-dangerously', ''),
      );
      expect(readFileSync(join(app, 'scripts', 'check.mjs'), 'utf8')).toBe(
        "// Never `--fix-suggestions` in prose stays untouched\nreturn cmd.replace(/oxlint/, 'oxlint --fix');\n",
      );
      expect(readFileSync(join(root, '.lintstagedrc.json'), 'utf8')).toBe('{ "*.ts": "oxlint --fix" }\n');
      expect(findDangerousFixFlagUsage(app, root)).toEqual([]);
    });

    it('strips and renames in one pass, the order lt fullstack update runs them in', () => {
      gitInit();
      healDangerousOxlintFixFlags(app, root);
      expect(healOxlintrcFilename(app, root).action).toBe('renamed');
    });

    it('leaves the root check wrapper to healCheckWrapper, but lets it block the rename', () => {
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts', 'check.mjs'), "'oxlint --fix --fix-suggestions'\n");
      gitInit();

      expect(healDangerousOxlintFixFlags(app, root).changed).not.toContain('scripts/check.mjs');
      expect(readFileSync(join(root, 'scripts', 'check.mjs'), 'utf8')).toContain('--fix-suggestions');
      expect(healOxlintrcFilename(app, root).detail).toMatch(/still used in scripts\/check\.mjs/);
    });

    it('skips untracked and dirty files with a reason, and those keep blocking the rename', () => {
      gitInit();
      writeFileSync(join(app, 'scripts', 'check.mjs'), `${OLD_APP_CHECK}// local edit\n`);
      writeFileSync(join(app, '.lintstagedrc'), '"oxlint --fix --fix-suggestions"\n');

      const result = healDangerousOxlintFixFlags(app, root);

      expect(result.changed).toEqual(['.lintstagedrc.json', 'projects/app/package.json']);
      expect(result.skipped).toEqual([
        'projects/app/.lintstagedrc (not tracked by git — remove the flag by hand)',
        'projects/app/scripts/check.mjs (uncommitted changes — commit or discard them, then re-run)',
      ]);
      expect(readFileSync(join(app, 'scripts', 'check.mjs'), 'utf8')).toContain("'oxlint --fix --fix-suggestions'");
      expect(healOxlintrcFilename(app, root).action).toBe('skipped');
    });

    it('never writes through a symlink, but the linked file still blocks the rename', () => {
      rmSync(join(root, '.lintstagedrc.json'));
      writeFileSync(join(root, 'shared-lintstaged.json'), '{ "*.ts": "oxlint --fix --fix-dangerously" }\n');
      symlinkSync(join(root, 'shared-lintstaged.json'), join(root, '.lintstagedrc.json'));
      gitInit();

      const result = healDangerousOxlintFixFlags(app, root);

      expect(result.skipped).toContain('.lintstagedrc.json (symlink)');
      expect(readFileSync(join(root, 'shared-lintstaged.json'), 'utf8')).toContain('--fix-dangerously');
      expect(findDangerousFixFlagUsage(app, root)).toEqual(['.lintstagedrc.json']);
    });

    it('reports a flag it cannot remove as a plain argument', () => {
      writeFileSync(join(root, '.lintstagedrc.json'), '{ "*.ts": ["oxlint", "--fix-suggestions"] }\n');
      gitInit();
      expect(healDangerousOxlintFixFlags(app, root).skipped).toContain(
        '.lintstagedrc.json (a flag use that is not a plain argument remains — remove it by hand)',
      );
    });

    it('counts a use, never a backtick mention', () => {
      writeFileSync(join(app, 'package.json'), APP_PKG);
      writeFileSync(join(app, 'scripts', 'check.mjs'), '// Never `--fix-suggestions`: it deletes console calls\n');
      rmSync(join(root, '.lintstagedrc.json'));
      expect(findDangerousFixFlagUsage(app, root)).toEqual([]);
    });
  });

  describe('--fix-suggestions gate', () => {
    // Loading the config enables no-console; an auto-fix with --fix-suggestions
    // then deletes console calls. The rename must wait until the flag is gone.
    it('waits while the root check wrapper still passes the flag', () => {
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts', 'check.mjs'), "cmd.replace(/oxlint/, 'oxlint --fix --fix-suggestions');\n");
      const result = healOxlintrcFilename(app, root);
      expect(result.action).toBe('skipped');
      expect(result.detail).toMatch(/--fix-suggestions\/--fix-dangerously is still used in scripts\/check\.mjs/);
      expect(existsSync(join(app, 'oxlint.json'))).toBe(true);
    });

    it('waits while the app itself still passes the flag (script, own wrapper)', () => {
      writeFileSync(join(app, 'package.json'), APP_PKG.replace('--fix app/', '--fix --fix-suggestions app/'));
      mkdirSync(join(app, 'scripts'));
      writeFileSync(join(app, 'scripts', 'check.mjs'), "'oxlint --fix --fix-suggestions'\n");
      const result = healOxlintrcFilename(app, root);
      expect(result.action).toBe('skipped');
      expect(result.detail).toContain('projects/app/package.json, projects/app/scripts/check.mjs');
    });

    it('renames once the flag is gone everywhere', () => {
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts', 'check.mjs'), "cmd.replace(/oxlint/, 'oxlint --fix');\n");
      expect(healOxlintrcFilename(app, root).action).toBe('renamed');
    });
  });
});
