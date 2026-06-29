import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import {
  addAliasBlockToShellConfig,
  checkAliasInFile,
  getPreferredShellConfig,
  ShellAlias,
} from '../../lib/shell-config';

const CODEX_SHORTCUTS: ShellAlias[] = [
  {
    alias: 'x',
    command: 'codex --sandbox workspace-write --ask-for-approval on-request',
    description: 'Start new Codex session',
  },
  {
    alias: 'xr',
    command: 'codex resume',
    description: 'Select and resume previous Codex session',
  },
  {
    alias: 'xf',
    command: 'LT_PLUGIN_HOOKS_SKIP=1 codex --sandbox workspace-write --ask-for-approval on-request',
    description: 'Start Codex in fast mode (skip lenne.tech plugin detect hooks)',
  },
  {
    alias: 'xp',
    command: 'lt codex plugins',
    description: 'Install/update lenne.tech Codex plugin setup',
  },
];

const ShortcutsCommand: GluegunCommand = {
  alias: ['s'],
  description: 'Install Codex shell shortcuts',
  name: 'shortcuts',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      print: { error, info, success },
    } = toolbox;

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

    const existingAliases: ShellAlias[] = [];
    const missingAliases: ShellAlias[] = [];

    for (const shortcut of CODEX_SHORTCUTS) {
      if (checkAliasInFile(shellConfig.path, shortcut.alias)) {
        existingAliases.push(shortcut);
      } else {
        missingAliases.push(shortcut);
      }
    }

    if (existingAliases.length > 0) {
      info('Already installed:');
      for (const { alias, description } of existingAliases) {
        info(`  ${alias} - ${description}`);
      }
      info('');
    }

    if (missingAliases.length === 0) {
      success('All Codex shortcuts are already installed!');
      info('');
      info('Available shortcuts:');
      for (const { alias, command, description } of CODEX_SHORTCUTS) {
        info(`  ${alias} - ${description}`);
        info(`      ${command}`);
      }

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit(0);
      }
      return 'shortcuts: already installed';
    }

    const added = addAliasBlockToShellConfig(
      shellConfig.path,
      missingAliases,
      'Codex shortcuts - Added by lenne.tech CLI',
    );

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
