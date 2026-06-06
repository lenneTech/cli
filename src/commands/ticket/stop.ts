import { realpathSync } from 'fs';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { buildIdentity } from '../../lib/dev-identity';
import { runChildInherit } from '../../lib/dev-process';
import { deriveDbName, deriveTestDbName, deriveTicketDbName, resolveLayout } from '../../lib/dev-project';
import { loadRegistry, saveRegistry } from '../../lib/dev-state';
import {
  dropDatabase,
  gitMainRepoRoot,
  listWorktrees,
  readTicketMarker,
  worktreeDirtyOnlyGenerated,
  worktreeRemove,
  worktreeSafetyReport,
} from '../../lib/dev-ticket';

/**
 * `lt ticket stop [<id>]` — tear a ticket env down + remove its worktree.
 *
 *   1. `lt dev down` inside the worktree (stops the ticket stack + any test
 *      stacks, removes the Caddy block — residue-free),
 *   2. `git worktree remove` (the BRANCH is kept, so nothing is lost),
 *   3. `--drop-db` also drops the ticket's empty dev + test databases.
 *
 * Run with NO id from INSIDE a ticket worktree to clean up THIS environment
 * (the current folder is removed; the process steps out to the main repo first).
 */
const StopCommand: GluegunCommand = {
  alias: ['rm'],
  description: 'Stop a ticket env + remove its worktree (branch kept); no id = the current worktree',
  name: 'stop',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    let mainRepoRoot: string;
    try {
      mainRepoRoot = gitMainRepoRoot(layout.root);
    } catch {
      error('Not inside a git repository.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: not a git repo';
    }

    // Id from the argument — or, when invoked with NO id from INSIDE a ticket
    // worktree, the current worktree's own ticket (so a bare `lt ticket stop`
    // cleans up "this" environment and removes this very folder).
    const fromMarker = parameters.first == null ? readTicketMarker(layout.root) : null;
    const id = String(parameters.first ?? fromMarker ?? '').trim();
    if (!id) {
      error('Usage: lt ticket stop <id> [--drop-db] [--force]  — or run with no id from INSIDE a ticket worktree.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: missing id';
    }

    const wt = listWorktrees(mainRepoRoot).find((w) => w.ticket === id);
    if (!wt) {
      error(`No ticket worktree "${id}" found. See \`lt ticket list\`.`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: not found';
    }

    // SAFETY: never silently delete unsaved work. Warn + REFUSE (unless --force)
    // when the worktree has uncommitted changes OR unpushed commits, so the user
    // commits + pushes first. (`--force` removes anyway; the branch is kept, so
    // committed history survives regardless.)
    const safety = worktreeSafetyReport(wt.path);
    if ((safety.dirtySource.length > 0 || safety.unpushed > 0) && parameters.options.force !== true) {
      warning('');
      warning(`Refusing to remove ticket "${id}" — work is not fully committed + pushed:`);
      if (safety.dirtySource.length > 0) {
        warning(`  • ${safety.dirtySource.length} uncommitted change(s) — would be LOST on removal:`);
        safety.dirtySource.slice(0, 12).forEach((l) => info(colors.dim(`      ${l}`)));
        if (safety.dirtySource.length > 12) info(colors.dim(`      … and ${safety.dirtySource.length - 12} more`));
      }
      if (safety.unpushed > 0) {
        warning(`  • ${safety.unpushed} commit(s) on "${wt.branch ?? '-'}" not pushed to any remote`);
      }
      info('');
      info(colors.dim('  Commit + push first (the branch is kept), or re-run with --force to remove anyway.'));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: unsaved work (use --force)';
    }

    // If we are removing the worktree we are standing in, step the process out
    // to the main repo first so git can remove the folder cleanly.
    const removingCwd = fromMarker !== null || samePath(wt.path, layout.root);
    if (removingCwd) {
      try {
        process.chdir(mainRepoRoot);
      } catch {
        /* best-effort */
      }
    }

    info('');
    info(colors.bold(`Stopping ticket "${id}"`));

    // 1. Tear the isolated stack down from inside the worktree (marker-aware).
    info(colors.dim('  lt dev down …'));
    await runChildInherit(process.execPath, [process.argv[1], 'dev', 'down'], { cwd: wt.path, env: process.env });

    // 2. Optionally drop the ticket databases (they are otherwise just left empty).
    if (parameters.options.dropDb === true || parameters.options['drop-db'] === true) {
      const base = buildIdentity(mainRepoRoot);
      const entry = loadRegistry().projects[`${base.slug}-${id}`];
      const mainLayout = resolveLayout(mainRepoRoot, filesystem);
      const devDb = entry?.dbName ?? deriveTicketDbName(deriveDbName(mainLayout.apiDir, base.slug), id);
      const testDb = deriveTestDbName(devDb);
      for (const db of [devDb, testDb]) {
        if (dropDatabase(db)) info(colors.dim(`  dropped db ${db}`));
        else warning(`  could not drop db ${db} (mongosh missing or DB not reachable) — drop it manually if needed.`);
      }
    }

    // 3. Remove the worktree (branch is kept). Auto-force when the ONLY dirty
    //    files are framework-generated (e.g. `nuxt dev` rewrites the tracked
    //    `.nuxtrc` on boot), which would otherwise block the remove — but NEVER
    //    discard real source edits (those keep the non-forced remove, which
    //    errors with a hint so unsaved work is never lost).
    const force = parameters.options.force === true || worktreeDirtyOnlyGenerated(wt.path);
    if (force && parameters.options.force !== true) {
      info(colors.dim('  (worktree had only generated files dirty, e.g. .nuxtrc — removing)'));
    }
    try {
      worktreeRemove(mainRepoRoot, wt.path, force);
    } catch (e) {
      error(`git worktree remove failed: ${(e as Error).message}`);
      info(
        colors.dim('  The worktree has uncommitted SOURCE changes — commit/stash them, or pass --force to discard.'),
      );
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: worktree remove failed';
    }

    // The whole env is gone now — drop the ticket's registry entry so its slug +
    // reserved ports are reclaimed (`lt dev down` only ends the session, keeping
    // the entry for a restart; `lt ticket stop` removes the env entirely).
    {
      const reg = loadRegistry();
      const ticketSlug = `${buildIdentity(mainRepoRoot).slug}-${id}`;
      if (reg.projects[ticketSlug]) {
        delete reg.projects[ticketSlug];
        saveRegistry(reg);
      }
    }

    info('');
    success(`Ticket "${id}" stopped — worktree removed, branch "${wt.branch ?? '-'}" kept.`);
    if (removingCwd) info(colors.dim(`  This folder is gone — your shell is still in it. Run: cd ${mainRepoRoot}`));
    if (!parameters.options.fromGluegunMenu) process.exit();
    return `ticket stop: ${id}`;
  },
};

/** True if two paths point at the same location (resolving symlinks, e.g. /tmp → /private/tmp). */
function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

module.exports = StopCommand;
