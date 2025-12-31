import { execSync, spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Marketplace configuration
 */
interface MarketplaceConfig {
  apiBase: string;
  name: string;
  rawBase: string;
  repo: string;
}

const MARKETPLACES: MarketplaceConfig[] = [
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
];

/**
 * Default plugins to install when no specific plugins are requested
 * These are installed in addition to all plugins from the primary marketplace (lenne-tech)
 */
const DEFAULT_EXTERNAL_PLUGINS: Array<{ marketplaceName: string; pluginName: string }> = [
  { marketplaceName: 'claude-plugins-official', pluginName: 'typescript-lsp' },
];

/**
 * GitHub API directory entry
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
 * Plugin configuration
 */
interface PluginConfig {
  description: string;
  marketplaceName: string;
  marketplaceRepo: string;
  pluginName: string;
}

/**
 * Plugin contents (skills, commands, hooks, agents, permissions, mcpServers)
 */
interface PluginContents {
  agents: string[];
  commands: string[];
  hooks: number;
  mcpServers: string[];
  permissions: string[];
  skills: string[];
}

/**
 * Empty plugin contents constant (used for failed installations)
 */
const EMPTY_PLUGIN_CONTENTS: PluginContents = {
  agents: [],
  commands: [],
  hooks: 0,
  mcpServers: [],
  permissions: [],
  skills: [],
};

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
 * Structure of the permissions.json file in the plugin
 */
interface PluginPermissions {
  description?: string;
  permissions: Array<{
    description?: string;
    pattern: string;
    usedBy?: string[];
  }>;
}

/**
 * Fetch available plugins from all marketplaces
 */
async function fetchAvailablePlugins(
  spin: (msg: string) => { fail: (msg: string) => void; succeed: (msg: string) => void },
): Promise<PluginConfig[]> {
  const spinner = spin('Fetching available plugins from marketplaces');

  try {
    // Fetch plugins from all marketplaces in parallel
    const results = await Promise.all(
      MARKETPLACES.map(marketplace => fetchPluginsFromMarketplace(marketplace))
    );

    // Flatten results
    const plugins = results.flat();

    if (plugins.length === 0) {
      spinner.fail('No plugins found in any marketplace');
      throw new Error('No plugins found');
    }

    // Group by marketplace for display
    const byMarketplace = MARKETPLACES.map(m => ({
      count: plugins.filter(p => p.marketplaceName === m.name).length,
      name: m.name,
    })).filter(m => m.count > 0);

    const summary = byMarketplace.map(m => `${m.name}: ${m.count}`).join(', ');
    spinner.succeed(`Found ${plugins.length} plugins (${summary})`);
    return plugins;
  } catch (err) {
    spinner.fail('Failed to fetch plugins from marketplaces');
    throw err;
  }
}

/**
 * Fetch available plugins from a single marketplace
 */
async function fetchPluginsFromMarketplace(
  marketplace: MarketplaceConfig,
): Promise<PluginConfig[]> {
  const plugins: PluginConfig[] = [];

  try {
    // First try to read central marketplace.json (used by official marketplace)
    const marketplaceJsonUrl = `${marketplace.rawBase}/.claude-plugin/marketplace.json`;
    const marketplaceJsonResponse = await fetch(marketplaceJsonUrl);

    if (marketplaceJsonResponse.ok) {
      try {
        const marketplaceManifest: MarketplaceManifest = await marketplaceJsonResponse.json();
        if (marketplaceManifest.plugins && marketplaceManifest.plugins.length > 0) {
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
      } catch {
        // Failed to parse marketplace.json, fall through to directory scan
      }
    }

    // Fallback: Get list of plugin directories and read individual plugin.json files
    const dirResponse = await fetch(`${marketplace.apiBase}/plugins`);
    if (!dirResponse.ok) {
      return plugins;
    }

    const directories: GitHubDirEntry[] = await dirResponse.json();
    const pluginDirs = directories.filter(d => d.type === 'dir');

    // Fetch plugin.json for each plugin in parallel
    const manifestPromises = pluginDirs.map(async (dir) => {
      try {
        const manifestUrl = `${marketplace.rawBase}/plugins/${dir.name}/.claude-plugin/plugin.json`;
        const manifestResponse = await fetch(manifestUrl);

        if (manifestResponse.ok) {
          const manifest: PluginManifest = await manifestResponse.json();
          return {
            description: manifest.description,
            marketplaceName: marketplace.name,
            marketplaceRepo: marketplace.repo,
            pluginName: manifest.name,
          } as PluginConfig;
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
 * Find the claude CLI executable path
 */
function findClaudeCli(): null | string {
  const possiblePaths = [
    join(homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  try {
    const result = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const path = result.trim();
    if (path && existsSync(path)) {
      return path;
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Recursively find all .md files in a directory
 */
function findMarkdownFiles(dir: string, basePath = ''): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath, relativePath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Convert path to command name (e.g., "git/commit-message.md" -> "/git:commit-message")
        const commandName = relativePath
          .replace(/\.md$/, '')
          .replace(/\//g, ':');
        results.push(`/${commandName}`);
      }
    }
  } catch {
    // Ignore errors
  }

  return results;
}

/**
 * Install a single plugin (marketplace must already be added and updated)
 */
async function installPlugin(
  plugin: PluginConfig,
  cli: string,
  toolbox: ExtendedGluegunToolbox,
): Promise<{ action: string; contents: PluginContents; success: boolean }> {
  const {
    print: { error, info, spin },
  } = toolbox;

  // Step 1: Install or update plugin
  const fullPluginName = `${plugin.pluginName}@${plugin.marketplaceName}`;
  const pluginSpinner = spin(`Installing/updating ${plugin.pluginName}`);
  const installResult = runClaudeCommand(cli, `plugin install ${fullPluginName}`);

  let pluginAction = 'installed';
  if (installResult.output.includes('already') || installResult.output.includes('up to date')) {
    pluginAction = 'up to date';
  } else if (installResult.output.includes('update') || installResult.output.includes('upgrade')) {
    pluginAction = 'updated';
  }

  if (installResult.success || installResult.output.includes('already') || installResult.output.includes('up to date')) {
    pluginSpinner.succeed(`${plugin.pluginName} ${pluginAction}`);
  } else {
    pluginSpinner.fail(`Failed to install ${plugin.pluginName}`);
    error(installResult.output);
    info('');
    info('Manual installation:');
    info(`  /plugin marketplace add ${plugin.marketplaceRepo}`);
    info(`  /plugin install ${fullPluginName}`);
    return { action: 'failed', contents: EMPTY_PLUGIN_CONTENTS, success: false };
  }

  // Step 2: Read plugin contents
  const pluginContents = readPluginContents(plugin.marketplaceName, plugin.pluginName);

  // Warn if plugin seems empty (but not for LSP plugins which don't have skills/commands)
  const isLspPlugin = plugin.pluginName.endsWith('-lsp');
  if (!isLspPlugin && pluginContents.skills.length === 0 && pluginContents.commands.length === 0) {
    info('');
    info(`Warning: No skills or commands found for ${plugin.pluginName}. Plugin may not be installed correctly.`);
  }

  // Step 3: Setup permissions
  if (pluginContents.permissions.length > 0) {
    const permSpinner = spin(`Configuring permissions for ${plugin.pluginName}`);
    const permResult = setupPermissions(pluginContents.permissions, error);

    if (permResult.success) {
      if (permResult.added.length > 0) {
        permSpinner.succeed(`Permissions configured for ${plugin.pluginName} (${permResult.added.length} added)`);
      } else {
        permSpinner.succeed(`Permissions already configured for ${plugin.pluginName}`);
      }
    } else {
      permSpinner.fail(`Failed to configure permissions for ${plugin.pluginName}`);
      info('');
      info('Add manually to ~/.claude/settings.json:');
      info(JSON.stringify({ permissions: { allow: pluginContents.permissions } }, null, 2));
    }
  }

  return { action: pluginAction, contents: pluginContents, success: true };
}

/**
 * Prepare marketplaces (add and update cache) for a list of plugins
 * Returns the set of successfully prepared marketplace names
 */
function prepareMarketplaces(
  plugins: PluginConfig[],
  cli: string,
  toolbox: ExtendedGluegunToolbox,
): Set<string> {
  const {
    print: { error, spin },
  } = toolbox;

  // Get unique marketplaces from plugins
  const marketplaceMap = new Map<string, PluginConfig>();
  for (const plugin of plugins) {
    if (!marketplaceMap.has(plugin.marketplaceName)) {
      marketplaceMap.set(plugin.marketplaceName, plugin);
    }
  }

  const preparedMarketplaces = new Set<string>();

  for (const [marketplaceName, plugin] of marketplaceMap) {
    // Add marketplace
    const addSpinner = spin(`Adding marketplace ${marketplaceName}`);
    const addResult = runClaudeCommand(cli, `plugin marketplace add ${plugin.marketplaceRepo}`);

    if (addResult.success || addResult.output.includes('already')) {
      addSpinner.succeed(`Marketplace ${marketplaceName} added`);
    } else {
      addSpinner.fail(`Failed to add marketplace ${marketplaceName}`);
      error(addResult.output);
      continue;
    }

    // Update marketplace cache
    const updateSpinner = spin(`Updating marketplace cache for ${marketplaceName}`);
    const updateResult = runClaudeCommand(cli, `plugin marketplace update ${marketplaceName}`);

    if (updateResult.success) {
      updateSpinner.succeed(`Marketplace ${marketplaceName} cache updated`);
    } else {
      updateSpinner.stopAndPersist({ symbol: '⚠', text: `Could not update ${marketplaceName} cache, using cached version` });
    }

    preparedMarketplaces.add(marketplaceName);
  }

  return preparedMarketplaces;
}

/**
 * Print plugin summary
 */
function printPluginSummary(
  pluginName: string,
  contents: PluginContents,
  info: (msg: string) => void,
): void {
  const isLspPlugin = pluginName.endsWith('-lsp');
  const hasContent = contents.skills.length > 0 || contents.commands.length > 0 || contents.agents.length > 0;

  if (hasContent || isLspPlugin) {
    info('');
    info(`${pluginName}:`);

    // Show LSP indicator for LSP plugins
    if (isLspPlugin) {
      info(`  Type: Language Server (LSP)`);
    }

    // Alphabetical order: Agents, Commands, Hooks, MCP Servers, Skills
    if (contents.agents.length > 0) {
      info(`  Agents (${contents.agents.length}): ${contents.agents.join(', ')}`);
    }
    if (contents.commands.length > 0) {
      const maxShow = 5;
      const shown = contents.commands.slice(0, maxShow);
      const remaining = contents.commands.length - maxShow;
      const commandsStr = remaining > 0
        ? `${shown.join(', ')} and ${remaining} more`
        : shown.join(', ');
      info(`  Commands (${contents.commands.length}): ${commandsStr}`);
    }
    if (contents.hooks > 0) {
      info(`  Hooks: ${contents.hooks} auto-detection hooks`);
    }
    if (contents.mcpServers.length > 0) {
      info(`  MCP Servers (${contents.mcpServers.length}): ${contents.mcpServers.join(', ')}`);
    }
    if (contents.skills.length > 0) {
      info(`  Skills (${contents.skills.length}): ${contents.skills.join(', ')}`);
    }
  }
}

/**
 * Read plugin contents from installed plugin directory
 */
function readPluginContents(marketplaceName: string, pluginName: string): PluginContents {
  const pluginDir = join(
    homedir(),
    '.claude',
    'plugins',
    'marketplaces',
    marketplaceName,
    'plugins',
    pluginName
  );

  const result: PluginContents = {
    agents: [],
    commands: [],
    hooks: 0,
    mcpServers: [],
    permissions: [],
    skills: [],
  };

  // Read skills
  const skillsDir = join(pluginDir, 'skills');
  if (existsSync(skillsDir)) {
    try {
      result.skills = readdirSync(skillsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch {
      // Ignore
    }
  }

  // Read agents
  const agentsDir = join(pluginDir, 'agents');
  if (existsSync(agentsDir)) {
    try {
      result.agents = readdirSync(agentsDir, { withFileTypes: true })
        .filter(dirent => dirent.isFile() && dirent.name.endsWith('.md'))
        .map(dirent => dirent.name.replace(/\.md$/, ''));
    } catch {
      // Ignore
    }
  }

  // Read commands
  const commandsDir = join(pluginDir, 'commands');
  result.commands = findMarkdownFiles(commandsDir);

  // Read hooks
  const hooksPath = join(pluginDir, 'hooks', 'hooks.json');
  if (existsSync(hooksPath)) {
    try {
      const hooksContent = JSON.parse(readFileSync(hooksPath, 'utf-8'));
      // Count hooks across all event types
      for (const eventHooks of Object.values(hooksContent.hooks || {})) {
        if (Array.isArray(eventHooks)) {
          for (const hookGroup of eventHooks) {
            if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
              result.hooks += hookGroup.hooks.length;
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  // Read MCP servers
  const mcpPath = join(pluginDir, '.mcp.json');
  if (existsSync(mcpPath)) {
    try {
      const mcpContent = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      if (mcpContent.mcpServers) {
        result.mcpServers = Object.keys(mcpContent.mcpServers);
      }
    } catch {
      // Ignore
    }
  }

  // Read permissions
  const permissionsPath = join(pluginDir, 'permissions.json');
  if (existsSync(permissionsPath)) {
    try {
      const content = readFileSync(permissionsPath, 'utf-8');
      const pluginPerms: PluginPermissions = JSON.parse(content);
      result.permissions = pluginPerms.permissions.map(p => p.pattern);
    } catch {
      // Ignore
    }
  }

  return result;
}

/**
 * Execute a claude CLI command
 */
function runClaudeCommand(cli: string, args: string): { output: string; success: boolean } {
  try {
    const result = spawnSync(cli, args.split(' '), {
      encoding: 'utf-8',
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      output: result.stdout + result.stderr,
      success: result.status === 0,
    };
  } catch (err) {
    return {
      output: err.message,
      success: false,
    };
  }
}

/**
 * Setup permissions in settings.json
 * Only adds new permissions, does not remove existing ones
 * (User may have customized permissions that should be preserved)
 */
function setupPermissions(
  requiredPermissions: string[],
  error: (msg: string) => void,
): { added: string[]; existing: string[]; success: boolean } {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  try {
    // Read existing settings
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }

    // Ensure permissions.allow exists
    if (!settings.permissions) {
      settings.permissions = {};
    }
    const perms = settings.permissions as Record<string, unknown>;
    if (!perms.allow) {
      perms.allow = [];
    }

    const currentAllowList = perms.allow as string[];

    // Determine what to add
    const added: string[] = [];
    const existing: string[] = [];

    requiredPermissions.forEach(perm => {
      if (currentAllowList.includes(perm)) {
        existing.push(perm);
      } else {
        added.push(perm);
      }
    });

    // Add new permissions
    if (added.length > 0) {
      perms.allow = [...currentAllowList, ...added];
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    return { added, existing, success: true };
  } catch (err) {
    error(`Could not configure permissions: ${err.message}`);
    return { added: [], existing: [], success: false };
  }
}

/**
 * Install/update Claude Code Plugins
 */
const PluginsCommand: GluegunCommand = {
  alias: ['p'],
  description: 'Install Claude Code plugins',
  hidden: false,
  name: 'plugins',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      parameters,
      print: { error, info, spin, success, warning },
      system,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Fetch available plugins from GitHub
    let availablePlugins: PluginConfig[];
    try {
      availablePlugins = await fetchAvailablePlugins(spin);
    } catch (err) {
      error(`Failed to fetch plugins: ${err.message}`);
      info('');
      info('Check your internet connection or try again later.');
      return process.exit(1);
    }

    if (availablePlugins.length === 0) {
      error('No plugins found in the repository.');
      return process.exit(1);
    }

    // Get plugin names from parameters (if provided)
    const requestedPlugins = parameters.array?.filter((p): p is string => typeof p === 'string') || [];

    // Determine which plugins to install
    let pluginsToInstall: PluginConfig[];
    const notFoundPlugins: string[] = [];

    if (requestedPlugins.length > 0) {
      // Find specific plugins by name
      pluginsToInstall = [];

      for (const name of requestedPlugins) {
        const plugin = availablePlugins.find(p => p.pluginName === name);
        if (plugin) {
          pluginsToInstall.push(plugin);
        } else {
          notFoundPlugins.push(name);
        }
      }

      // Warn about not found plugins but continue with the rest
      if (notFoundPlugins.length > 0) {
        warning(`Plugin${notFoundPlugins.length > 1 ? 's' : ''} not found: ${notFoundPlugins.join(', ')}`);
      }

      // Check if there are any plugins to install
      if (pluginsToInstall.length === 0) {
        error('No valid plugins to install.');
        info('');
        info('Available plugins:');
        availablePlugins.forEach(p => {
          info(`  ${p.pluginName} - ${p.description}`);
        });
        return process.exit(1);
      }

      info(`Installing ${pluginsToInstall.length} plugin${pluginsToInstall.length > 1 ? 's' : ''}: ${pluginsToInstall.map(p => p.pluginName).join(', ')}`);
    } else {
      // Install all plugins from primary marketplace (lenne-tech) plus default external plugins
      const primaryMarketplace = MARKETPLACES[0].name;
      const primaryPlugins = availablePlugins.filter(p => p.marketplaceName === primaryMarketplace);

      // Add default external plugins
      const externalPlugins: PluginConfig[] = [];
      for (const defaultPlugin of DEFAULT_EXTERNAL_PLUGINS) {
        const plugin = availablePlugins.find(
          p => p.pluginName === defaultPlugin.pluginName && p.marketplaceName === defaultPlugin.marketplaceName
        );
        if (plugin) {
          externalPlugins.push(plugin);
        }
      }

      pluginsToInstall = [...primaryPlugins, ...externalPlugins];

      if (externalPlugins.length > 0) {
        info(`Installing ${primaryPlugins.length} plugins from ${primaryMarketplace}`);
        info(`  + ${externalPlugins.length} default plugins: ${externalPlugins.map(p => p.pluginName).join(', ')}`);
      } else {
        info(`Installing all plugins (${pluginsToInstall.length})...`);
      }
    }
    info('');

    // Check if claude CLI is available
    const cli = findClaudeCli();
    if (!cli) {
      error('Claude CLI not found. Please install Claude Code first.');
      info('');
      info('Installation: https://docs.anthropic.com/en/docs/claude-code');
      return process.exit(1);
    }

    // Prepare marketplaces (add and update cache once per marketplace)
    const preparedMarketplaces = prepareMarketplaces(pluginsToInstall, cli, toolbox);
    info('');

    // Install plugins (only from successfully prepared marketplaces)
    const results: Array<{ action: string; contents: PluginContents; plugin: PluginConfig; success: boolean }> = [];

    for (const plugin of pluginsToInstall) {
      // Skip plugins from marketplaces that failed to prepare
      if (!preparedMarketplaces.has(plugin.marketplaceName)) {
        results.push({
          action: 'failed',
          contents: EMPTY_PLUGIN_CONTENTS,
          plugin,
          success: false,
        });
        continue;
      }

      const result = await installPlugin(plugin, cli, toolbox);
      results.push({ ...result, plugin });

      if (pluginsToInstall.length > 1 && results.length < pluginsToInstall.length) {
        info(''); // Add spacing between plugins
      }
    }

    // Summary
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const totalIssues = failCount + notFoundPlugins.length;

    info('');
    if (totalIssues === 0) {
      success(`${successCount} plugin${successCount > 1 ? 's' : ''} processed in ${helper.msToMinutesAndSeconds(timer())}m.`);
    } else {
      warning(`${successCount} succeeded, ${totalIssues} issue${totalIssues > 1 ? 's' : ''} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    }

    // Print summaries for successful installations
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length > 0) {
      info('');
      info('Installed:');
      for (const result of successfulResults) {
        printPluginSummary(result.plugin.pluginName, result.contents, info);
      }
    }

    // Print failed installations
    const failedResults = results.filter(r => !r.success);
    if (failedResults.length > 0) {
      info('');
      warning('Failed to install:');
      for (const result of failedResults) {
        info(`  ${result.plugin.pluginName}`);
      }
    }

    // Print not found plugins
    if (notFoundPlugins.length > 0) {
      info('');
      warning('Not found:');
      for (const name of notFoundPlugins) {
        info(`  ${name}`);
      }
      info('');
      info('Available plugins:');
      availablePlugins.forEach(p => {
        info(`  ${p.pluginName} - ${p.description}`);
      });
    }

    if (successCount > 0) {
      info('');
      info('Next:');
      info('  Restart Claude Code to activate the plugins');
    }
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit(totalIssues > 0 ? 1 : 0);
    }

    return 'plugins installed';
  },
};

export default PluginsCommand;
