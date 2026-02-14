import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { checkMarketplaceExists, findClaudeCli, runClaudeCommand } from '../../lib/claude-cli';
import {
  DEFAULT_EXTERNAL_PLUGINS,
  fetchAvailablePlugins,
  MARKETPLACES,
  PluginConfig,
  printAvailablePlugins,
} from '../../lib/marketplace';
import {
  EMPTY_PLUGIN_CONTENTS,
  handleMissingEnvVars,
  PluginContents,
  PluginEnvVar,
  PostInstallResult,
  printPluginSummary,
  processPostInstall,
  readPluginContents,
  setupPermissions,
} from '../../lib/plugin-utils';
import { getPreferredShellConfig } from '../../lib/shell-config';

/**
 * Install a single plugin (marketplace must already be added and updated)
 */
async function installPlugin(
  plugin: PluginConfig,
  cli: string,
  toolbox: ExtendedGluegunToolbox,
): Promise<{ action: string; contents: PluginContents; postInstall: null | PostInstallResult; success: boolean }> {
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

  if (
    installResult.success ||
    installResult.output.includes('already') ||
    installResult.output.includes('up to date')
  ) {
    pluginSpinner.succeed(`${plugin.pluginName} ${pluginAction}`);
  } else {
    pluginSpinner.fail(`Failed to install ${plugin.pluginName}`);
    error(installResult.output);
    info('');
    info('Manual installation:');
    info(`  /plugin marketplace add ${plugin.marketplaceRepo}`);
    info(`  /plugin install ${fullPluginName}`);
    return { action: 'failed', contents: EMPTY_PLUGIN_CONTENTS, postInstall: null, success: false };
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

  // Step 4: Process post-installation requirements (for LSP plugins, etc.)
  const postInstallResult = processPostInstall(plugin.pluginName, toolbox);

  return { action: pluginAction, contents: pluginContents, postInstall: postInstallResult, success: true };
}

/**
 * Prepare marketplaces (add and update cache) for a list of plugins
 * Returns the set of successfully prepared marketplace names
 */
function prepareMarketplaces(plugins: PluginConfig[], cli: string, toolbox: ExtendedGluegunToolbox): Set<string> {
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
    // Check if marketplace already exists
    const marketplaceExists = checkMarketplaceExists(marketplaceName);

    // Add marketplace only if it doesn't exist yet
    if (!marketplaceExists) {
      const addSpinner = spin(`Adding marketplace ${marketplaceName}`);
      const addResult = runClaudeCommand(cli, `plugin marketplace add ${plugin.marketplaceRepo}`);

      if (addResult.success || addResult.output.includes('already')) {
        addSpinner.succeed(`Marketplace ${marketplaceName} added`);
      } else {
        addSpinner.fail(`Failed to add marketplace ${marketplaceName}`);
        error(addResult.output);
        continue;
      }
    }

    // Always update marketplace cache to get latest plugin versions
    const updateSpinner = spin(`Updating ${marketplaceName} cache`);
    const updateResult = runClaudeCommand(cli, `plugin marketplace update ${marketplaceName}`);

    if (updateResult.success) {
      updateSpinner.succeed(`${marketplaceName} cache updated`);
    } else {
      updateSpinner.stopAndPersist({
        symbol: '⚠',
        text: `Could not update ${marketplaceName} cache, using cached version`,
      });
    }

    preparedMarketplaces.add(marketplaceName);
  }

  return preparedMarketplaces;
}

/**
 * Install/update Claude Code Plugins
 */
