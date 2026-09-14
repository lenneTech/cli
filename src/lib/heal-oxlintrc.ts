import { execFileSync } from 'child_process';
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

/** Outcome of `healOxlintrcFilename`. */
export interface OxlintrcHealResult {
  /**
   * - `renamed`: the config was renamed (and `-c oxlint.json` references updated).
   * - `both-present`: both files exist; nothing merged, `detail` says what to do.
   * - `skipped`: the rename was refused; `detail` names the reason.
   * - `none`: no `oxlint.json`, nothing to do.
   */
  action: 'both-present' | 'none' | 'renamed' | 'skipped';
  /** Paths changed, relative to `appDir`. */
  changed: string[];
  /** Human-readable reason for `both-present` and `skipped`. */
  detail?: string;
}

const LEGACY = 'oxlint.json';
const TARGET = '.oxlintrc.json';

/** A `-c`/`--config` flag pointing at the legacy file, e.g. `-c oxlint.json`, `--config=./oxlint.json`. */
const CONFIG_FLAG = /(-c|--config)(\s+|=)(\.\/)?oxlint\.json(?![\w.-])/g;

/**
 * Heal the oxlint config filename of an app project: `oxlint.json` → `.oxlintrc.json`.
 *
 * oxlint only auto-discovers `.oxlintrc.json`. nuxt-base-template and
 * nuxt-extensions shipped the config as `oxlint.json`, so every rule in it was
 * silently ignored — projects linted with oxlint's defaults only. The templates
 * renamed the file; existing projects keep the old name until this runs.
 *
 * Loading the config is not neutral. It turns on rules such as `no-console`, and
 * an auto-fix run with `--fix-suggestions` applies that rule's suggestion, which
 * deletes console calls. So the rename is GATED: it only happens once no check
 * wrapper, script or lint-staged entry of the project still passes
 * `--fix-suggestions`. Run it after `healCheckWrapper`, which removes the flag
 * from the root wrapper in the same update.
 *
 * Same recoverability rules as the other heals: never through a symlink, never
 * over uncommitted changes to the file, `git mv` for a tracked file so history
 * follows the rename.
 *
 * @param appDir        The app project (e.g. `<workspace>/projects/app`).
 * @param workspaceRoot The monorepo root, whose `scripts/check.mjs` and
 *                      `package.json` also gate the rename. Omit for a standalone app.
 */
export function healOxlintrcFilename(appDir: string, workspaceRoot?: string): OxlintrcHealResult {
  const legacy = join(appDir, LEGACY);
  const target = join(appDir, TARGET);

  if (!existsSync(legacy) && !isSymlink(legacy)) {
    return { action: 'none', changed: [] };
  }
  if (existsSync(target) || isSymlink(target)) {
    return {
      action: 'both-present',
      changed: [],
      detail: `both ${LEGACY} and ${TARGET} exist — oxlint only loads ${TARGET}; merge the rules from ${LEGACY} by hand, then delete it`,
    };
  }
  if (isSymlink(legacy)) {
    return { action: 'skipped', changed: [], detail: `${LEGACY} is a symlink — rename it by hand` };
  }

  const withFlag = fixSuggestionCandidates(appDir, workspaceRoot).filter((file) => fileContains(file, '--fix-suggestions'));
  if (withFlag.length > 0) {
    const names = withFlag.map((file) => relative(workspaceRoot ?? appDir, file) || file).join(', ');
    return {
      action: 'skipped',
      changed: [],
      detail: `--fix-suggestions is still used in ${names}; loading the config would let it delete console calls — remove the flag, then re-run`,
    };
  }

  const tracked = isTracked(appDir, LEGACY);
  if (tracked && hasUncommittedChanges(appDir, LEGACY)) {
    return {
      action: 'skipped',
      changed: [],
      detail: `${LEGACY} has uncommitted changes — commit or discard them, then re-run`,
    };
  }

  if (tracked) {
    execFileSync('git', ['-C', appDir, 'mv', '--', LEGACY, TARGET], { stdio: 'ignore' });
  } else {
    // Nothing is overwritten (the target does not exist), so an untracked file
    // keeps its content under the new name — no backup needed.
    renameSync(legacy, target);
  }
  const changed = [`${LEGACY} → ${TARGET}`];

  const pkgPath = join(appDir, 'package.json');
  if (existsSync(pkgPath) && !isSymlink(pkgPath)) {
    const pkg = readFileSync(pkgPath, 'utf8');
    // Textual, not JSON round-trip: only the flag value changes, the file keeps its formatting.
    const updated = pkg.replace(CONFIG_FLAG, (_match, flag: string, sep: string, dot = '') => `${flag}${sep}${dot}${TARGET}`);
    if (updated !== pkg) {
      writeFileSync(pkgPath, updated);
      changed.push('package.json');
    }
  }

  return { action: 'renamed', changed };
}

function fileContains(file: string, needle: string): boolean {
  try {
    return !isSymlink(file) && readFileSync(file, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

/**
 * Files that may still pass `--fix-suggestions` in a fullstack project: the root
 * check wrapper, the app's own wrapper, and both package.json files (scripts and
 * inline lint-staged config), plus a standalone lint-staged config.
 */
function fixSuggestionCandidates(appDir: string, workspaceRoot?: string): string[] {
  const roots = [...new Set([workspaceRoot, appDir].filter((dir): dir is string => Boolean(dir)))];
  return roots.flatMap((dir) =>
    ['scripts/check.mjs', 'package.json', '.lintstagedrc', '.lintstagedrc.json'].map((name) => join(dir, name)),
  );
}

/** True when the TRACKED `relPath` has uncommitted modifications. */
function hasUncommittedChanges(dir: string, relPath: string): boolean {
  try {
    const out = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', relPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** True when `path` is a symlink (checked without following it). */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** True when git tracks `relPath`; false outside a repository as well. */
function isTracked(dir: string, relPath: string): boolean {
  try {
    execFileSync('git', ['-C', dir, 'ls-files', '--error-unmatch', '--', relPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
