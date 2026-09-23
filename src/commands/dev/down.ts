import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { detectCaddyOwner, foreignCaddyLines, reloadCaddy, removeProjectBlock } from '../../lib/caddy';
import { clearEnvBridge } from '../../lib/dev-env-bridge';
import { killProcessGroup, planTermination } from '../../lib/dev-process';
import { resolveLayout } from '../../lib/dev-project';
import { clearSession, detectSlugConflict, isPidAlive, loadSession } from '../../lib/dev-state';
import { hasTestSession, tearDownTestSession } from '../../lib/dev-test-session';
import { resolveDevIdentity } from '../../lib/dev-ticket';
import { isWindows } from '../../lib/platform';

/**
 * Stop the processes started by `lt dev up` and remove the project's
 * Caddy block.
 *
 * - POSIX: SIGTERM to the detached process GROUP (negative PID), so children
 *   (Vite, Nest watcher) receive it too and can shut down gracefully. No
 *   escalation — `down` is the polite stop.
 * - Windows: `taskkill /T /F`, i.e. FORCED, while `up`'s reclaim keeps the
 *   two-phase `terminateProcessGroup`. Not a choice: Windows has no gentle step
 *   (`/T` without `/F` was measured to leave the tree and its port alive), so
 *   shutdown hooks do not run there. Details in `killWindowsTree`.
 * - Either way the pid is verified gone afterwards; a survivor is reported,
 *   never listed as stopped.
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
        // A pid the plan refuses (1, this CLI, a system pid — i.e. a corrupted
        // state.json) is neither signalled nor offered as a copy-paste kill hint:
        // `kill -9 -1` is the broadcast that rebooted a Mac on 2026-09-23.
        const plan = planTermination(pid);
        if (plan.kind === 'refuse') {
          warning(`Not stopping ${name}: ${plan.reason} — .lt-dev/state.json looks corrupted.`);
          continue;
        }
        killProcessGroup(pid);
        // Verify rather than assume: `killProcessGroup` reports that the signal
        // was delivered, not that the process went. A compiled API with shutdown
        // hooks can sit on SIGTERM while it waits for Mongo; claiming "stopped"
        // then sends the user into the next `lt dev up` with a port collision
        // nobody can trace back.
        if (await waitForExit(pid, 3000)) {
          stopped.push(`${name} (pid ${pid})`);
        } else {
          warning(`${name} (pid ${pid}) did not stop — it may still hold its port.`);
          info(colors.dim(`  Check with \`lt dev status\`; force it with ${forceKillHint(pid)}`));
        }
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
      // Ownership first: it is proven by comparing the loaded config with the
      // Caddyfile, so it must be asked before the file changes.
      const owner = await detectCaddyOwner();
      const removed = removeProjectBlock(identity.slug);
      if (removed && owner === 'ours') {
        const r = await reloadCaddy();
        if (r.ok) success(`Removed Caddy block for "${identity.slug}".`);
        else warning(`Removed Caddy block but reload failed: ${r.stderr.split('\n')[0]}`);
      } else if (removed && owner === 'foreign') {
        warning(`Removed the block for "${identity.slug}" from lt dev's Caddyfile, but did not reload:`);
        foreignCaddyLines().forEach((l) => info(`  ${l}`));
      } else if (removed) {
        info(colors.dim(`Removed Caddy block for "${identity.slug}" (Caddy not running; nothing to reload).`));
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

/** The command that actually ends a process tree on this platform. */
function forceKillHint(pid: number): string {
  // `/F` is not optional on Windows: measured, `taskkill /PID <pid> /T` without it
  // fails on the children and leaves the port bound.
  return isWindows() ? `\`taskkill /PID ${pid} /T /F\`` : `\`kill -9 -${pid}\``;
}

/** Poll until `pid` is gone, or the budget runs out. */
async function waitForExit(pid: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isPidAlive(pid);
}
