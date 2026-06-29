import { existsSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { DEFAULT_CODEX_MARKETPLACE_ROOT, findCodexCli, runCodexCommand } from '../../lib/codex-cli';
import {
  installCodexAgents,
  installCodexPrompts,
  readCodexMarketplaceName,
  readLocalCodexPluginContents,
} from '../../lib/codex-plugin-utils';

const CODEX_PLUGIN_NAME = 'lt-dev';

/**
 * Install/update lenne.tech Codex plugin, custom agents, and prompt wrappers.
 */
const PluginsCommand: GluegunCommand = {
  alias: ['p'],
  description: 'Install Codex plugins',
  name: 'plugins',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      print: { error, info, spin, success, warning },
      system,
    } = toolbox;

    const timer = system.startTimer();
    const marketplaceRoot = String(toolbox.parameters.options.path || DEFAULT_CODEX_MARKETPLACE_ROOT);
    const pluginRoot = join(marketplaceRoot, 'plugins', CODEX_PLUGIN_NAME);
    const marketplaceName = readCodexMarketplaceName(marketplaceRoot);

    if (!marketplaceName) {
      error(`Codex marketplace not found at ${marketplaceRoot}`);
      info('');
      info('Expected: .agents/plugins/marketplace.json');
      info(
        'Run this from a checkout that contains the generated codex marketplace, or pass --path=<marketplace-root>.',
      );
      process.exit(1);
    }

    if (!existsSync(pluginRoot)) {
      error(`Codex plugin not found: ${pluginRoot}`);
      process.exit(1);
    }

    const cli = findCodexCli();
    if (!cli) {
      error('Codex CLI not found. Please install Codex first.');
      info('');
      info('Installation: https://developers.openai.com/codex');
      process.exit(1);
    }

    const listSpinner = spin('Checking Codex marketplaces');
    const listResult = runCodexCommand(cli, ['plugin', 'marketplace', 'list', '--json']);
    const marketplaceConfigured =
      listResult.success &&
      (listResult.output.includes(`"name": "${marketplaceName}"`) || listResult.output.includes(marketplaceRoot));

    if (marketplaceConfigured) {
      listSpinner.succeed(`Marketplace ${marketplaceName} already configured`);
    } else {
      listSpinner.text = `Adding marketplace ${marketplaceName}`;
      const addResult = runCodexCommand(cli, ['plugin', 'marketplace', 'add', marketplaceRoot, '--json']);
      if (addResult.success || addResult.output.includes('already')) {
        listSpinner.succeed(`Marketplace ${marketplaceName} added`);
      } else {
        listSpinner.fail(`Failed to add marketplace ${marketplaceName}`);
        error(addResult.output);
        process.exit(1);
      }
    }

    const installSpinner = spin(`Installing/updating ${CODEX_PLUGIN_NAME}`);
    const installResult = runCodexCommand(cli, ['plugin', 'add', `${CODEX_PLUGIN_NAME}@${marketplaceName}`, '--json']);
    if (installResult.success || installResult.output.includes('already')) {
      installSpinner.succeed(`${CODEX_PLUGIN_NAME} installed`);
    } else {
      installSpinner.fail(`Failed to install ${CODEX_PLUGIN_NAME}`);
      error(installResult.output);
      process.exit(1);
    }

    const agentSpinner = spin('Installing Codex custom agents');
    const agentCount = installCodexAgents(pluginRoot);
    agentSpinner.succeed(`${agentCount} custom agents installed`);

    const promptSpinner = spin('Installing Codex prompt wrappers');
    const promptCount = installCodexPrompts(pluginRoot);
    promptSpinner.succeed(`${promptCount} prompt wrappers installed`);

    const contents = readLocalCodexPluginContents(pluginRoot);

    info('');
    success(`Codex setup completed in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');
    info('Installed:');
    info(`  Plugin: ${CODEX_PLUGIN_NAME}@${marketplaceName}`);
    info(`  Skills (${contents.skills.length}): ${contents.skills.join(', ')}`);
    info(`  MCP Servers (${contents.mcpServers.length}): ${contents.mcpServers.join(', ')}`);
    info(`  Hooks: ${contents.hooks}`);
    info(`  Custom agents: ${agentCount}`);
    info(`  Prompt wrappers: ${promptCount}`);
    info('');
    warning('Restart Codex or start a new thread so new skills, agents, prompts, and MCP tools are loaded.');
    info('Use former lt-dev commands via /prompts:lt-dev-... or by asking Codex to use the lt-dev command router.');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit(0);
    }
    return 'codex plugins installed';
  },
};

export default PluginsCommand;
