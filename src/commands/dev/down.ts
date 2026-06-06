import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { reloadCaddy, removeProjectBlock } from '../../lib/caddy';
import { clearEnvBridge } from '../../lib/dev-env-bridge';
import { killProcessGroup } from '../../lib/dev-process';
import { resolveLayout } from '../../lib/dev-project';
import { clearSession, detectSlugConflict, isPidAlive, loadSession } from '../../lib/dev-state';
import { hasTestSession, tearDownTestSession } from '../../lib/dev-test-session';
import { resolveDevIdentity } from '../../lib/dev-ticket';

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
    // Ticket-aware: in a ticket worktree the slug / Caddy block / test stack are
    // suffixed (`<slug>-<id>`), so resolve the same identity `up` used.
    const { identity } = resolveDevIdentity(layout, { ticket: parameters.options.ticket });
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

    // Don't clobber another checkout: when this slug is registered to a DIFFERENT
    // checkout (two clones of the same project share a package.json "name" → slug),
    // the Caddy block + registration belong to IT — stop only OUR processes
    // (above) and leave its routing intact. Otherwise remove the block as usual.
    const conflict = detectSlugConflict(identity.slug, layout.root);
    if (conflict) {
      warning(
        `Slug "${identity.slug}" is registered to another checkout — leaving its Caddy block + registration untouched:`,
      );
      info(colors.dim(`  ${conflict.otherPath}`));
    } else {
      const removed = removeProjectBlock(identity.slug);
      if (removed) {
        const r = await reloadCaddy();
        if (r.ok) success(`Removed Caddy block for "${identity.slug}".`);
        else warning(`Removed Caddy block but reload failed: ${r.stderr.split('\n')[0]}`);
      }
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
