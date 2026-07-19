/**
 * Plugin marketplace utilities
 * Handles discovering and managing plugins from configurable marketplaces.
 *
 * Built-in marketplaces (public) are discovered via the GitHub REST API.
 * Additional marketplaces — including private/internal ones on GitLab, GitHub or
 * any other Git host — are NOT hard-coded here (that would expose internal repo
 * URLs in this public package). They are loaded from the user's local config
 * (see marketplace-config.ts) and discovered by cloning them via the Claude CLI
 * and reading the manifest from the local checkout.
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { checkMarketplaceExists, CLAUDE_MARKETPLACES_DIR, runClaudeCommand } from './claude-cli';
import { safeJsonParse } from './json-utils';
import { ConfiguredMarketplace, MarketplaceProvider, readConfiguredMarketplaces } from './marketplace-config';

/**
 * Marketplace configuration for plugin discovery
 */
export interface MarketplaceConfig {
  /** GitHub API base URL for the repository contents (github provider only) */
  apiBase?: string;
  /** Whether all of this marketplace's plugins are installed on a bare run */
  autoInstall?: boolean;
  /** Git branch to track (git provider, default: main) */
  branch?: string;
  /** Unique name identifier for this marketplace */
  name: string;
  /** Whether this is a private repo (access-restricted) */
  private?: boolean;
  /** Discovery strategy (default: github) */
  provider?: MarketplaceProvider;
  /** Raw content base URL for direct file access (github provider only) */
  rawBase?: string;
  /** GitHub repository in format 'owner/repo' (github provider) */
  repo?: string;
  /** Source passed to `claude plugin marketplace add` — a Git URL or owner/repo */
  source?: string;
}

/**
 * Plugin configuration from marketplace
 */
export interface PluginConfig {
  /** Plugin description */
  description: string;
  /** Name of the marketplace this plugin belongs to */
  marketplaceName: string;
  /** Source of the marketplace this plugin belongs to (owner/repo or Git URL) */
  marketplaceRepo: string;
  /** Name of the plugin */
  pluginName: string;
}

/**
 * GitHub API directory entry response
 */
interface GitHubDirEntry {
  name: string;
  type: 'dir' | 'file';
}

/**
 * Structure of marketplace.json (used by the central marketplace manifest)
 */
interface MarketplaceManifest {
  plugins?: Array<{
    description?: string;
    name: string;
    source?: string;
  }>;
}

/**
 * Structure of plugin.json in the repository
 */
interface PluginManifest {
  author?: { name: string; url?: string };
  description: string;
  keywords?: string[];
  name: string;
  version: string;
}

/**
 * Built-in, public marketplaces that always ship with the CLI.
 * Private/internal marketplaces are configured locally, never listed here.
 */
export const BUILTIN_MARKETPLACES: MarketplaceConfig[] = [
  {
    apiBase: 'https://api.github.com/repos/lenneTech/claude-code/contents',
    name: 'lenne-tech',
    provider: 'github',
    rawBase: 'https://raw.githubusercontent.com/lenneTech/claude-code/main',
    repo: 'lenneTech/claude-code',
  },
  {
    apiBase: 'https://api.github.com/repos/anthropics/claude-plugins-official/contents',
    name: 'claude-plugins-official',
    provider: 'github',
    rawBase: 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main',
    repo: 'anthropics/claude-plugins-official',
  },
];

/**
 * Name of the primary marketplace whose plugins are installed by default.
 */
export const PRIMARY_MARKETPLACE_NAME = BUILTIN_MARKETPLACES[0].name;

/**
 * Default plugins to install when no specific plugins are requested
 * These are installed in addition to all plugins from the primary marketplace (lenne-tech)
 */
export const DEFAULT_EXTERNAL_PLUGINS: Array<{ marketplaceName: string; pluginName: string }> = [
  { marketplaceName: 'claude-plugins-official', pluginName: 'typescript-lsp' },
];

/**
 * Map a locally configured marketplace to a MarketplaceConfig used for discovery.
 * Defaults to the provider-agnostic `git` strategy; a `github` provider derives
 * API/raw bases from the source so it can use the fast REST discovery path.
 * @param entry - Configured marketplace from the user config
 * @returns Discovery configuration
 */
export function configuredToMarketplaceConfig(entry: ConfiguredMarketplace): MarketplaceConfig {
  const provider: MarketplaceProvider = entry.provider ?? 'git';
  const base: MarketplaceConfig = {
    autoInstall: entry.autoInstall ?? true,
    branch: entry.branch,
    name: entry.name,
    private: entry.private,
    provider,
    source: entry.source,
  };

  if (provider === 'github') {
    const repo = deriveGitHubRepo(entry.source);
    if (repo) {
      const branch = entry.branch || 'main';
      base.apiBase = `https://api.github.com/repos/${repo}/contents`;
      base.rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;
      base.repo = repo;
    }
  }

  return base;
}

