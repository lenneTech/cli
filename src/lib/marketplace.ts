/**
 * Plugin marketplace utilities
 * Handles fetching and managing plugins from GitHub-based marketplaces
 */
import { execSync } from 'child_process';

import { safeJsonParse } from './json-utils';

/**
 * Marketplace configuration for a GitHub-based plugin repository
 */
export interface MarketplaceConfig {
  /** GitHub API base URL for the repository contents */
  apiBase: string;
  /** Unique name identifier for this marketplace */
  name: string;
  /** Whether this is a private repo requiring an authenticated GitHub token */
  private?: boolean;
  /** Raw content base URL for direct file access */
  rawBase: string;
  /** GitHub repository in format 'owner/repo' */
  repo: string;
}

/**
 * Plugin configuration from marketplace
 */
export interface PluginConfig {
  /** Plugin description */
  description: string;
  /** Name of the marketplace this plugin belongs to */
  marketplaceName: string;
  /** GitHub repository of the marketplace */
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
 * Structure of marketplace.json (used by official marketplace)
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
 * Available marketplaces for plugin discovery
 */
export const MARKETPLACES: MarketplaceConfig[] = [
  {
    apiBase: 'https://api.github.com/repos/lenneTech/claude-code/contents',
    name: 'lenne-tech',
    rawBase: 'https://raw.githubusercontent.com/lenneTech/claude-code/main',
    repo: 'lenneTech/claude-code',
  },
  {
    apiBase: 'https://api.github.com/repos/anthropics/claude-plugins-official/contents',
    name: 'claude-plugins-official',
    rawBase: 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main',
    repo: 'anthropics/claude-plugins-official',
  },
  // Private lenne.Tech-internal marketplace. Only reachable for team members with
  // repo access + a GitHub token (GH_TOKEN/GITHUB_TOKEN or the gh CLI). Without
  // access it is silently skipped — discovery/install never fail because of it.
  {
    apiBase: 'https://api.github.com/repos/lenneTech/claude-code-internal/contents',
    name: 'lenne-tech-internal',
    private: true,
    rawBase: 'https://raw.githubusercontent.com/lenneTech/claude-code-internal/main',
    repo: 'lenneTech/claude-code-internal',
  },
];

/**
 * Default plugins to install when no specific plugins are requested
 * These are installed in addition to all plugins from the primary marketplace (lenne-tech)
 */
export const DEFAULT_EXTERNAL_PLUGINS: Array<{ marketplaceName: string; pluginName: string }> = [
  { marketplaceName: 'claude-plugins-official', pluginName: 'typescript-lsp' },
];

/**
 * Fetch available plugins from all configured marketplaces
 * @param spin - Spinner factory function from toolbox
 * @returns Array of plugin configurations
 * @throws Error if no plugins are found
 */
export async function fetchAvailablePlugins(
  spin: (msg: string) => { fail: (msg: string) => void; succeed: (msg: string) => void },
): Promise<PluginConfig[]> {
  const spinner = spin('Fetching available plugins from marketplaces');

  try {
    // Fetch plugins from all marketplaces in parallel
    const results = await Promise.all(MARKETPLACES.map((marketplace) => fetchPluginsFromMarketplace(marketplace)));

    // Flatten results
    const plugins = results.flat();

    if (plugins.length === 0) {
      spinner.fail('No plugins found in any marketplace');
      throw new Error('No plugins found');
    }

    // Group by marketplace for display
    const byMarketplace = MARKETPLACES.map((m) => ({
      count: plugins.filter((p) => p.marketplaceName === m.name).length,
      name: m.name,
    })).filter((m) => m.count > 0);

    const summary = byMarketplace.map((m) => `${m.name}: ${m.count}`).join(', ');
    spinner.succeed(`Found ${plugins.length} plugins (${summary})`);
    return plugins;
  } catch (err) {
    spinner.fail('Failed to fetch plugins from marketplaces');
    throw err;
  }
}

/**
 * Fetch available plugins from a single marketplace
 * First tries central marketplace.json, then falls back to directory scan
 * @param marketplace - Marketplace configuration
 * @returns Array of plugin configurations
 */
export async function fetchPluginsFromMarketplace(marketplace: MarketplaceConfig): Promise<PluginConfig[]> {
  const plugins: PluginConfig[] = [];

  // Private marketplaces (e.g. the internal one) need a GitHub token. No token
  // available → silently skip so discovery never fails for users without access.
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
            marketplaceRepo: marketplace.repo,
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
              marketplaceRepo: marketplace.repo,
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
    const fromGh = execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return fromGh || undefined;
  } catch {
    return undefined;
  }
}
