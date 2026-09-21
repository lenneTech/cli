/**
 * Launch strategy for the API process under `lt dev up`.
 *
 * By default `lt dev up` runs the API via ts-node (`<pm> run start` → nodemon →
 * ts-node src/main.ts) for hot reload. Under a browser driving the app, that
 * ts-node process intermittently dies WITHOUT a stacktrace (dev-SSR load plus
 * ts-node's heavier footprint) — see DEV-2525. `lt dev test` already sidesteps
 * this by running the API COMPILED (`node dist/src/main.js`); this module brings
 * the same option to `lt dev up`, opt-in via `--api-compiled`. The trade-off is
 * NO hot reload, so it stays opt-in — the caller decides stability vs. reload.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PackageManagerCommand } from './dev-package-manager';

import { runChildInherit, spawnDetached } from './dev-process';

export interface CompiledApiLog {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface StartCompiledApiOptions {
  /** Absolute path to the API project directory. */
  apiDir: string;
  /** Environment for the build, migrate and server processes (already includes the dev DB URI + port). */
  env: NodeJS.ProcessEnv;
  /** Injected logger — the command's colored console in real use. */
  log: CompiledApiLog;
  /** Log file the detached server writes stdout/stderr to. */
  logFile: string;
  /** Package manager to drive for the API dir. */
  pm: PackageManagerCommand;
}

/** Candidate compiled entry points, in preference order. Single-sourced so `lt dev test` agrees. */
const COMPILED_ENTRIES = ['dist/src/main.js', 'dist/main.js'] as const;

/** Runtime that can execute an API's compiled bundle. */
export type ApiRuntime = 'bun' | 'node';

/** What {@link applyPendingMigrations} did. */
export type MigrationOutcome =
  | { exitCode: null | number; status: 'failed' }
  | { status: 'applied' }
  | { status: 'skipped' };

/**
 * Apply the project's pending migrations (`<pm> run migrate:up`) ahead of an API
 * that is started WITHOUT its own `start` script.
 *
 * lt projects chain the migration into that script (`migrate:up && start:local`),
 * so every path that starts the compiled bundle directly — `lt dev up
 * --api-compiled` and `lt dev test` — drops the migration along with it. On a
 * database that outlives the run, that leaves the API on a state no deployed
 * environment has: a changed unique index never reached the `lt dev test` DB, and
 * the suite failed with a 409 that looked like a bug in the feature (DEV-3289).
 *
 * `env` must be the environment the API itself gets. The migration store resolves
 * its database from the same `config.env.ts` + `NSC__MONGOOSE__URI` merge, so
 * sharing the env is what makes both reach the same database.
 *
 * A project without a `migrate:up` script is `skipped`, never an error — nest-base
 * (Prisma) projects have none. A migration killed by a signal (`null`) is `failed`.
 */
export async function applyPendingMigrations(options: {
  apiDir: string;
  env: NodeJS.ProcessEnv;
  pm: PackageManagerCommand;
}): Promise<MigrationOutcome> {
  const { apiDir, env, pm } = options;
  if (!hasScript(apiDir, 'migrate:up')) return { status: 'skipped' };
  const exitCode = await runChildInherit(pm.bin, pm.runScript('migrate:up'), { cwd: apiDir, env });
  return exitCode === 0 ? { status: 'applied' } : { exitCode, status: 'failed' };
}

/** Resolve the compiled API entry point in `apiDir`, or `undefined` if none was built. */
export function findCompiledEntry(apiDir: string): string | undefined {
  return COMPILED_ENTRIES.map((rel) => join(apiDir, rel)).find((candidate) => existsSync(candidate));
}

/**
 * True when the caller opted into the compiled API via `--api-compiled`.
 *
 * gluegun parses argv with yargs-parser and declares no booleans, so the flag
 * arrives in several shapes: a value-less `--api-compiled` → boolean `true`, but
 * `--api-compiled=true` → the STRING `'true'` and `--api-compiled=1` → the NUMBER
 * `1`. A bare `=== true` check silently ignores the latter two and drops the very
 * stability fix the user asked for. This is an ENABLE flag, so a mis-parse fails
 * SAFE (default ts-node) — but the repo convention is to honour `true`/`'true'`
 * too (see `dev-ticket.ts#keepDbFlag` for the destructive-flag counterpart).
 */
export function isApiCompiledRequested(options: Record<string, unknown> = {}): boolean {
  const affirmative = (value: unknown): boolean =>
    value === true || ['1', 'true', 'yes'].includes(String(value).toLowerCase());
  return affirmative(options.apiCompiled) || affirmative(options['api-compiled']);
}

