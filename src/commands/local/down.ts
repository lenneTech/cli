import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { resolveLayout } from '../../lib/local-project';
import { clearLocalState, isPidAlive, isValidPid, loadLocalState } from '../../lib/port-registry';

/**
 * Stop processes started by `lt local up`. Sends SIGTERM to the
 * detached process group (negative PID) so descendants — Vite,
 * the Nest watcher etc. — receive the signal too.
 */
const DownCommand: GluegunCommand = {
  alias: ['d'],
  description: 'Stop API + App',
  hidden: false,
  name: 'down',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    const state = loadLocalState(layout.root);
    if (!state || (!state.pids.api && !state.pids.app)) {
      info(colors.dim('No running processes registered for this project.'));
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'local down: nothing to stop';
    }

    const stopped: string[] = [];
    for (const [name, pid] of Object.entries(state.pids) as [string, number | undefined][]) {
      if (!pid) continue;

      // Defense-in-depth: refuse anything that loadLocalState's schema gate
      // wouldn't have accepted. Prevents a tampered state.json from causing
      // process.kill(-pid, …) to signal arbitrary process groups.
      if (!isValidPid(pid)) {
        warning(`Refusing to signal suspicious pid ${pid} for ${name} (state.json tampered?)`);
        continue;
      }

      if (!isPidAlive(pid)) {
        stopped.push(`${name} (pid ${pid}, already dead)`);
        continue;
      }
      try {
        // Negative PID kills the process group of a detached process.
        process.kill(-pid, 'SIGTERM');
        stopped.push(`${name} (pid ${pid})`);
      } catch {
        try {
          process.kill(pid, 'SIGTERM');
          stopped.push(`${name} (pid ${pid}, single)`);
        } catch {
          warning(`Failed to stop ${name} (pid ${pid})`);
        }
      }
    }

    clearLocalState(layout.root);
    success(`Stopped: ${stopped.join(', ')}`);
    if (!parameters.options.fromGluegunMenu) process.exit();
    return `local down: ${stopped.length} stopped`;
  },
};

module.exports = DownCommand;
