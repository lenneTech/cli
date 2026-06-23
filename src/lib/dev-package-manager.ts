/**
 * Pick the package manager `lt dev` should drive for a given project dir.
 *
 * `lt dev up` and the related test/ticket flows used to hard-code `pnpm`
 * for every monorepo. That breaks npm-only and yarn-only projects: a
 * `pnpm install` invoked from inside `pnpm start` regenerates a
 * pnpm-lock.yaml (which the project's .gitignore then refuses to track),
 * fails on un-approved build scripts (bcrypt, sharp, esbuild) and exits
 * non-zero — the supervised api/app processes die immediately and
 * `lt dev status` reports them as `dead`.
 *
 * Detection order — highest precedence first:
 *   1. `LT_PM_BIN` env var (generic override).
 *   2. `LT_PNPM_BIN` env var (legacy — kept for backwards compatibility).
 *   3. `pnpm-lock.yaml` in `cwd` → pnpm
 *   4. `yarn.lock`       in `cwd` → yarn
 *   5. `package-lock.json` in `cwd` → npm
 *   6. Fallback: `pnpm` (preserves the historical default so nothing
 *      breaks for the projects this CLI was originally written for).
 *
 * The detection is per-cwd so a monorepo with a pnpm api + npm app gets
 * the correct command per component.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface PackageManagerCommand {
  /** Binary to spawn (just the name; resolved via PATH). */
  bin: string;
  /** Argv to invoke `<bin> install` portably. */
  installArgs: string[];
  /** The detected manager — useful for log lines. */
  name: PackageManager | 'unknown';
  /**
   * Argv to execute a project-local binary portably. `exec('playwright',
   * ['test'])` → `['exec', 'playwright', 'test']` for pnpm/yarn and
   * `['exec', '--', 'playwright', 'test']` for npm. The `--` separator
   * is required on npm because npm-exec treats flags after the binary
   * as its own; pnpm/yarn pass them through unchanged. Used in place
   * of `pnpm exec` for tools like `playwright test` so the resulting
   * argv survives the shard-flag forwarding (CI-parity).
   */
  exec(binary: string, args?: readonly string[]): string[];
  /**
   * Argv to run a package.json script portably. `runScript('dev')` →
   * `['run', 'dev']` for npm/yarn, `['dev']` for pnpm. Always uses
   * `run` for npm because `npm dev` is NOT a reserved alias and would
   * fail; `npm start`/`npm test` happen to work without `run` but using
   * `run` everywhere keeps the call sites uniform.
   */
  runScript(script: string, extra?: readonly string[]): string[];
}

/**
 * Resolve which package manager to drive for `cwd`. Pure — only filesystem
 * existence checks, no exec. The override env vars take precedence so a
 * CI pipeline can pin the manager without touching the lockfile.
 *
 * `cwd` is expected to be a project root (i.e. where the lockfile lives).
 * For a monorepo with separate api/app dirs, call this once per dir.
 */
export function pickPackageManager(cwd: string, env: NodeJS.ProcessEnv = process.env): PackageManagerCommand {
  const override = env.LT_PM_BIN || env.LT_PNPM_BIN;
  if (override) {
    return buildCommand(override, inferNameFromBin(override));
  }
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
    return buildCommand('pnpm', 'pnpm');
  }
  if (existsSync(join(cwd, 'yarn.lock'))) {
    return buildCommand('yarn', 'yarn');
  }
  if (existsSync(join(cwd, 'package-lock.json'))) {
    return buildCommand('npm', 'npm');
  }
  // Historical default — keep so projects without a lockfile (fresh
  // scaffolds, vendored monorepos) behave exactly as before.
  return buildCommand('pnpm', 'pnpm');
}

function buildCommand(bin: string, name: PackageManager | 'unknown'): PackageManagerCommand {
  const isNpm = name === 'npm';
  return {
    bin,
    exec(binary: string, args: readonly string[] = []): string[] {
      // `npm exec` consumes the args before the binary name and treats
      // anything after as its own flags unless separated by `--`. pnpm
      // and yarn route them through unchanged. Without the separator
      // `npm exec playwright test --shard=1/2` would parse `--shard`
      // as an npm option, NOT a Playwright one.
      return isNpm ? ['exec', '--', binary, ...args] : ['exec', binary, ...args];
    },
    installArgs: ['install'],
    name,
    runScript(script: string, extra: readonly string[] = []): string[] {
      // pnpm + yarn accept the bare-script shortcut (`pnpm dev`), npm
      // does not. Using `run <script>` is universally accepted so we
      // route every manager through the same call.
      return ['run', script, ...extra];
    },
  };
}

function inferNameFromBin(bin: string): PackageManager | 'unknown' {
  const lower = bin.toLowerCase();
  if (lower.endsWith('pnpm') || lower.includes('/pnpm')) {
    return 'pnpm';
  }
  if (lower.endsWith('yarn') || lower.includes('/yarn')) {
    return 'yarn';
  }
  if (lower.endsWith('npm') || lower.includes('/npm')) {
    return 'npm';
  }
  return 'unknown';
}
