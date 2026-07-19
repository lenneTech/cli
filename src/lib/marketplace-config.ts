/**
 * User-level configuration for additional Claude Code plugin marketplaces.
 *
 * Marketplace repositories must NOT be hard-coded in the (public) CLI source.
 * Instead they live in a local, user-owned config file so that private/internal
 * repositories stay confidential and any number of extra marketplaces can be
 * added. The file is read on every `lt claude plugins` run and maintained via
 * `lt claude marketplaces`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { safeJsonParse } from './json-utils';

/**
 * A single marketplace entry as stored in the config file.
 */
export interface ConfiguredMarketplace {
  /** Whether all of this marketplace's plugins are installed on a bare `lt claude plugins` run */
  autoInstall?: boolean;
  /** Git branch to track (default: main) */
  branch?: string;
  /** Optional human-readable description */
  description?: string;
  /**
   * Marketplace name. MUST match the `name` field of the repository's
   * `.claude-plugin/marketplace.json` so it lines up with the directory the
   * Claude CLI creates under ~/.claude/plugins/marketplaces/<name>.
   */
  name: string;
  /** Whether this is a private repository (access-restricted) */
  private?: boolean;
  /** Discovery/installation strategy (default: git) */
  provider?: MarketplaceProvider;
  /** Source passed to `claude plugin marketplace add` — a Git URL or owner/repo */
  source: string;
}

/**
 * On-disk structure of the marketplace config file.
 */
export interface MarketplaceConfigFile {
  marketplaces: ConfiguredMarketplace[];
  /** Config schema version for forward compatibility */
  version: number;
}

/**
 * Discovery/installation strategy for a configured marketplace.
 * - `git`: clone via `claude plugin marketplace add <source>` (SSH or HTTPS) and
 *   read the marketplace manifest from the local checkout. Works for GitLab,
 *   GitHub and any other Git host, requires no API token, and access is governed
 *   solely by the user's Git permissions (unauthorized users are skipped).
 * - `github`: fast GitHub REST API discovery (optionally token-authenticated for
 *   private repos). Only valid for github.com repositories.
 */
export type MarketplaceProvider = 'git' | 'github';

/**
 * Directory holding lenne.Tech CLI user configuration (shared with e.g. the
 * `lt dev` Caddyfile). Resolved at call time so tests can redirect it.
 * @returns Absolute path to the lenne.Tech config directory
 */
export function getLtConfigDir(): string {
  return process.env.LT_CONFIG_DIR || join(homedir(), '.lenneTech');
}

/**
 * Absolute path to the marketplace configuration file. Resolved at call time so
 * tests can redirect it via LT_MARKETPLACE_CONFIG or LT_CONFIG_DIR.
 * @returns Absolute path to claude-marketplaces.json
 */
export function getMarketplaceConfigPath(): string {
  return process.env.LT_MARKETPLACE_CONFIG || join(getLtConfigDir(), 'claude-marketplaces.json');
}

const CONFIG_VERSION = 1;

/**
 * Read the configured marketplaces from disk.
 * Never throws — returns an empty array when the file is missing or invalid.
 * @returns Array of configured marketplaces (validated, deduplicated by name)
 */
export function readConfiguredMarketplaces(): ConfiguredMarketplace[] {
  const configPath = getMarketplaceConfigPath();
  if (!existsSync(configPath)) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    return [];
  }
  const parsed = safeJsonParse<MarketplaceConfigFile>(raw);
  if (!parsed || !Array.isArray(parsed.marketplaces)) {
    return [];
  }
  // Keep only structurally valid entries and drop duplicates (first wins).
  const seen = new Set<string>();
  const result: ConfiguredMarketplace[] = [];
  for (const entry of parsed.marketplaces) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.source !== 'string') {
      continue;
    }
    const name = entry.name.trim();
    const source = entry.source.trim();
    if (!name || !source || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push({ ...entry, name, source });
  }
  return result;
}

/**
 * Remove a marketplace entry by name.
 * @param name - Name of the marketplace to remove
 * @returns Object with the updated list and whether an entry was removed
 */
export function removeConfiguredMarketplace(name: string): { marketplaces: ConfiguredMarketplace[]; removed: boolean } {
  const target = name.trim();
  const current = readConfiguredMarketplaces();
  const next = current.filter((m) => m.name !== target);
  const removed = next.length !== current.length;
  if (removed) {
    writeConfiguredMarketplaces(next);
  }
  return { marketplaces: next, removed };
}

/**
 * Add or update a marketplace entry (matched by name). Returns the resulting
 * list. Existing entries with the same name are replaced.
 * @param entry - Marketplace to add or update
 * @returns The updated list of configured marketplaces
 */
export function upsertConfiguredMarketplace(entry: ConfiguredMarketplace): ConfiguredMarketplace[] {
  const name = entry.name.trim();
  const source = entry.source.trim();
  const normalized: ConfiguredMarketplace = { ...entry, name, source };
  const current = readConfiguredMarketplaces().filter((m) => m.name !== name);
  current.push(normalized);
  writeConfiguredMarketplaces(current);
  return current;
}

/**
 * Persist the given marketplaces to disk, creating the config directory if
 * needed.
 * @param marketplaces - Marketplaces to write
 */
export function writeConfiguredMarketplaces(marketplaces: ConfiguredMarketplace[]): void {
  const configPath = getMarketplaceConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload: MarketplaceConfigFile = { marketplaces, version: CONFIG_VERSION };
  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}
