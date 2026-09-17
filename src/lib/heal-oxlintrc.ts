import { execFileSync } from 'child_process';
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';

/** Outcome of `healDangerousOxlintFixFlags`. */
export interface FixFlagHealResult {
  /** Files the flags were removed from, relative to the workspace root (or `appDir`). */
  changed: string[];
  /** Files that still use a flag and were left alone, each with the reason. */
  skipped: string[];
}

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
 * oxlint flags that apply behaviour-changing fixes: `--fix-suggestions` (e.g. deletes
 * console calls for no-console) and `--fix-dangerously`. Matches a USE of the flag —
 * preceded by whitespace or a quote — not a mention in backticks such as the comment
 * "Never `--fix-suggestions`" the current templates carry.
 */
const DANGEROUS_FIX_FLAG_USE = /(?:^|[\s'"])--fix-(?:suggestions|dangerously)(?![\w-])/m;
/** The removable form: the flag as a further argument after whitespace. `--fix` itself stays. */
const DANGEROUS_FIX_FLAG_ARG = /[ \t]+--fix-(?:suggestions|dangerously)(?![\w-])/g;

const LINT_STAGED_FILES = [
  '.lintstagedrc',
  '.lintstagedrc.json',
  '.lintstagedrc.yaml',
  '.lintstagedrc.yml',
  '.lintstagedrc.js',
  '.lintstagedrc.cjs',
  '.lintstagedrc.mjs',
  'lint-staged.config.js',
  'lint-staged.config.cjs',
  'lint-staged.config.mjs',
];

/**
 * Files in which a dangerous fix flag is still USED. The root `scripts/check.mjs` counts
 * for the gate but is not stripped here — `healCheckWrapper` owns that file.
 * Paths are relative to `workspaceRoot` (or `appDir` for a standalone app).
 */
export function findDangerousFixFlagUsage(appDir: string, workspaceRoot?: string): string[] {
  const base = workspaceRoot ?? appDir;
  const files = [
    ...(workspaceRoot ? [join(workspaceRoot, 'scripts', 'check.mjs')] : []),
    ...fixFlagFiles(appDir, workspaceRoot),
  ];
  return [...new Set(files)].filter((file) => usesDangerousFixFlag(file)).map((file) => repoRelative(base, file));
}

/**
 * Remove `--fix-suggestions` and `--fix-dangerously` from the project's lint commands
 * — root and app `package.json` (scripts and inline lint-staged), lint-staged configs
 * and the app's own `scripts/check.mjs` — so the oxlint config can be loaded safely.
 *
 * Textual, so formatting stays exactly as it was. Only tracked files without
 * uncommitted changes are edited (git can restore them); an untracked, dirty or
 * symlinked file is reported in `skipped` and keeps blocking the rename.
 */
export function healDangerousOxlintFixFlags(appDir: string, workspaceRoot?: string): FixFlagHealResult {
  const base = workspaceRoot ?? appDir;
  const result: FixFlagHealResult = { changed: [], skipped: [] };
  for (const file of fixFlagFiles(appDir, workspaceRoot)) {
    if (!usesDangerousFixFlag(file)) {
      continue;
    }
    const rel = repoRelative(base, file);
    const dir = join(file, '..');
    const name = relative(dir, file);
    if (isSymlink(file)) {
      result.skipped.push(`${rel} (symlink)`);
    } else if (!isTracked(dir, name)) {
      result.skipped.push(`${rel} (not tracked by git — remove the flag by hand)`);
    } else if (hasUncommittedChanges(dir, name)) {
      result.skipped.push(`${rel} (uncommitted changes — commit or discard them, then re-run)`);
    } else {
      const content = readFileSync(file, 'utf8');
      const stripped = content.replace(DANGEROUS_FIX_FLAG_ARG, '');
      if (stripped !== content) {
        writeFileSync(file, stripped);
        result.changed.push(rel);
      }
      if (DANGEROUS_FIX_FLAG_USE.test(stripped)) {
        result.skipped.push(`${rel} (a flag use that is not a plain argument remains — remove it by hand)`);
      }
    }
  }
  return result;
}

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

  const withFlag = findDangerousFixFlagUsage(appDir, workspaceRoot);
  if (withFlag.length > 0) {
    return {
      action: 'skipped',
      changed: [],
      detail: `--fix-suggestions/--fix-dangerously is still used in ${withFlag.join(', ')}; loading the config would let it delete console calls — remove the flag, then re-run`,
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
    const updated = pkg.replace(
      CONFIG_FLAG,
      (_match, flag: string, sep: string, dot = '') => `${flag}${sep}${dot}${TARGET}`,
    );
    if (updated !== pkg) {
      writeFileSync(pkgPath, updated);
      changed.push('package.json');
    }
  }

  return { action: 'renamed', changed };
}

/**
 * Files that may pass a dangerous fix flag and are ours to strip: both package.json
 * files (scripts and inline lint-staged), lint-staged configs, and the app's own
 * check wrapper.
 */
function fixFlagFiles(appDir: string, workspaceRoot?: string): string[] {
  const roots = [...new Set([workspaceRoot, appDir].filter((dir): dir is string => Boolean(dir)))];
  return [
    ...roots.flatMap((dir) => ['package.json', ...LINT_STAGED_FILES].map((name) => join(dir, name))),
    join(appDir, 'scripts', 'check.mjs'),
  ];
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

/**
 * `file` relative to `base`, always with forward slashes.
 *
 * These strings are reported to the user next to git facts ("not tracked by
 * git", "uncommitted changes") and name files inside the repository, which git
 * itself always spells with `/`. `relative()` returns the OS-native form, so on
 * Windows the report would say `projects\app\package.json` while `git status`
 * says `projects/app/package.json` for the same file. Falls back to the
 * absolute path when there is no relative form (`base` IS the file).
 */
function repoRelative(base: string, file: string): string {
  const rel = relative(base, file);
  return rel ? rel.split(sep).join('/') : file;
}

function usesDangerousFixFlag(file: string): boolean {
  try {
    // Follows a symlink on purpose: a linked config still feeds the lint run, so it
    // must block the rename, even though the strip refuses to write through it.
    return DANGEROUS_FIX_FLAG_USE.test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}
