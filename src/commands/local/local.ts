import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Local development orchestration commands (`lt local <subcommand>`).
 *
 * Subcommands:
 * - `init`   — register a port slot for this project
 * - `up`     — start API + App with project-specific ports
 * - `down`   — stop processes started by `up`
 * - `status` — show what is running
 */
module.exports = {
  alias: ['l'],
  description: 'Local dev orchestration',
  hidden: false,
  name: 'local',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('local');
    return 'local';
  },
};