const PluginsCommand: GluegunCommand = {
  alias: ['p'],
  description: 'Install Claude Code plugins',
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

    // Check if claude CLI is available (before network requests)
    const cli = findClaudeCli();
    if (!cli) {
      error('Claude CLI not found. Please install Claude Code first.');
      info('');
      info('Installation: https://docs.anthropic.com/en/docs/claude-code');
      process.exit(1);
    }

    // Fetch available plugins from GitHub
    let availablePlugins: PluginConfig[];
    try {
      availablePlugins = await fetchAvailablePlugins(spin);
    } catch (err) {
      error(`Failed to fetch plugins: ${(err as Error).message}`);
      info('');
      info('Check your internet connection or try again later.');
      process.exit(1);
    }

    if (availablePlugins.length === 0) {
      error('No plugins found in the repository.');
      process.exit(1);
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
        const plugin = availablePlugins.find((p) => p.pluginName === name);
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
        printAvailablePlugins(availablePlugins, info);
        process.exit(1);
      }

      info(
        `Installing ${pluginsToInstall.length} plugin${pluginsToInstall.length > 1 ? 's' : ''}: ${pluginsToInstall.map((p) => p.pluginName).join(', ')}`,
      );
    } else {
      // Install all plugins from primary marketplace (lenne-tech) plus default external plugins
      const primaryMarketplace = MARKETPLACES[0].name;
      const primaryPlugins = availablePlugins.filter((p) => p.marketplaceName === primaryMarketplace);

      // Add default external plugins
      const externalPlugins: PluginConfig[] = [];
      for (const defaultPlugin of DEFAULT_EXTERNAL_PLUGINS) {
        const plugin = availablePlugins.find(
          (p) => p.pluginName === defaultPlugin.pluginName && p.marketplaceName === defaultPlugin.marketplaceName,
        );
        if (plugin) {
          externalPlugins.push(plugin);
        }
      }

      pluginsToInstall = [...primaryPlugins, ...externalPlugins];

      if (externalPlugins.length > 0) {
        info(`Installing ${primaryPlugins.length} plugins from ${primaryMarketplace}`);
        info(`  + ${externalPlugins.length} default plugins: ${externalPlugins.map((p) => p.pluginName).join(', ')}`);
      } else {
        info(`Installing all plugins (${pluginsToInstall.length})...`);
      }
    }
    info('');

    // Prepare marketplaces (add and update cache once per marketplace)
    const preparedMarketplaces = prepareMarketplaces(pluginsToInstall, cli, toolbox);
    info('');

    // Install plugins (only from successfully prepared marketplaces)
    const results: Array<{
      action: string;
      contents: PluginContents;
      plugin: PluginConfig;
      postInstall: null | PostInstallResult;
      success: boolean;
    }> = [];

    for (const plugin of pluginsToInstall) {
      // Skip plugins from marketplaces that failed to prepare
      if (!preparedMarketplaces.has(plugin.marketplaceName)) {
        results.push({
          action: 'failed',
          contents: EMPTY_PLUGIN_CONTENTS,
          plugin,
          postInstall: null,
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
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    const totalIssues = failCount + notFoundPlugins.length;

    info('');
    if (totalIssues === 0) {
      success(
        `${successCount} plugin${successCount > 1 ? 's' : ''} processed in ${helper.msToMinutesAndSeconds(timer())}m.`,
      );
    } else {
      warning(
        `${successCount} succeeded, ${totalIssues} issue${totalIssues > 1 ? 's' : ''} in ${helper.msToMinutesAndSeconds(timer())}m.`,
      );
    }

    // Print summaries for successful installations
    const successfulResults = results.filter((r) => r.success);
    if (successfulResults.length > 0) {
      info('');
      info('Installed:');
      for (const result of successfulResults) {
        printPluginSummary(result.plugin.pluginName, result.contents, info);
      }
    }

    // Print failed installations
    const failedResults = results.filter((r) => !r.success);
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
      printAvailablePlugins(availablePlugins, info);
    }

    // Collect missing environment variables from all successful installations
    const allMissingEnvVars = new Map<string, PluginEnvVar>();
    for (const result of successfulResults) {
      if (result.postInstall?.envVarsMissing) {
        for (const envVar of result.postInstall.envVarsMissing) {
          if (!allMissingEnvVars.has(envVar.name)) {
            allMissingEnvVars.set(envVar.name, envVar);
          }
        }
      }
    }

    // Handle missing environment variables
    const envVarsResult = await handleMissingEnvVars(allMissingEnvVars, toolbox);

    // Show next steps
    if (successCount > 0) {
      info('');
      info('Next:');
      if (envVarsResult.needed && !envVarsResult.configured) {
        info('  1. Set required environment variables (see above)');
        info('  2. Restart Claude Code to activate the plugins');
      } else if (envVarsResult.configured || allMissingEnvVars.size > 0) {
        const shellConfig = getPreferredShellConfig();
        const sourceCmd = shellConfig ? `source ${shellConfig.path}` : 'source your shell config';
        info(`  1. Restart your terminal or run: ${sourceCmd}`);
        info('  2. Restart Claude Code to activate the plugins');
      } else {
        info('  Restart Claude Code to activate the plugins');
      }
    }
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit(totalIssues > 0 ? 1 : 0);
    }

    return `${successCount} plugin${successCount !== 1 ? 's' : ''} installed${totalIssues > 0 ? `, ${totalIssues} failed` : ''}`;
  },
};

export default PluginsCommand;
