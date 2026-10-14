import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { CommandHelp } from '../../lib/command-help';
import {
  buildDirectusSyncArgs,
  DIRECTUS_SYNC_ACTIONS,
  isDirectusSyncAction,
  passthroughArgs,
  resolveDirectusCli,
} from '../../lib/directus-sync';
import { failRun } from '../../lib/fail-run';
import { spawnCmdSync } from '../../lib/platform';
import { isNonInteractive } from '../../lib/workspace-integration';

/**
 * Sync Directus schema and configuration via the official Directus CLI
 */
const NewCommand: GluegunCommand = {
  alias: ['s'],
  description: 'Sync schema between instances',
  hidden: false,
  name: 'sync',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      parameters,
      print: { error, info },
      prompt,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.directus?.sync,
      config: ltConfig,
    });
    const nonInteractive = isNonInteractive(noConfirm);

    // Determine the action: CLI > interactive
    let action: string | undefined = parameters.first;
    if (!action) {
      if (nonInteractive) {
        error(`Action is required: lt directus sync <${DIRECTUS_SYNC_ACTIONS.join('|')}>`);
        failRun(toolbox);
        return;
      }
      const response = await prompt.ask<{ action: string }>({
        choices: [...DIRECTUS_SYNC_ACTIONS],
        message: 'Which sync action?',
        name: 'action',
        type: 'select',
      });
      action = response.action;
    }

    if (!isDirectusSyncAction(action)) {
      error(`Unknown action "${action}". Use one of: ${DIRECTUS_SYNC_ACTIONS.join(', ')}`);
      failRun(toolbox);
      return;
    }

    // Forward the d6s options exactly as typed and apply the sync policy
    const plan = buildDirectusSyncArgs(action, passthroughArgs(process.argv.slice(2), action), nonInteractive);
    if ('error' in plan) {
      error(plan.error);
      failRun(toolbox);
      return;
    }

    const cli = resolveDirectusCli(process.cwd());
    info(`Running: d6s ${plan.args.join(' ')}`);
    const result = spawnCmdSync(cli.command, [...cli.args, ...plan.args], { stdio: 'inherit' });

    if (result.error || result.status !== 0) {
      error(`Directus CLI failed${result.error ? `: ${result.error.message}` : ` (exit code ${result.status})`}`);
      failRun(toolbox);
      return;
    }

    // Exit if not running from menu
    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `directus sync ${action} completed`;
  },
};

export const help: CommandHelp = {
  aliases: ['s'],
  configuration: 'commands.directus.sync.noConfirm, defaults.noConfirm',
  description:
    'Pull, diff or push Directus schema and configuration (roles, policies, permissions, flows, dashboards, translations, settings) through JSON files in the repo. Wraps the official @directus/cli (d6s) and forwards every d6s option unchanged.',
  examples: [
    'directus sync pull --from dev',
    'directus sync diff --to staging',
    'directus sync push --to production',
    'directus sync push --to production --noConfirm',
  ],
  features: [
    'Uses a local or global d6s, otherwise runs @directus/cli via npx.',
    'diff and push default to --mode merge (never deletes).',
    'Non-interactive pushes refuse --mode mirror and --dangerously-allow-delete.',
    'Tokens come from DIRECTUS_<PROFILE>_TOKEN or the d6s credential store, never from lt.',
  ],
  name: 'sync',
  options: [
    { description: 'Source profile for pull (d6s option)', flag: '--from', type: 'string' },
    { description: 'Target profile for diff and push (d6s option)', flag: '--to', type: 'string' },
    {
      default: 'merge',
      description: 'Sync mode for diff and push (d6s option). mirror only in interactive runs.',
      flag: '--mode',
      type: 'string',
      values: ['add', 'merge', 'mirror'],
    },
    { description: 'Skip prompts; runs d6s non-interactively', flag: '--noConfirm', type: 'boolean' },
  ],
};

module.exports = Object.assign(NewCommand, { help });
