/**
 * Permission rules that `lt claude plugins` writes into Claude Code's user settings.json.
 *
 * Those rules apply in every project, and in auto mode an allow rule takes effect before
 * the classifier sees the call. Appending the rules a plugin ships is therefore not enough:
 *
 * - A rule a plugin stops shipping has to leave settings.json again. The ledger
 *   (`~/.lenneTech/claude-plugin-permissions.json`) records, per settings file and plugin,
 *   which rules lt wrote. Each run removes the recorded rules the plugin no longer lists.
 *   A rule the user wrote is never recorded, so it stays.
 * - Rules lt wrote before the ledger existed are not recorded anywhere. Each plugin names
 *   them in `formerPatterns` of its permissions.json, so this public CLI carries no list of
 *   them (an internal plugin's former rules name internal hosts). Each one is applied once.
 * - A rule with `${CLAUDE_PLUGIN_ROOT}` is never written. Claude Code does not expand the
 *   variable in permission rules, so the rule as shipped never matches. Resolving it to the
 *   cache directory needs a wildcard for the version folder, and Claude Code neither
 *   normalises paths nor stops a wildcard at `/`. A rule allowing `bash <cache>/<plugin>/`
 *   followed by any version and `/scripts/` and any name also allowed
 *   `bash <cache>/<plugin>/1.0.0/scripts/../../../../../../dev/stdin`, which ran piped code
 *   without a prompt (measured 2026-10-18, also for node). Such rules are removed in both
 *   spellings.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { safeJsonParse } from './json-utils';
import { getLtConfigDir } from './marketplace-config';

/**
 * Input of {@link planPermissionSync}
 */
export interface PermissionSyncInput {
  /** Current `permissions.allow` of the settings file */
  allow: readonly string[];
  /** Former rules the ledger says were already applied for this plugin */
  formerApplied: readonly string[];
  /** Rules the plugin names in `formerPatterns`: lt may have written them before the ledger existed */
  formerRules: readonly string[];
  /** Rules lt writes for the plugin now (never one with `${CLAUDE_PLUGIN_ROOT}`) */
  listed: readonly string[];
  /** Rules the ledger records for this plugin; `null` while it has no entry for it yet */
  owned: null | readonly string[];
  /** Rules the ledger records for the other plugins of the same settings file */
  ownedByOthers: readonly string[];
  /**
   * Rules that must not stay in settings.json however they got there, removed on every run:
   * the plugin's `${CLAUDE_PLUGIN_ROOT}` rules, verbatim (never matched) and resolved with a
   * version wildcard (matches any file, see the file header). A pre-release build wrote the latter.
   */
  withdrawnRules: readonly string[];
}

/**
 * Result of {@link planPermissionSync}
 */
export interface PermissionSyncPlan {
  /** Listed rules the settings file did not contain */
  added: string[];
  /** Next `permissions.allow` */
  allow: string[];
  /** Listed rules the settings file already contained */
  existing: string[];
  /** Next ledger entry for this plugin */
  ledger: PluginLedgerEntry;
  /** Rules lt wrote that the plugin no longer ships, removed from the settings file */
  removed: string[];
}

/**
 * What the ledger knows about one plugin in one settings file
 */
export interface PluginLedgerEntry {
  /** Former rules already applied, so a rule the user adds back by hand stays */
  formerApplied: string[];
  /** Rules lt wrote for the plugin */
  owned: string[];
}

/**
 * Ledger file layout: settings.json path → `<marketplace>/<plugin>` → entry
 */
interface PermissionLedgerFile {
  settings: Record<string, Record<string, PluginLedgerEntry>>;
  version: number;
}

const LEDGER_VERSION = 1;

/**
 * `${CLAUDE_PLUGIN_ROOT}` and the bare `$CLAUDE_PLUGIN_ROOT`
 */
const PLUGIN_ROOT_VARIABLE = /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT(?!\w)/g;

/**
 * Path of the ledger. Resolved at call time so tests can redirect it.
 * @returns Absolute path to claude-plugin-permissions.json
 */
export function getPermissionLedgerPath(): string {
  return process.env.LT_CLAUDE_PERMISSION_LEDGER || join(getLtConfigDir(), 'claude-plugin-permissions.json');
}

/**
 * Whether a rule contains `${CLAUDE_PLUGIN_ROOT}`
 * @param rule - Permission rule as the plugin ships it
 * @returns true if the rule still needs resolving
 */
export function hasPluginRootVariable(rule: string): boolean {
  // `search` ignores the g flag and lastIndex, so the shared regex stays stateless here.
  return rule.search(PLUGIN_ROOT_VARIABLE) !== -1;
}

/**
 * Decide what a run changes in `permissions.allow` for one plugin. Pure.
 *
 * Adds every listed rule that is missing. Removes a rule only when lt wrote it for this
 * plugin, the plugin no longer lists it and the ledger does not record it for another
 * plugin. "lt wrote it" means: the ledger records it, or the plugin names it in
 * `formerPatterns` and it has not been applied before, or it is a withdrawn rule. Rules
 * nobody recorded are the user's.
 *
 * Each former rule is applied once, whenever it first shows up, not only on the first run:
 * a CLI that meets a plugin before the marketplace ships `formerPatterns` must not close
 * the window for good. Once applied, a rule the user adds back by hand stays.
 *
 * Without a ledger entry the listed rules already present are adopted as lt's: lt has been
 * their installer. A user who wrote an identical rule by hand may then see it removed once
 * the plugin drops it, which costs a prompt. Leaving a broad rule lt wrote in place would
 * cost more.
 * @param input - Current settings, ledger state and the plugin's rules
 * @returns Rules to add and remove, the next allow list and the next ledger entry
 */
