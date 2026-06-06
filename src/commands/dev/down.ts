import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { reloadCaddy, removeProjectBlock } from '../../lib/caddy';
import { clearEnvBridge } from '../../lib/dev-env-bridge';
import { buildIdentity } from '../../lib/dev-identity';
import { killProcessGroup } from '../../lib/dev-process';
import { resolveLayout } from '../../lib/dev-project';
import { clearSession, isPidAlive, loadSession } from '../../lib/dev-state';
import { hasTestSession, tearDownTestSession } from '../../lib/dev-test-session';

/**
 * Stop the processes started by `lt dev up` and remove the project's
 * Caddy block.
 *
 * - SIGTERM is sent to the detached process GROUP (negative PID) so
 *   children (Vite, Nest watcher) receive the signal too.
 * - The Caddy block is removed and `caddy reload` is invoked, so the
 *   subdomain stops resolving immediately.
 */
const DownCommand: GluegunCommand = {
  alias: ['d'],
  description: 'Stop API + App and remove Caddy block',
  hidden: false,
  name: 'down',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    const identity = buildIdentity(layout.root);
    const session = loadSession(layout.root);

    const stopped: string[] = [];
    if (session) {
      for (const [name, pid] of Object.entries(session.pids) as [string, number | undefined][]) {
        if (!pid) continue;
        if (!isPidAlive(pid)) {
          stopped.push(`${name} (pid ${pid}, already dead)`);
          continue;
        }
        if (killProcessGroup(pid)) stopped.push(`${name} (pid ${pid})`);
        else warning(`Failed to stop ${name} (pid ${pid})`);
      }
      clearSession(layout.root);
    } else {
      info(colors.dim('No running processes registered for this project.'));
    }

    // Remove Caddy block (best-effort — even if no session was active).
    const removed = removeProjectBlock(identity.slug);
    if (removed) {
      const r = await reloadCaddy();
      if (r.ok) success(`Removed Caddy block for "${identity.slug}".`);
      else warning(`Removed Caddy block but reload failed: ${r.stderr.split('\n')[0]}`);
    }

    // Clear ENV bridge so subsequent test runs without `lt dev up`
    // do not pick up stale URLs.
    if (clearEnvBridge(layout.root)) info(colors.dim('Removed .lt-dev/.env bridge.'));

    // Also tear down any isolated test stack (`lt dev test`) for this project,
    // so `lt dev down` always leaves a clean slate.
    if (hasTestSession(layout.root)) {
      const { stopped: testStopped } = await tearDownTestSession(layout, identity, {
        dim: colors.dim,
        info,
        warn: warning,
      });
      if (testStopped.length > 0) success(`Stopped test stack: ${testStopped.join(', ')}`);
    }

    if (stopped.length > 0) success(`Stopped: ${stopped.join(', ')}`);
    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev down: ${stopped.length} stopped`;
  },
};

module.exports = DownCommand;
