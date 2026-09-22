import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { findClaudeCli } from '../src/lib/claude-cli';
import { findCodexCli } from '../src/lib/codex-cli';
import { findExecutable, isWindows, spawnCmdSync, windowsAppData } from '../src/lib/platform';

/** File probe backed by a fixed set of paths, so Windows lookups run on any host. */
const onDisk = (...paths: string[]) => {
  const set = new Set(paths);
  return (path: string) => set.has(path);
};

describe('findExecutable', () => {
  describe('posix', () => {
    const platform = 'darwin';

    it('prefers a candidate over PATH', () => {
      const result = findExecutable('claude', {
        candidates: ['/missing/claude', '/home/u/.claude/local/claude'],
        env: { PATH: '/usr/bin' },
        isExecutableFile: onDisk('/home/u/.claude/local/claude', '/usr/bin/claude'),
        platform,
      });
      expect(result).toBe('/home/u/.claude/local/claude');
    });

    it('scans PATH in order and returns the first hit', () => {
      const result = findExecutable('caddy', {
        env: { PATH: '/opt/homebrew/bin::/usr/local/bin' },
        isExecutableFile: onDisk('/usr/local/bin/caddy', '/opt/homebrew/bin/caddy'),
        platform,
      });
      expect(result).toBe('/opt/homebrew/bin/caddy');
    });

    it('returns null when nothing matches', () => {
      expect(findExecutable('nope', { env: { PATH: '/usr/bin' }, isExecutableFile: onDisk(), platform })).toBeNull();
    });
  });

  describe('win32', () => {
    const platform = 'win32';

    it('resolves PATHEXT variants and reads the `Path` spelling of the key', () => {
      const result = findExecutable('npm', {
        env: { Path: 'C:\\Windows\\System32;"C:\\Program Files\\nodejs"', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        isExecutableFile: onDisk('C:\\Program Files\\nodejs\\npm.cmd'),
        platform,
      });
      expect(result).toBe('C:\\Program Files\\nodejs\\npm.cmd');
    });

    it('never matches an extensionless file, which Node cannot spawn', () => {
      const result = findExecutable('claude', {
        env: { Path: 'C:\\Users\\u\\.local\\bin' },
        isExecutableFile: onDisk('C:\\Users\\u\\.local\\bin\\claude'),
        platform,
      });
      expect(result).toBeNull();
    });

    it('probes a name that already carries an executable extension as-is', () => {
      const result = findExecutable('claude.exe', {
        env: { Path: 'C:\\bin' },
        isExecutableFile: onDisk('C:\\bin\\claude.exe'),
        platform,
      });
      expect(result).toBe('C:\\bin\\claude.exe');
    });

    it('falls back to the default PATHEXT when the variable is unset', () => {
      const result = findExecutable('tool', {
        env: { Path: 'C:\\bin' },
        isExecutableFile: onDisk('C:\\bin\\tool.bat'),
        platform,
      });
      expect(result).toBe('C:\\bin\\tool.bat');
    });
  });

  it('only matches executable files on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-platform-'));
    try {
      const file = join(dir, 'tool');
      writeFileSync(file, '#!/bin/sh\n');
      chmodSync(file, 0o644);
      expect(findExecutable('tool', { env: { PATH: dir } })).toBeNull();

      chmodSync(file, 0o755);
      // Windows has no execute bit and never matches an extensionless file
      expect(findExecutable('tool', { env: { PATH: dir } })).toBe(isWindows() ? null : file);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('spawnCmdSync', () => {
  it('passes arguments verbatim, without shell interpretation', () => {
    const args = ['a;b', '$(whoami)', '`id`', 'c|d', 'with space', '%PATH%'];
    const result = spawnCmdSync(process.execPath, [
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      ...args,
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  it('reports a missing binary instead of throwing', () => {
    const result = spawnCmdSync('__lt_nonexistent_binary__', ['--version']);
    expect(result.status).not.toBe(0);
    expect(result.error).toBeDefined();
  });
});

describe('windowsAppData', () => {
  it('uses APPDATA and falls back to the roaming profile', () => {
    expect(windowsAppData({ APPDATA: 'D:\\Roaming' }, 'C:\\Users\\u')).toBe('D:\\Roaming');
    expect(windowsAppData({}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Roaming');
  });
});

describe('CLI lookups on Windows', () => {
  const home = 'C:\\Users\\u';
  const env = { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', Path: 'C:\\Windows\\System32' };
  const platform = 'win32';

  it('finds the natively installed claude.exe first', () => {
    const isExecutableFile = onDisk(
      'C:\\Users\\u\\.local\\bin\\claude.exe',
      'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd',
    );
    expect(findClaudeCli({ env, home, isExecutableFile, platform })).toBe('C:\\Users\\u\\.local\\bin\\claude.exe');
  });

  it('finds the npm shim even when %APPDATA%\\npm is not on PATH yet', () => {
    const isExecutableFile = onDisk('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd');
    expect(findClaudeCli({ env, home, isExecutableFile, platform })).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd',
    );
  });

  it('falls back to PATH', () => {
    const isExecutableFile = onDisk('C:\\tools\\claude.exe');
    expect(findClaudeCli({ env: { ...env, Path: 'C:\\tools' }, home, isExecutableFile, platform })).toBe(
      'C:\\tools\\claude.exe',
    );
  });

  it('finds the codex npm shim', () => {
    const isExecutableFile = onDisk('C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd');
    expect(findCodexCli({ env, home, isExecutableFile, platform })).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd',
    );
  });
});

describe('CLI lookups on macOS/Linux', () => {
  it('keeps the known claude install location ahead of PATH', () => {
    const isExecutableFile = onDisk('/Users/u/.claude/local/claude', '/usr/local/bin/claude');
    expect(
      findClaudeCli({ env: { PATH: '/usr/local/bin' }, home: '/Users/u', isExecutableFile, platform: 'darwin' }),
    ).toBe('/Users/u/.claude/local/claude');
  });
});

describe('spawnCmd / spawnCmdSync semantics', () => {
  const { spawnCmd, spawnCmdSync } = require('../src/lib/platform');

  it('spawnCmd starts a child and reports its exit code', async () => {
    const code = await new Promise<null | number>((resolve) => {
      const child = spawnCmd(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' });
      child.on('error', () => resolve(-1));
      child.on('close', (c: null | number) => resolve(c));
    });
    expect(code).toBe(7);
  });

  it('does NOT throw on a non-zero exit — unlike the execFileSync it replaced', () => {
    // The trap this pins: `execFileSync` throws on a non-zero exit, `spawnSync`
    // returns a result. Every call site migrated from one to the other has to
    // check `status` explicitly, or a failing install/build becomes silent.
    // `installWorktreeDeps` and `ensurePlaywrightBrowsers` both depend on this.
    const result = spawnCmdSync(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' });
    expect(result.status).toBe(3);
    // cross-spawn reports `null`, not `undefined`, when nothing went wrong at the
    // spawn level — so a call site must test falsiness, not `=== undefined`.
    expect(result.error).toBeFalsy();
  });

  it('reports a missing binary as an error rather than throwing', () => {
    const result = spawnCmdSync('lt-definitely-not-a-real-binary-xyz', [], { stdio: 'ignore' });
    expect(result.error).toBeTruthy();
  });
});
