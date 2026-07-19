import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import type { PackageManagerCommand } from '../src/lib/dev-package-manager';

import { findCompiledEntry, isApiCompiledRequested, startCompiledApi } from '../src/lib/dev-api-launch';
import { runChildInherit, spawnDetached } from '../src/lib/dev-process';

// Real gluegun argv parser (yargs-parser) — exercises isApiCompiledRequested against
// the actual value shapes a `--api-compiled` flag produces on the command line.
const { parseParams } = require('gluegun/build/toolbox/parameter-tools');

jest.mock('../src/lib/dev-process', () => ({
  runChildInherit: jest.fn(),
  spawnDetached: jest.fn(),
}));

const runChildInheritMock = runChildInherit as jest.MockedFunction<typeof runChildInherit>;
const spawnDetachedMock = spawnDetached as jest.MockedFunction<typeof spawnDetached>;

/** Minimal fake package manager — `runScript('build')` → `['build']`. */
const pm = {
  bin: 'pnpm',
  name: 'pnpm',
  runScript: (script: string) => [script],
} as unknown as PackageManagerCommand;

describe('startCompiledApi', () => {
  let apiDir: string;
  let log: { info: jest.Mock; warn: jest.Mock };

  const writePkg = (scripts: Record<string, string>) =>
    writeFileSync(join(apiDir, 'package.json'), JSON.stringify({ name: 'api', scripts }));

  const writeDistEntry = () => {
    mkdirSync(join(apiDir, 'dist', 'src'), { recursive: true });
    writeFileSync(join(apiDir, 'dist', 'src', 'main.js'), '// built');
  };

  beforeEach(() => {
    apiDir = mkdtempSync(join(tmpdir(), 'lt-dev-api-launch-'));
    log = { info: jest.fn(), warn: jest.fn() };
    runChildInheritMock.mockReset();
    spawnDetachedMock.mockReset();
    spawnDetachedMock.mockReturnValue({ pid: 4321, rotated: { rotated: false } });
  });

  afterEach(() => {
    rmSync(apiDir, { force: true, recursive: true });
  });

  const call = () =>
    startCompiledApi({ apiDir, env: { FOO: 'bar' }, log, logFile: join(apiDir, 'api.log'), pm });

  it('builds, migrates, then starts the compiled entry with NODE_ENV=local', async () => {
    writePkg({ build: 'tsc', 'migrate:up': 'node migrate up', start: 'nodemon' });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(0);

    const result = await call();

    // build first, migrate second
    expect(runChildInheritMock).toHaveBeenNthCalledWith(1, 'pnpm', ['build'], { cwd: apiDir, env: { FOO: 'bar' } });
    expect(runChildInheritMock).toHaveBeenNthCalledWith(2, 'pnpm', ['migrate:up'], {
      cwd: apiDir,
      env: { FOO: 'bar' },
    });
    // compiled server started with NODE_ENV forced to local
    expect(spawnDetachedMock).toHaveBeenCalledTimes(1);
    expect(spawnDetachedMock).toHaveBeenCalledWith('node', [join(apiDir, 'dist/src/main.js')], {
      cwd: apiDir,
      env: { FOO: 'bar', NODE_ENV: 'local' },
      logFile: join(apiDir, 'api.log'),
    });
    expect(result).toEqual({ pid: 4321, rotated: { rotated: false } });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('does NOT start the compiled server when migrate:up fails (fail-safe parity with `&&`)', async () => {
    writePkg({ build: 'tsc', 'migrate:up': 'node migrate up', start: 'nodemon' });
    writeDistEntry();
    runChildInheritMock.mockResolvedValueOnce(0); // build ok
    runChildInheritMock.mockResolvedValueOnce(1); // migrate fails

    const result = await call();

    expect(runChildInheritMock).toHaveBeenCalledTimes(2); // build + migrate, no third call
    expect(spawnDetachedMock).not.toHaveBeenCalled(); // nothing started → no API on an un-migrated DB
    expect(result).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('migrate:up failed'));
  });

  it('skips migrate when the project has no migrate:up script', async () => {
    writePkg({ build: 'tsc', start: 'nodemon' });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(0);

    await call();

    expect(runChildInheritMock).toHaveBeenCalledTimes(1); // build only
    expect(spawnDetachedMock).toHaveBeenCalledWith('node', [join(apiDir, 'dist/src/main.js')], expect.anything());
  });

  it('falls back to the ts-node start when the build fails', async () => {
    writePkg({ build: 'tsc', 'migrate:up': 'node migrate up', start: 'nodemon' });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(1); // build fails

    await call();

    expect(runChildInheritMock).toHaveBeenCalledTimes(1); // build only, no migrate
    expect(spawnDetachedMock).toHaveBeenCalledWith('pnpm', ['start'], {
      cwd: apiDir,
      env: { FOO: 'bar' },
      logFile: join(apiDir, 'api.log'),
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('falling back'));
  });

  it('falls back to the ts-node start when the build produces no dist entry', async () => {
    writePkg({ build: 'tsc', start: 'nodemon' });
    // no writeDistEntry() → no compiled entry on disk
    runChildInheritMock.mockResolvedValue(0);

    await call();

    expect(spawnDetachedMock).toHaveBeenCalledWith('pnpm', ['start'], expect.objectContaining({ cwd: apiDir }));
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('falling back'));
  });

  it('falls back to the ts-node start when the build is killed by a signal (runChildInherit → null)', async () => {
    writePkg({ build: 'tsc', 'migrate:up': 'node migrate up', start: 'nodemon' });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(null); // build killed by signal → null exit (not 0)

    await call();

    expect(runChildInheritMock).toHaveBeenCalledTimes(1); // build only, no migrate (build !== 0)
    expect(spawnDetachedMock).toHaveBeenCalledWith('pnpm', ['start'], expect.objectContaining({ cwd: apiDir }));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('falling back'));
  });

  it('does NOT start the compiled server when migrate:up is killed by a signal (null)', async () => {
    writePkg({ build: 'tsc', 'migrate:up': 'node migrate up', start: 'nodemon' });
    writeDistEntry();
    runChildInheritMock.mockResolvedValueOnce(0); // build ok
    runChildInheritMock.mockResolvedValueOnce(null); // migrate killed by signal → null (not 0)

    const result = await call();

    expect(runChildInheritMock).toHaveBeenCalledTimes(2); // build + migrate, no start
    expect(spawnDetachedMock).not.toHaveBeenCalled(); // fail-safe: no API on an un-migrated DB
    expect(result).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('migrate:up failed'));
  });
});

