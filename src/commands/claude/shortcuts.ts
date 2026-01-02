import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import {
  addAliasBlockToShellConfig,
  checkAliasInFile,
  getPreferredShellConfig,
  ShellAlias,
} from '../../lib/shell-config';

/**
 * Claude Code shortcuts (shell aliases)
 * See: https://docs.lennetech.app/claude-code/installation
 */
const CLAUDE_SHORTCUTS: ShellAlias[] = [
  {
    alias: 'c',
    command: 'claude --dangerously-skip-permissions',
    description: 'Start new Claude Code session',
  },
  {
    alias: 'cc',
    command: 'claude --dangerously-skip-permissions --continue',
    description: 'Continue last session',
  },
  {
    alias: 'cr',
    command: 'claude --dangerously-skip-permissions --resume',
    description: 'Select and resume previous session',
  },
];

/**
 * Install Claude Code shell shortcuts
 */
const ShortcutsCommand: GluegunCommand = {
  alias: ['s'],
  description: 'Install shell shortcuts',
  name: 'shortcuts',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      print: { error, info, success },
    } = toolbox;

    // Get preferred shell config
    const shellConfig = getPreferredShellConfig();

    if (!shellConfig) {
      error('Could not detect shell configuration file.');
      info('Supported shells: zsh, bash');

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit(1);
      }
      return 'shortcuts: no shell config found';
    }

    info(`Shell: ${shellConfig.shell}`);
    info(`Config: ${shellConfig.path}`);
    info('');

    // Check which shortcuts are already installed
    const existingAliases: ShellAlias[] = [];
    const missingAliases: ShellAlias[] = [];

    for (const shortcut of CLAUDE_SHORTCUTS) {
      if (checkAliasInFile(shellConfig.path, shortcut.alias)) {
        existingAliases.push(shortcut);
      } else {
        missingAliases.push(shortcut);
      }
    }

    // Show status
    if (existingAliases.length > 0) {
      info('Already installed:');
      for (const { alias, description } of existingAliases) {
        info(`  ${alias} - ${description}`);
      }
      info('');
    }

    if (missingAliases.length === 0) {
      success('All Claude Code shortcuts are already installed!');
      info('');
      info('Available shortcuts:');
      for (const { alias, command, description } of CLAUDE_SHORTCUTS) {
        info(`  ${alias} - ${description}`);
        info(`      ${command}`);
      }

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit(0);
      }
      return 'shortcuts: already installed';
    }

    // Add missing aliases
    const added = addAliasBlockToShellConfig(shellConfig.path, missingAliases);

    if (added) {
      info('');
      success(`Added ${missingAliases.length} shortcut${missingAliases.length > 1 ? 's' : ''} to ${shellConfig.path}`);
      info('');
      info(`Run: source ${shellConfig.path}`);
      info('Or restart your terminal to apply changes.');
    } else {
      error(`Failed to write to ${shellConfig.path}`);
      info('');
      info('To add manually, add these lines to your shell config:');
      info('');
      for (const { alias, command } of missingAliases) {
        info(`alias ${alias}='${command}'`);
      }

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit(1);
      }
      return 'shortcuts: write failed';
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit(0);
    }
    return `shortcuts: ${missingAliases.length} added`;
  },
};

export default ShortcutsCommand;
