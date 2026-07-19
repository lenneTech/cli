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
    if (hasScript(apiDir, 'migrate:up')) {
      const migrate = await runChildInherit(pm.bin, pm.runScript('migrate:up'), { cwd: apiDir, env });
      if (migrate !== 0) {
        // Parity with `migrate:up && start:local`: a failed migration must PREVENT the server
        // from starting rather than boot it against a half-migrated DB behind a "Started" banner.
        log.warn(`migrate:up failed (exit ${String(migrate)}) — API NOT started (would run on an un-migrated DB).`);
        return undefined;
      }
    }
    return spawnDetached('node', [entry], { cwd: apiDir, env: { ...env, NODE_ENV: 'local' }, logFile });
  }

  log.warn(`compiled API unavailable (build exit ${String(build)}) — falling back to \`${pm.bin} start\` (ts-node).`);
  return spawnDetached(pm.bin, pm.runScript('start'), { cwd: apiDir, env, logFile });
}

/** True when `package.json` in `apiDir` defines a script named `name`. */
function hasScript(apiDir: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(apiDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return typeof pkg.scripts?.[name] === 'string';
  } catch {
    return false;
  }
}