describe('findCompiledEntry', () => {
  let dir: string;

  const writeEntry = (rel: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), '// built');
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-dev-find-entry-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('returns undefined when nothing is built', () => {
    expect(findCompiledEntry(dir)).toBeUndefined();
  });

  it('finds the primary entry dist/src/main.js', () => {
    writeEntry('dist/src/main.js');
    expect(findCompiledEntry(dir)).toBe(join(dir, 'dist/src/main.js'));
  });

  it('finds the fallback entry dist/main.js when only it exists', () => {
    writeEntry('dist/main.js');
    expect(findCompiledEntry(dir)).toBe(join(dir, 'dist/main.js'));
  });

  it('prefers dist/src/main.js over dist/main.js when both exist', () => {
    writeEntry('dist/main.js');
    writeEntry('dist/src/main.js');
    expect(findCompiledEntry(dir)).toBe(join(dir, 'dist/src/main.js'));
  });
});

describe('isApiCompiledRequested', () => {
  // Parse real argv exactly as gluegun does, so the yargs-parser value shapes
  // (boolean / string 'true' / number 1) are covered — not just synthetic objects.
  const parseUpOptions = (...argv: string[]): Record<string, unknown> => parseParams(['dev', 'up', ...argv]).options;

  it('is false when the flag is absent', () => {
    expect(isApiCompiledRequested(parseUpOptions())).toBe(false);
    expect(isApiCompiledRequested({})).toBe(false);
    expect(isApiCompiledRequested()).toBe(false);
  });

  it('honours the value-less boolean flag', () => {
    expect(isApiCompiledRequested(parseUpOptions('--api-compiled'))).toBe(true);
  });

  it('honours --api-compiled=true (string) and --api-compiled=1 (number)', () => {
    expect(isApiCompiledRequested(parseUpOptions('--api-compiled=true'))).toBe(true);
    expect(isApiCompiledRequested(parseUpOptions('--api-compiled=1'))).toBe(true);
  });

  it('stays false on explicit negation --no-api-compiled', () => {
    expect(isApiCompiledRequested(parseUpOptions('--no-api-compiled'))).toBe(false);
  });

  it('accepts either the kebab or camelCase option key', () => {
    expect(isApiCompiledRequested({ 'api-compiled': 'true' })).toBe(true);
    expect(isApiCompiledRequested({ apiCompiled: true })).toBe(true);
  });
});
