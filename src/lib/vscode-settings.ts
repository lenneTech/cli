import type { ParseError } from 'jsonc-parser';

import { copyFileSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { posix, win32 } from 'path';

/**
 * Tune a VS Code installation's USER settings for machines that keep many
 * lt monorepos open at once.
 *
 * Why this exists: every open workspace root spawns its own pair of
 * TypeScript servers (a full "semantic" one plus a lightweight
 * "partialSemantic" syntax one). With 8 monorepos open — each contributing
 * an `api` and an `app` root — that is 16 semantic servers, and those are
 * what actually consume the memory (measured on a 32 GB machine: 16
 * semantic servers = ~25 GB, the 16 syntax servers together = ~1.7 GB).
 *
 * The profile below therefore targets the SEMANTIC servers and the file
 * watchers, and deliberately leaves the cheap syntax servers alone.
 */

/** The subset of gluegun's colour helpers {@link formatChange} needs. */
export interface ChangeColors {
  dim: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
}

/** A settings key we manage, with the reason it is in the profile. */
export interface ProfileEntry {
  /** Why this key is set — surfaced by the command so the user can judge it. */
  reason: string;
  value: unknown;
}

/** One key's before/after state. */
export interface SettingChange {
  action: 'added' | 'changed' | 'removed' | 'unchanged';
  after: unknown;
  before: unknown;
  key: string;
}

/** Outcome of applying the profile to one settings file. */
export interface TuneResult {
  /** Path of the `.bak` copy, when one was written. */
  backupPath?: string;
  changes: SettingChange[];
  /** Populated when the file could not be parsed or written — nothing was changed. */
  error?: string;
  settingsPath: string;
  written: boolean;
}

/** A detected editor installation (VS Code and its forks share the layout). */
export interface VsCodeVariant {
  id: string;
  installed: boolean;
  label: string;
  settingsPath: string;
}

/**
 * The tuning profile.
 *
 * Every value here was verified against the shipped extension manifests
 * rather than copied from a blog post — three commonly recommended keys are
 * deliberately ABSENT, see `EXCLUDED_FROM_PROFILE`.
 *
 * The exclude globs use `.nuxt*` / `.output*`, not `.nuxt` / `.output`. Both the
 * framework and this CLI spawn SIBLING build directories — `.nuxt-check` for the
 * check chain, `.nuxt-test` / `.output-test` for `lt dev test` — and a glob
 * segment matches whole path segments, so `**\/.nuxt/**` does not cover
 * `.nuxt-test`. A `.output-test` tree measures 37-294 MB; leaving it watched and
 * indexed would undo the very saving this profile exists to make.
 */
export const MEMORY_PROFILE: Record<string, ProfileEntry> = {
  'files.watcherExclude': {
    reason: 'Stops the file watcher from following build output and dependencies (CPU + memory per window).',
    value: {
      '**/.git/objects/**': true,
      '**/.git/subtree-cache/**': true,
      '**/.nuxt*/**': true,
      '**/.output*/**': true,
      '**/dist/**': true,
      '**/node_modules/**': true,
    },
  },
  'search.exclude': {
    reason: 'Keeps full-text search from indexing generated trees.',
    value: {
      '**/.nuxt*/**': true,
      '**/.output*/**': true,
      '**/dist/**': true,
      '**/node_modules/**': true,
    },
  },
  'typescript.disableAutomaticTypeAcquisition': {
    reason: 'Skips the @types download/scan pass — pointless in projects that declare their own types.',
    value: true,
  },
  'typescript.preferences.includePackageJsonAutoImports': {
    reason: 'Auto-import no longer scans every package.json in the workspace — the single biggest monorepo win.',
    value: 'off',
  },
  'typescript.tsserver.maxTsServerMemory': {
    reason: 'Lowers the per-server heap ceiling from the 3072 MB default; multiplies across every open root.',
    value: 2048,
  },
};

/**
 * Keys intentionally NOT in the profile, with the measurement or manifest
 * check that ruled them out. Surfaced by `lt dev vscode --explain` so the
 * reasoning survives beyond the session that produced it.
 */
export const EXCLUDED_FROM_PROFILE: { key: string; why: string }[] = [
  {
    key: 'typescript.tsserver.useSyntaxServer: "never"',
    why: 'Would drop the 2nd server per root, but those measured only ~1.7 GB across 16 roots while costing editor responsiveness.',
  },
  {
    key: 'vue.server.hybridMode',
    why: 'Does not exist in Volar 3.x — hybrid mode is unconditional there. Setting it is a silent no-op.',
  },
  {
    key: 'typescript.tsserver.maxTsServerMemory: 4096+',
    why: 'v8 pointer compression caps the heap near 4 GB, so values above it are ignored (microsoft/vscode#127105).',
  },
];

/**
 * Merge semantics per value type.
 *
 * A plain value is replaced. An object value (the exclude maps) is merged with
 * the user's existing entries winning, so tuning never silently drops a
 * project-specific exclusion someone added by hand.
 *
 * A non-object `before` under an object-valued key (an array, say) is NOT
 * mergeable and is replaced — VS Code's exclude settings are objects, so such a
 * value is already being ignored by VS Code itself. That is the one case where
 * the "never drops" promise above does not hold, and `--revert` cannot restore
 * it either; the `.bak` is the recovery path.
 */
export function buildMergedValue(before: unknown, desired: unknown): unknown {
  if (!isPlainObject(desired)) {
    return desired;
  }
  if (!isPlainObject(before)) {
    return { ...desired };
  }
  return { ...desired, ...before };
}

/** Every known variant, flagged by whether its settings file exists. */
export function detectVariants(platform: string = process.platform, home: string = homedir()): VsCodeVariant[] {
  const known: { dir: string; id: string; label: string }[] = [
    { dir: 'Code', id: 'code', label: 'VS Code' },
    { dir: 'Code - Insiders', id: 'insiders', label: 'VS Code Insiders' },
    { dir: 'Cursor', id: 'cursor', label: 'Cursor' },
    { dir: 'VSCodium', id: 'vscodium', label: 'VSCodium' },
  ];
  return known.map((k) => {
    const settingsPath = settingsPathFor(k.dir, platform, home);
    return { id: k.id, installed: existsSync(settingsPath), label: k.label, settingsPath };
  });
}

/**
 * Compare the profile against a parsed settings object.
 *
 * Object-valued keys (the two exclude maps) are treated as SETS of entries in
 * both directions: applying merges (the user's entries win), and reverting
 * subtracts only the entries this profile contributes. Deleting the whole key on
 * revert would take the user's hand-maintained exclusions with it — an undo that
 * destroys data the tool never added is worse than no undo at all.
 *
 * Scalar keys are removed outright on revert, which restores VS Code's own
 * default. An explicit pre-existing scalar (`maxTsServerMemory: 3072`, say) is
 * not restored — recovering that is what the `.bak` is for.
 */
export function diffProfile(current: Record<string, unknown>, remove = false): SettingChange[] {
  return Object.entries(MEMORY_PROFILE).map(([key, entry]) => {
    const before = current[key];
    const after = remove ? buildRevertedValue(before, entry.value) : buildMergedValue(before, entry.value);

    let action: SettingChange['action'];
    if (remove) {
      action = before === undefined || sameJson(before, after) ? 'unchanged' : 'removed';
    } else if (before === undefined) {
      action = 'added';
    } else {
      action = sameJson(before, after) ? 'unchanged' : 'changed';
    }

    return { action, after, before, key };
  });
}

/**
 * One `key: before → after` line, coloured by what happens to it.
 *
 * Lives here rather than in the command so it can be unit-tested; it takes the
 * colour helpers as an argument and is otherwise pure.
 */
export function formatChange(change: SettingChange, colors: ChangeColors): string {
  const short = (v: unknown): string => {
    if (v === undefined) {
      return '—';
    }
    const s = JSON.stringify(v);
    return s.length > 52 ? `${s.slice(0, 49)}…` : s;
  };
  const tag = {
    added: colors.green('+'),
    changed: colors.yellow('~'),
    removed: colors.red('-'),
    unchanged: colors.dim('='),
  }[change.action];
  if (change.action === 'unchanged') {
    return `${tag} ${colors.dim(change.key)} ${colors.dim(short(change.before))}`;
  }
  return `${tag} ${change.key}: ${colors.dim(short(change.before))} → ${short(change.after)}`;
}

/**
 * Whether an ENABLING flag (`--revert`, `--explain`) is set.
 *
 * gluegun declares no booleans to yargs-parser, so `--revert=true` arrives as
 * the STRING `'true'`. For a flag that turns something ON, a parse quirk that
 * reads as "not set" fails CLOSED, which is the safe direction.
 */
export function isEnablingFlagSet(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Whether a PREVENTING flag (`--dry-run`) is set.
 *
 * Deliberately NOT `=== true || === 'true'`. That idiom is exactly backwards for
 * a flag whose job is to STOP a write: `--dry-run=1` parses to the number `1`
 * and `--dry-run=yes` to a string, both of which would read as "not set" and let
 * the write proceed — the failure mode this repo already paid for once with
 * `--keep-db` (see CLAUDE.md). Presence is intent; only an explicit negation
 * proceeds.
 */
export function isPreventingFlagSet(options: Record<string, unknown>, ...names: string[]): boolean {
  return names.some((name) => {
    if (!(name in options)) {
      return false;
    }
    const v = options[name];
    return v !== false && v !== 'false' && v !== 0 && v !== '0';
  });
}

/**
 * Split the detected variants into what to act on, given an optional `--variant`.
 *
 * `unknownFilter` is reported separately from "nothing installed": a bare
 * `--variant` parses to boolean `true` and matches no id, and conflating that
 * with "no editor found" told users VS Code was missing while it was installed.
 */
export function selectVariants(
  all: VsCodeVariant[],
  filter: unknown,
): { targets: VsCodeVariant[]; unknownFilter?: string } {
  const installed = all.filter((v) => v.installed);
  if (filter === undefined || filter === null) {
    return { targets: installed };
  }
  const wanted = String(filter);
  if (!all.some((v) => v.id === wanted)) {
    return { targets: [], unknownFilter: wanted };
  }
  return { targets: installed.filter((v) => v.id === wanted) };
}

/**
 * Absolute path to a variant's user-settings file, per platform.
 *
 * All VS Code forks reuse the upstream layout, only the application support
 * directory name differs. The joiner is selected per platform rather than taken
 * from the ambient `path`, so the Windows branch produces real Windows paths
 * (and stays assertable) when called from a test on macOS or Linux.
 */
export function settingsPathFor(
  dirName: string,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  if (platform === 'win32') {
    const appData = process.env.APPDATA || win32.join(home, 'AppData', 'Roaming');
    return win32.join(appData, dirName, 'User', 'settings.json');
  }
  if (platform === 'darwin') {
    return posix.join(home, 'Library', 'Application Support', dirName, 'User', 'settings.json');
  }
  return posix.join(home, '.config', dirName, 'User', 'settings.json');
}

/**
 * Apply (or revert) the profile on one settings file.
 *
 * JSONC-safe: the file is edited through `jsonc-parser`, which preserves
 * comments, key order and the user's formatting. A naive
 * `JSON.parse` → `JSON.stringify` round-trip would silently delete every
 * comment in a file people hand-maintain.
 *
 * `jsonc-parser` is required lazily: gluegun eagerly loads every command module
 * on every `lt` invocation, and this is its only consumer, so a top-level import
 * would put the load cost on `lt --version` too. Matches how the repo already
 * treats `open`, `js-yaml`, `playwright-core` and `ts-morph`.
 *
 * Never writes when nothing would change, so re-running is a true no-op. Every
 * failure is returned as `error` rather than thrown — the caller renders it per
 * installation and carries on with the others.
 */
export function tuneSettingsFile(
  settingsPath: string,
  options: { dryRun?: boolean; remove?: boolean } = {},
): TuneResult {
  const { dryRun = false, remove = false } = options;

  if (!existsSync(settingsPath)) {
    return { changes: [], error: `settings file not found: ${settingsPath}`, settingsPath, written: false };
  }

  // Never write THROUGH a symlink — the target may be any file the user's
  // account can reach, and we were asked to tune settings, not to overwrite it.
  if (isSymbolicLink(settingsPath)) {
    return { changes: [], error: `refusing to write through a symlink: ${settingsPath}`, settingsPath, written: false };
  }

  const { applyEdits, modify, parse, printParseErrorCode } = require('jsonc-parser') as typeof import('jsonc-parser');

  let raw: string;
  try {
    raw = readFileSync(settingsPath, 'utf8');
  } catch (e) {
    return { changes: [], error: `cannot read ${settingsPath}: ${errText(e)}`, settingsPath, written: false };
  }

  const errors: ParseError[] = [];
  const current = (parse(raw, errors, { allowTrailingComma: true }) ?? {}) as Record<string, unknown>;

  // Refuse to touch a file we cannot read reliably — writing into a
  // malformed settings.json risks destroying the user's configuration.
  if (errors.length > 0) {
    const first = errors[0];
    return {
      changes: [],
      error: `cannot parse ${settingsPath}: ${printParseErrorCode(first.error)} at offset ${first.offset}`,
      settingsPath,
      written: false,
    };
  }

  const changes = diffProfile(current, remove);
  const effective = changes.filter((c) => c.action !== 'unchanged');
  if (effective.length === 0 || dryRun) {
    return { changes, settingsPath, written: false };
  }

  let content = raw;
  for (const change of effective) {
    // `after === undefined` deletes the key; an exclude map emptied by the
    // revert subtraction lands here too.
    const edits = modify(content, [change.key], change.after, {
      formattingOptions: { insertSpaces: true, tabSize: 4 },
    });
    content = applyEdits(content, edits);
  }

  // Keep the FIRST backup. It is the only record of what the file looked like
  // before this tool ever touched it — overwriting it on a later run (notably on
  // `--revert`, which would then back up the *tuned* file) destroys exactly the
  // state a user reaching for the backup wants to get back to.
  const backupPath = `${settingsPath}.bak`;
  try {
    if (!existsSync(backupPath)) {
      copyFileSync(settingsPath, backupPath);
    }
    writeFileSync(settingsPath, content, 'utf8');
  } catch (e) {
    return { changes, error: `cannot write ${settingsPath}: ${errText(e)}`, settingsPath, written: false };
  }

  return { backupPath, changes, settingsPath, written: true };
}

/**
 * The value a key should hold after `--revert`.
 *
 * For an object-valued profile entry: the user's map minus our own entries, or
 * `undefined` when nothing of theirs remains. For anything else: `undefined`
 * (delete the key).
 */
function buildRevertedValue(before: unknown, desired: unknown): unknown {
  if (!isPlainObject(desired) || !isPlainObject(before)) {
    return undefined;
  }
  const kept = Object.fromEntries(Object.entries(before).filter(([k]) => !(k in desired)));
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Message text of an unknown thrown value. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Narrow to a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `path` is a symlink (never follows it). */
function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Structural equality via JSON, sufficient for the plain values in the profile. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