export function planPermissionSync(input: PermissionSyncInput): PermissionSyncPlan {
  const listed = [...new Set(input.listed)];
  const present = new Set(input.allow);
  const added = listed.filter((rule) => !present.has(rule));
  const existing = listed.filter((rule) => present.has(rule));

  const applied = new Set(input.formerApplied);
  const formerDue = input.formerRules.filter((rule) => !applied.has(rule));
  const writtenByLt = new Set([...(input.owned ?? []), ...formerDue, ...input.withdrawnRules]);
  const keep = new Set([...listed, ...input.ownedByOthers]);
  const removed = [...writtenByLt].filter((rule) => present.has(rule) && !keep.has(rule));
  const removedSet = new Set(removed);

  const ownedBefore = new Set([...(input.owned ?? existing), ...added]);
  return {
    added,
    allow: [...input.allow.filter((rule) => !removedSet.has(rule)), ...added],
    existing,
    ledger: {
      formerApplied: [...new Set([...input.formerApplied, ...input.formerRules])],
      owned: listed.filter((rule) => ownedBefore.has(rule)),
    },
    removed,
  };
}

/**
 * The plugin's cache directory (`<config dir>/plugins/cache/<marketplace>/<plugin>/<version>/`)
 * with a wildcard for the version folder: the form a pre-release build put in place of
 * `${CLAUDE_PLUGIN_ROOT}`. Used only to recognise and remove such rules. NEVER write a rule
 * built from it: the `*` also matches `../`, so the rule allows any file (see the file header).
 * @param claudeConfigDir - Claude Code's configuration directory
 * @param marketplaceName - Name of the marketplace
 * @param pluginName - Name of the plugin
 * @returns Absolute path pattern ending in the version wildcard
 */
export function pluginCacheRootPattern(claudeConfigDir: string, marketplaceName: string, pluginName: string): string {
  return join(claudeConfigDir, 'plugins', 'cache', marketplaceName, pluginName, '*');
}

/**
 * Key of a plugin in the ledger
 * @param marketplaceName - Name of the marketplace
 * @param pluginName - Name of the plugin
 * @returns `<marketplace>/<plugin>`
 */
export function pluginPermissionKey(marketplaceName: string, pluginName: string): string {
  return `${marketplaceName}/${pluginName}`;
}

/**
 * Ledger entries for one settings file. Never throws: a missing or unreadable ledger reads
 * as empty, which only means every plugin is treated as seen for the first time.
 * @param ledgerPath - Path of the ledger
 * @param settingsPath - settings.json the rules were written to
 * @returns `<marketplace>/<plugin>` → entry
 */
export function readLedgerEntries(ledgerPath: string, settingsPath: string): Record<string, PluginLedgerEntry> {
  return readLedger(ledgerPath).settings[settingsPath] ?? {};
}

/**
 * Record a plugin's ledger entry. Written via temp file + rename, so an interrupted run
 * cannot leave a truncated ledger.
 * @param ledgerPath - Path of the ledger
 * @param settingsPath - settings.json the rules were written to
 * @param pluginKey - `<marketplace>/<plugin>`
 * @param entry - The plugin's entry
 */
export function recordLedgerEntry(
  ledgerPath: string,
  settingsPath: string,
  pluginKey: string,
  entry: PluginLedgerEntry,
): void {
  const ledger = readLedger(ledgerPath);
  ledger.settings[settingsPath] = { ...ledger.settings[settingsPath], [pluginKey]: entry };
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const tmpPath = `${ledgerPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(tmpPath, ledgerPath);
}

/**
 * Replace `${CLAUDE_PLUGIN_ROOT}` in a rule. A rule without the variable comes back unchanged.
 * @param rule - Permission rule as the plugin ships it
 * @param pluginRoot - Replacement, usually {@link pluginCacheRootPattern}
 * @returns The rule as it has to be written to settings.json
 */
export function resolvePluginRootVariable(rule: string, pluginRoot: string): string {
  // A replacer function, so a `$` in the path is not read as a replacement pattern.
  return rule.replace(PLUGIN_ROOT_VARIABLE, () => pluginRoot);
}

/**
 * Read and validate the ledger. Entries of the wrong shape are dropped.
 * @param ledgerPath - Path of the ledger
 * @returns The ledger, empty when missing or unreadable
 */
function readLedger(ledgerPath: string): PermissionLedgerFile {
  const ledger: PermissionLedgerFile = { settings: {}, version: LEDGER_VERSION };
  let parsed: null | Partial<PermissionLedgerFile> = null;
  try {
    parsed = existsSync(ledgerPath)
      ? safeJsonParse<Partial<PermissionLedgerFile>>(readFileSync(ledgerPath, 'utf-8'))
      : null;
  } catch {
    return ledger;
  }
  if (!parsed || typeof parsed.settings !== 'object' || parsed.settings === null) {
    return ledger;
  }
  for (const [settingsPath, plugins] of Object.entries(parsed.settings)) {
    if (typeof plugins !== 'object' || plugins === null) {
      continue;
    }
    const entries: Record<string, PluginLedgerEntry> = {};
    for (const [pluginKey, entry] of Object.entries(plugins)) {
      if (typeof entry === 'object' && entry !== null && Array.isArray(entry.owned)) {
        entries[pluginKey] = { formerApplied: stringsOf(entry.formerApplied), owned: stringsOf(entry.owned) };
      }
    }
    ledger.settings[settingsPath] = entries;
  }
  return ledger;
}

/**
 * The string elements of a value that should be a string list
 * @param value - Parsed JSON value
 * @returns Its strings, or an empty list
 */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