/**
 * Derive an 'owner/repo' identifier from a marketplace source (github provider).
 * Accepts 'owner/repo', an https GitHub URL or an SSH GitHub URL.
 * @param source - Marketplace source string
 * @returns 'owner/repo' or undefined when it is not a recognizable GitHub source
 */
export function deriveGitHubRepo(source: string): string | undefined {
  const trimmed = source.trim().replace(/\.git$/, '');
  // https://github.com/owner/repo or git@github.com:owner/repo (check first, so
  // a host prefix like git@gitlab.example.com:… is not mistaken for owner/repo).
  const match = trimmed.match(/github\.com[:/]([^/\s]+\/[^/\s]+)$/);
  if (match) {
    return match[1];
  }
  // Plain owner/repo — reject anything carrying URL/host syntax (@, :, /host/…).
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/**
 * Fetch available plugins from all marketplaces (built-in + configured)
 * @param spin - Spinner factory function from toolbox
 * @param cli - Path to the Claude CLI (required to discover `git` marketplaces)
 * @returns Array of plugin configurations
 * @throws Error if no plugins are found
 */
export async function fetchAvailablePlugins(
  spin: (msg: string) => { fail: (msg: string) => void; succeed: (msg: string) => void },
  cli?: null | string,
): Promise<PluginConfig[]> {
  const spinner = spin('Fetching available plugins from marketplaces');
  const marketplaces = getAllMarketplaces();

  try {
    // Fetch plugins from all marketplaces in parallel
    const results = await Promise.all(marketplaces.map((marketplace) => fetchPluginsFromMarketplace(marketplace, cli)));

    // Flatten results
    const plugins = results.flat();

    if (plugins.length === 0) {
      spinner.fail('No plugins found in any marketplace');
      throw new Error('No plugins found');
    }

    // Group by marketplace for display
    const byMarketplace = marketplaces
      .map((m) => ({
        count: plugins.filter((p) => p.marketplaceName === m.name).length,
        name: m.name,
      }))
      .filter((m) => m.count > 0);

    const summary = byMarketplace.map((m) => `${m.name}: ${m.count}`).join(', ');
    spinner.succeed(`Found ${plugins.length} plugins (${summary})`);
    return plugins;
  } catch (err) {
    spinner.fail('Failed to fetch plugins from marketplaces');
    throw err;
  }
}

/**
 * Fetch available plugins from a single marketplace, dispatching on provider.
 * @param marketplace - Marketplace configuration
 * @param cli - Path to the Claude CLI (required for the `git` provider)
 * @returns Array of plugin configurations
 */
export async function fetchPluginsFromMarketplace(
  marketplace: MarketplaceConfig,
  cli?: null | string,
): Promise<PluginConfig[]> {
  if (marketplace.provider === 'git') {
    return fetchPluginsFromGitMarketplace(marketplace, cli);
  }
  return fetchPluginsFromGitHubMarketplace(marketplace);
}

/**
 * Return all marketplaces: built-in public ones plus any configured locally.
 * @returns Combined list of marketplace configurations
 */
export function getAllMarketplaces(): MarketplaceConfig[] {
  const configured = readConfiguredMarketplaces().map(configuredToMarketplaceConfig);
  // Built-in names take precedence; drop configured entries that collide.
  const builtinNames = new Set(BUILTIN_MARKETPLACES.map((m) => m.name));
  const extra = configured.filter((m) => !builtinNames.has(m.name));
  return [...BUILTIN_MARKETPLACES, ...extra];
}

/**
 * Print available plugins list
 * @param plugins - Array of plugin configurations
 * @param info - Info print function from toolbox
 */
export function printAvailablePlugins(plugins: PluginConfig[], info: (msg: string) => void): void {
  info('Available plugins:');
  for (const plugin of plugins) {
    info(`  ${plugin.pluginName} - ${plugin.description}`);
  }
}

/**
 * Discover plugins from a `github`-provider marketplace via the GitHub REST API.
 * First tries the central marketplace.json, then falls back to a directory scan.
 * @param marketplace - Marketplace configuration (must have apiBase/rawBase)
 * @returns Array of plugin configurations
 */
async function fetchPluginsFromGitHubMarketplace(marketplace: MarketplaceConfig): Promise<PluginConfig[]> {
  const plugins: PluginConfig[] = [];
  if (!marketplace.apiBase || !marketplace.rawBase) {
    return plugins;
  }
  const repo = marketplace.repo || marketplace.source || marketplace.name;

  // Private marketplaces need a GitHub token. No token available → silently skip
  // so discovery never fails for users without access.
  const token = marketplace.private ? getGitHubToken() : undefined;
  if (marketplace.private && !token) {
    return plugins;
  }
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    // First try to read central marketplace.json. Private repos: via the API
    // contents endpoint with the raw media type (raw.githubusercontent.com does
    // not serve private content).
    const marketplaceJsonUrl = marketplace.private
      ? `${marketplace.apiBase}/.claude-plugin/marketplace.json`
      : `${marketplace.rawBase}/.claude-plugin/marketplace.json`;
    const marketplaceJsonResponse = await fetch(marketplaceJsonUrl, {
      headers: marketplace.private ? { ...authHeaders, Accept: 'application/vnd.github.raw+json' } : authHeaders,
    });

    if (marketplaceJsonResponse.ok) {
      const text = await marketplaceJsonResponse.text();
      const marketplaceManifest = safeJsonParse<MarketplaceManifest>(text);

      if (marketplaceManifest?.plugins && marketplaceManifest.plugins.length > 0) {
        for (const plugin of marketplaceManifest.plugins) {
          plugins.push({
            description: plugin.description || '',
            marketplaceName: marketplace.name,
            marketplaceRepo: repo,
            pluginName: plugin.name,
          });
        }
        return plugins;
      }
    }

    // Fallback: Get list of plugin directories and read individual plugin.json files
    const dirResponse = await fetch(`${marketplace.apiBase}/plugins`, { headers: authHeaders });
    if (!dirResponse.ok) {
      return plugins;
    }

    const text = await dirResponse.text();
    const directories = safeJsonParse<GitHubDirEntry[]>(text);
    if (!directories) {
      return plugins;
    }

    const pluginDirs = directories.filter((d) => d.type === 'dir');

    // Fetch plugin.json for each plugin in parallel
    const manifestPromises = pluginDirs.map(async (dir) => {
      try {
        const manifestUrl = marketplace.private
          ? `${marketplace.apiBase}/plugins/${dir.name}/.claude-plugin/plugin.json`
          : `${marketplace.rawBase}/plugins/${dir.name}/.claude-plugin/plugin.json`;
        const manifestResponse = await fetch(manifestUrl, {
          headers: marketplace.private ? { ...authHeaders, Accept: 'application/vnd.github.raw+json' } : authHeaders,
        });

        if (manifestResponse.ok) {
          const manifestText = await manifestResponse.text();
          const manifest = safeJsonParse<PluginManifest>(manifestText);

          if (manifest) {
            return {
              description: manifest.description,
              marketplaceName: marketplace.name,
              marketplaceRepo: repo,
              pluginName: manifest.name,
            } as PluginConfig;
          }
        }
      } catch {
        // Skip plugins without valid manifest
      }
      return null;
    });

    const results = await Promise.all(manifestPromises);
    plugins.push(...results.filter((p): p is PluginConfig => p !== null));
  } catch {
    // Marketplace fetch failed, return empty array
  }

  return plugins;
}

