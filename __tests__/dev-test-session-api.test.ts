/**
 * How `lt dev test` starts its API (DEV-3289).
 *
 * The test stack starts the COMPILED bundle directly, which bypasses the project's
 * `start` script — and with it the `migrate:up` that script chains in front of the
 * server. The test DB lives across runs, so it drifted behind every environment
 * that does migrate: a changed unique index never reached it, and the suite failed
 * with a 409 that looked like a bug in the feature under test.
 *
 * Kept apart from `dev-test-session.test.ts` because it mocks the process layer,
 * which the teardown tests there must not see mocked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { pickPackageManager } from '../src/lib/dev-package-manager';
import { runChildInherit, spawnDetached } from '../src/lib/dev-process';
import { migrationFailedError, startTestApi, TestSessionLogger } from '../src/lib/dev-test-session';

jest.mock('../src/lib/dev-process', () => ({
  ...jest.requireActual('../src/lib/dev-process'),
  runChildInherit: jest.fn(),
  spawnDetached: jest.fn(),
}));

const runChildInheritMock = runChildInherit as jest.MockedFunction<typeof runChildInherit>;
const spawnDetachedMock = spawnDetached as jest.MockedFunction<typeof spawnDetached>;

describe('startTestApi', () => {
  let apiDir: string;
  let log: TestSessionLogger & { info: jest.Mock; warn: jest.Mock };

  /** The env the test API runs with — carries the TEST database, never the dev one. */
  const apiEnv = { NODE_ENV: 'local', NSC__MONGOOSE__URI: 'mongodb://127.0.0.1/svl-test' };

  const writePkg = (pkg: Record<string, unknown>) =>
    writeFileSync(join(apiDir, 'package.json'), JSON.stringify({ name: 'api', ...pkg }));

  const writeDistEntry = () => {
    mkdirSync(join(apiDir, 'dist', 'src'), { recursive: true });
    writeFileSync(join(apiDir, 'dist', 'src', 'main.js'), '// built');
  };

  const call = (skipBuild = false) =>
    startTestApi({ apiDir, apiEnv, dbName: 'svl-test', log, logFile: join(apiDir, 'api.test.log'), skipBuild });

  /** `<pm> run <script>` exactly as the code under test resolves it for this dir. */
  const script = (name: string) => {
    const pm = pickPackageManager(apiDir);
    return [pm.bin, pm.runScript(name)] as const;
  };

  beforeEach(() => {
    apiDir = mkdtempSync(join(tmpdir(), 'lt-dev-test-api-'));
    log = { dim: (s: string) => s, info: jest.fn(), warn: jest.fn() };
    runChildInheritMock.mockReset();
    spawnDetachedMock.mockReset();
    spawnDetachedMock.mockReturnValue({ pid: 4321, rotated: { rotated: false } });
  });

  afterEach(() => {
    rmSync(apiDir, { force: true, recursive: true });
  });

  it('builds, migrates the test DB with the API env, then starts the compiled entry with that same env', async () => {
    writePkg({ scripts: { build: 'tsc', 'migrate:up': 'node migrate up', start: 'pnpm run migrate:up && nodemon' } });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(0);

    const result = await call();

    const [bin, buildArgs] = script('build');
    const [, migrateArgs] = script('migrate:up');
    expect(runChildInheritMock).toHaveBeenNthCalledWith(1, bin, buildArgs, { cwd: apiDir, env: process.env });
    // The migration gets the API's env, so the migration store resolves the same DB the API will use.
    expect(runChildInheritMock).toHaveBeenNthCalledWith(2, bin, migrateArgs, { cwd: apiDir, env: apiEnv });
    expect(spawnDetachedMock).toHaveBeenCalledWith('node', [join(apiDir, 'dist/src/main.js')], {
      cwd: apiDir,
      env: apiEnv,
      logFile: join(apiDir, 'api.test.log'),
    });
    // Migration BEFORE the server: the API syncs its indexes on boot, against whatever it finds.
    expect(runChildInheritMock.mock.invocationCallOrder[1]).toBeLessThan(spawnDetachedMock.mock.invocationCallOrder[0]);
    expect(result).toEqual({ pid: 4321, rotated: { rotated: false } });
  });

  it('throws and starts nothing when migrate:up fails', async () => {
    writePkg({ scripts: { build: 'tsc', 'migrate:up': 'node migrate up' } });
    writeDistEntry();
    runChildInheritMock.mockResolvedValueOnce(0); // build
    runChildInheritMock.mockResolvedValueOnce(1); // migrate:up

    await expect(call()).rejects.toThrow(migrationFailedError('svl-test', 1).message);
    expect(spawnDetachedMock).not.toHaveBeenCalled();
  });

  it('throws when migrate:up is killed by a signal (null exit)', async () => {
    writePkg({ scripts: { build: 'tsc', 'migrate:up': 'node migrate up' } });
    writeDistEntry();
    runChildInheritMock.mockResolvedValueOnce(0);
    runChildInheritMock.mockResolvedValueOnce(null);

    await expect(call()).rejects.toThrow(/migrate:up failed/);
    expect(spawnDetachedMock).not.toHaveBeenCalled();
  });

  it('migrates a sibling shard that reuses the build — each shard has its own DB', async () => {
    writePkg({ scripts: { build: 'tsc', 'migrate:up': 'node migrate up' } });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(0);

    await call(true);

    const [bin, migrateArgs] = script('migrate:up');
    expect(runChildInheritMock).toHaveBeenCalledTimes(1);
    expect(runChildInheritMock).toHaveBeenCalledWith(bin, migrateArgs, { cwd: apiDir, env: apiEnv });
    expect(spawnDetachedMock).toHaveBeenCalledTimes(1);
  });

  it('starts without migrating when the project has no migrate:up script, and says so', async () => {
    writePkg({ scripts: { build: 'tsc', start: 'nodemon' } });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(0);

    await call();

    expect(runChildInheritMock).toHaveBeenCalledTimes(1); // build only
    expect(spawnDetachedMock).toHaveBeenCalledWith('node', [join(apiDir, 'dist/src/main.js')], expect.anything());
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('no migrate:up script'));
  });

  it('falls back to the project start script without migrating itself — that script owns it', async () => {
    writePkg({ scripts: { build: 'tsc', 'migrate:up': 'node migrate up', start: 'pnpm run migrate:up && nodemon' } });
    // no dist entry → fallback
    runChildInheritMock.mockResolvedValue(0);

    await call();

    const [bin, startArgs] = script('start');
    expect(runChildInheritMock).toHaveBeenCalledTimes(1); // build only, no second migration
    expect(spawnDetachedMock).toHaveBeenCalledWith(bin, startArgs, {
      cwd: apiDir,
      env: apiEnv,
      logFile: join(apiDir, 'api.test.log'),
    });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('falling back'));
  });

  it('starts a Bun-built bundle with bun (DEV-3208)', async () => {
    // nest-base bundles with `Bun.build({ target: 'bun' })`; under node it dies with
    // "__require is not a function". It has no migrate:up script either.
    writePkg({ scripts: { build: 'bun run scripts/build.ts', start: 'bun --watch src/main.ts' } });
    writeDistEntry();
    runChildInheritMock.mockResolvedValue(0);

    await call();

    expect(spawnDetachedMock).toHaveBeenCalledWith('bun', [join(apiDir, 'dist/src/main.js')], expect.anything());
  });
});

describe('migrationFailedError', () => {
  it('names the test database and the exit code', () => {
    const { message } = migrationFailedError('svl-test', 1);
    expect(message).toContain('migrate:up failed (exit 1)');
    expect(message).toContain('"svl-test"');
  });

  it('says the API was not started, so nobody goes looking for a crash', () => {
    expect(migrationFailedError('svl-test', null).message).toMatch(/not started/);
  });
});