/**
 * Which runtime to start the API's COMPILED bundle with.
 *
 * A bundle is only portable across runtimes by accident. `nest-base` builds with
 * `Bun.build({ target: 'bun' })`, whose output calls `__require` — a Bun-only
 * shim. Started under node it dies in milliseconds with "__require is not a
 * function" (DEV-3208), and because the caller used to only WARN when the API
 * never answered, the whole Playwright suite then ran against a dead API: every
 * data-dependent spec passed trivially or skipped, so a run that checked nothing
 * looked exactly like one that checked everything.
 *
 * Detected from the project rather than configured, because the project already
 * states it three times over. Any one signal is enough:
 *   - a `bun.lock` / `bun.lockb` IN THIS DIRECTORY (not a nested package's),
 *   - `engines.bun` in its package.json,
 *   - a `build` / `start` script that invokes `bun` as the COMMAND.
 *
 * The script check matches `bun` as a whole word at a command position, never as
 * a substring: `rollup --bundle` and `node -r bunyan …` are Node projects, and a
 * loose `includes('bun')` would switch them to a runtime they never installed.
 *
 * Defaults to `node` whenever nothing says otherwise, including an unreadable or
 * missing package.json — the historical behaviour, and the safe one: guessing
 * `bun` for a project that does not have it installed turns a working start into
 * an exit-127.
 *
 * This deliberately does NOT live in `dev-package-manager`: that module resolves
 * which PACKAGE MANAGER drives a directory (`pnpm run build`), a separate axis
 * from which runtime executes an already-built bundle. A Bun project whose
 * scripts pnpm happens to run still needs `bun dist/main.js`.
 */
export function resolveApiRuntime(apiDir: string): ApiRuntime {
  if (existsSync(join(apiDir, 'bun.lock')) || existsSync(join(apiDir, 'bun.lockb'))) return 'bun';

  const pkg = readPackageJson(apiDir);
  if (!pkg) return 'node';
  if (pkg.engines?.bun) return 'bun';

  // `bun` as the command itself, or after a shell separator (`&&`, `;`, `|`).
  const invokesBun = /(?:^|[&|;]\s*)bun\b/;
  return [pkg.scripts?.build, pkg.scripts?.start].some((script) => script && invokesBun.test(script)) ? 'bun' : 'node';
}

/**
 * Build the API and start it compiled (`node dist/src/main.js`). Applies pending
 * migrations first for parity with the ts-node path it replaces (`<pm> run start`
 * = `migrate:up && start:local`). Falls back to the ts-node start when the build
 * fails or produces no dist entry, so this never leaves the developer with a dead
 * API. Returns the detached spawn result (`undefined` when nothing was started).
 */
export async function startCompiledApi(options: StartCompiledApiOptions): Promise<ReturnType<typeof spawnDetached>> {
  const { apiDir, env, log, logFile, pm } = options;

  log.info('Building API (compiled, for stability — no hot reload) …');
  const build = await runChildInherit(pm.bin, pm.runScript('build'), { cwd: apiDir, env });
  const entry = findCompiledEntry(apiDir);

  if (build === 0 && entry) {
    const migration = await applyPendingMigrations({ apiDir, env, pm });
    if (migration.status === 'failed') {
      // Parity with `migrate:up && start:local`: a failed migration must PREVENT the server
      // from starting rather than boot it against a half-migrated DB behind a "Started" banner.
      log.warn(
        `migrate:up failed (exit ${String(migration.exitCode)}) — API NOT started (would run on an un-migrated DB).`,
      );
      return undefined;
    }
    return spawnDetached(resolveApiRuntime(apiDir), [entry], {
      cwd: apiDir,
      env: { ...env, NODE_ENV: 'local' },
      logFile,
    });
  }

  log.warn(`compiled API unavailable (build exit ${String(build)}) — falling back to \`${pm.bin} start\` (ts-node).`);
  return spawnDetached(pm.bin, pm.runScript('start'), { cwd: apiDir, env, logFile });
}

/** True when `package.json` in `apiDir` defines a script named `name`. */
function hasScript(apiDir: string, name: string): boolean {
  return typeof readPackageJson(apiDir)?.scripts?.[name] === 'string';
}

/** The parsed `package.json` in `apiDir`, or `undefined` when it is missing or unparsable. */
function readPackageJson(
  apiDir: string,
): undefined | { engines?: Record<string, string>; scripts?: Record<string, string> } {
  try {
    return JSON.parse(readFileSync(join(apiDir, 'package.json'), 'utf8')) as {
      engines?: Record<string, string>;
      scripts?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}