/**
 * Discover plugins from a `git`-provider marketplace: ensure the marketplace is
 * present locally (clone via the Claude CLI), then read its manifest from the
 * local checkout. Requires no API token — access is governed by the user's Git
 * permissions, so unauthorized users are skipped silently.
 * @param marketplace - Marketplace configuration (must have a source)
 * @param cli - Path to the Claude CLI
 * @returns Array of plugin configurations (empty when inaccessible)
 */
function fetchPluginsFromGitMarketplace(marketplace: MarketplaceConfig, cli?: null | string): PluginConfig[] {
  const plugins: PluginConfig[] = [];
  const source = marketplace.source || marketplace.repo;
  if (!cli || !source) {
    return plugins;
  }

  // Ensure the marketplace exists locally. Add it if missing; a failed add
  // (e.g. no repo access) is treated as "skip" so discovery never hard-fails.
  if (!checkMarketplaceExists(marketplace.name)) {
    const addResult = runClaudeCommand(cli, `plugin marketplace add ${source}`);
    if (!addResult.success && !addResult.output.includes('already') && !checkMarketplaceExists(marketplace.name)) {
      return plugins;
    }
  } else {
    // Refresh the local cache to pick up newly published plugins (best effort).
    runClaudeCommand(cli, `plugin marketplace update ${marketplace.name}`);
  }

  // Read the central manifest from the local checkout.
  const manifestPath = join(CLAUDE_MARKETPLACES_DIR, marketplace.name, '.claude-plugin', 'marketplace.json');
  if (!existsSync(manifestPath)) {
    return plugins;
  }

  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, 'utf-8');
  } catch {
    return plugins;
  }

  const manifest = safeJsonParse<MarketplaceManifest>(manifestText);
  if (!manifest?.plugins) {
    return plugins;
  }

  for (const plugin of manifest.plugins) {
    if (!plugin?.name) {
      continue;
    }
    plugins.push({
      description: plugin.description || '',
      marketplaceName: marketplace.name,
      marketplaceRepo: source,
      pluginName: plugin.name,
    });
  }

  return plugins;
}

/**
 * Resolve a GitHub token for authenticated access to private marketplaces.
 * Tries GH_TOKEN / GITHUB_TOKEN, then the gh CLI. Returns undefined when none is
 * available — callers then simply skip private marketplaces (commands never fail).
 * @returns A GitHub token or undefined
 */
function getGitHubToken(): string | undefined {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) {
    return fromEnv.trim();
  }
  try {
    const fromGh = execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return fromGh || undefined;
  } catch {
    return undefined;
  }
}
