import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { buildIdentity } from '../../lib/dev-identity';
import { runChildInherit } from '../../lib/dev-process';
import { deriveDbName, resolveLayout } from '../../lib/dev-project';
import { loadRegistry, sameRealPath, saveRegistry } from '../../lib/dev-state';
import {
  dropDatabases,
  gitMainRepoRoot,
  keepDbFlag,
  listDatabaseNames,
  listWorktrees,
  planTicketDbDrop,
  readTicketMarker,
  worktreeDirtyOnlyAutoDiscardable,
  worktreeRemove,
  worktreeSafetyReport,
} from '../../lib/dev-ticket';
import { isNonInteractive } from '../../lib/workspace-integration';

/**
 * `lt ticket stop [<id>]` — tear a ticket env down + remove its worktree.
 *
 *   1. `lt dev down` inside the worktree (stops the ticket stack + any test
 *      stacks, removes the Caddy block — residue-free),
 *   2. `git worktree remove` (the BRANCH is kept, so nothing is lost),
 *   3. drops the ticket's dev + test databases (`--keep-db` opts out).
 *
 * The env is gone entirely afterwards — worktree AND registry entry — so the
 * databases would be orphans: nothing references them, nothing lists them, and
 * nothing reuses them. They are therefore dropped by default; keeping them was
 * how machines ended up with hundreds of dead databases from deleted tickets.
 *
 * ORDER MATTERS: the drop is irreversible and `git worktree remove` can fail
 * (locked worktree, modified submodule, permissions). Dropping first would leave
 * the user with a surviving env whose data is gone — while the error message
 * tells them to commit and retry. So the fallible step runs first and the
 * irreversible one only after it succeeded.
 *
 * Run with NO id from INSIDE a ticket worktree to clean up THIS environment
 * (the current folder is removed; the process steps out to the main repo first).
 */
export const help = {
  description: 'Stop a ticket env: remove its worktree (branch kept) and drop its databases',
  examples: [
    'ticket stop 2200',
    'ticket stop 2200 --keep-db',
    'ticket stop            # from inside a ticket worktree',
  ],
  features: [
    'Runs `lt dev down` inside the worktree (stack + Caddy block, residue-free)',
    'Removes the git worktree — the BRANCH is kept, so committed work survives',
    'Drops the ticket dev + test databases (they are orphans once the env is gone)',
    'Refuses to remove a worktree with uncommitted changes or unpushed commits',
  ],
  name: 'stop',
  options: [
    {
      default: false,
      description: 'Keep the ticket databases instead of dropping them (they are orphans — drop them manually later)',
      flag: '--keep-db',
      required: false,
      type: 'boolean',
    },
    {
      default: false,
      description: 'Remove the worktree even with uncommitted changes / unpushed commits (the branch is kept)',
      flag: '--force',
      required: false,
      type: 'boolean',
    },
    {
      default: false,
      description: 'Skip the confirmation prompt for dropping the databases',
      flag: '--noConfirm',
      required: false,
      type: 'boolean',
    },
    {
      default: false,
      description: 'Deprecated no-op — dropping is the default now. Use --keep-db to opt out.',
      flag: '--drop-db',
      required: false,
      type: 'boolean',
    },
  ],
};

const StopCommand: GluegunCommand = {
  alias: ['rm'],
  // Discloses what is DESTROYED, not just what is preserved — this line is the most-read
  // documentation the command has, and dropping databases is its irreversible part.
  description: 'Stop ticket env + drop its DBs',
  name: 'stop',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
      prompt: { confirm },
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

    // `--keep-db` PREVENTS an irreversible drop, so it is read fail-closed: presence
    // means keep, only an explicit negation still drops. (A strict `=== true` would
    // destroy the data on `--keep-db=true`, which yargs-parser hands over as a STRING.)
    const { keep: keepDb, strayValue } = keepDbFlag(parameters.options);

    // `--keep-db` takes no value, so yargs-parser swallows the next positional as one:
    // `lt ticket stop --keep-db 2200` loses the id. Recover it rather than silently
    // falling back to the marker and stopping a DIFFERENT ticket than the user named.
    if (strayValue !== null && parameters.first != null) {
      error(`Ambiguous: ticket "${parameters.first}" given, but --keep-db also carries "${strayValue}".`);
      info(colors.dim('  --keep-db takes no value. Use: lt ticket stop <id> --keep-db'));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: ambiguous --keep-db';
    }

    // Id from the argument — or, when invoked with NO id from INSIDE a ticket
    // worktree, the current worktree's own ticket (so a bare `lt ticket stop`
    // cleans up "this" environment and removes this very folder).
    const fromMarker = parameters.first == null && strayValue === null ? readTicketMarker(layout.root) : null;
    const id = String(parameters.first ?? strayValue ?? fromMarker ?? '').trim();
    if (!id) {
      error('Usage: lt ticket stop <id> [--keep-db] [--force]  — or run with no id from INSIDE a ticket worktree.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: missing id';
    }
    if (strayValue !== null) {
      info(colors.dim(`  (read ticket "${id}" from --keep-db — the flag takes no value)`));
    }

    const wt = listWorktrees(mainRepoRoot).find((w) => w.ticket === id);
    if (!wt) {
      error(`No ticket worktree "${id}" found. See \`lt ticket list\`.`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: not found';
    }

    // `git worktree list` reports the MAIN checkout as its first entry, so a stray
    // `.lt-dev/ticket` marker there would make us "stop" the main repo: drop its
    // databases, then fail to remove it. Never treat the main checkout as a ticket.
    if (sameRealPath(wt.path, mainRepoRoot)) {
      error(`"${id}" resolves to the MAIN checkout, not a ticket worktree — refusing.`);
      info(colors.dim('  A stale .lt-dev/ticket marker in the main repo? Delete it and retry.'));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: refused (main worktree)';
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

    // Resolve the drop targets BEFORE anything is torn down (the registry entry is
    // deleted at the end, and the layout is read from the main repo) — but execute
    // the drop LAST, after the worktree is provably gone.
    const base = buildIdentity(mainRepoRoot);
    const ticketSlug = `${base.slug}-${id}`;
    const mainLayout = resolveLayout(mainRepoRoot, filesystem);
    // The plan is built even with --keep-db: its targets are then RECORDED as kept
    // (registry `keptDbs`) so the orphan sweep (`lt dev prune` / `lt dev up`) never
    // collects what the user explicitly asked to keep.
    const plan = planTicketDbDrop({
      hasApi: Boolean(mainLayout.apiDir),
      // Observe what exists so sharded test DBs (`…-test-<n>`) are included —
      // their shard index cannot be derived. Listing failure (no mongosh /
      // Mongo down) degrades to the derived candidates.
      observedDbNames: listDatabaseNames(undefined, [mainLayout.apiDir, mainRepoRoot]),
      projectDevDb: deriveDbName(mainLayout.apiDir, base.slug),
      registryEntry: loadRegistry().projects[ticketSlug],
      ticketId: id,
      worktreePath: wt.path,
    });
    let dropTargets = keepDb ? [] : plan.targets;

    if (!keepDb) {
      if (plan.foreignEntryPath) {
        warning(`  registry slug "${ticketSlug}" belongs to another checkout (${plan.foreignEntryPath}) —`);
        warning("    ignoring its database name (it is not this ticket's).");
      }
      for (const db of plan.refused) {
        warning(`  refusing to drop "${db}" — it is not a database of ticket "${id}".`);
        info(colors.dim('    (drop it manually if you are sure it is safe.)'));
      }
    }

    // If we are removing the worktree we are standing in, step the process out
    // to the main repo first so git can remove the folder cleanly.
    const removingCwd = fromMarker !== null || sameRealPath(wt.path, layout.root);
    if (removingCwd) {
      try {
        process.chdir(mainRepoRoot);
      } catch {
        /* best-effort */
      }
    }

    // Dropping a database is irreversible and — unlike the source work the safety gate
    // above protects — it can never be recovered from a branch. So it is the one step we
    // confirm. Non-interactive callers (CI, AI agents, `--noConfirm`) get the documented
    // default without a prompt; the guards above are what make that safe, not the prompt.
    if (dropTargets.length > 0 && !isNonInteractive(parameters.options.noConfirm === true)) {
      info('');
      warning('  These databases will be DROPPED (irreversible):');
      dropTargets.forEach((db) => info(colors.dim(`    • ${db}`)));
      if (!(await confirm('Drop them?', true))) {
        info(colors.dim('  keeping the databases (same as --keep-db).'));
        dropTargets = [];
      }
    }

    info('');
    info(colors.bold(`Stopping ticket "${id}"`));

    // 1. Tear the isolated stack down from inside the worktree (marker-aware).
    info(colors.dim('  lt dev down …'));
    await runChildInherit(process.execPath, [process.argv[1], 'dev', 'down'], {
      cwd: wt.path,
      env: process.env,
    });

    // 2. Remove the worktree (branch is kept). Auto-force when the ONLY dirty
    //    files are auto-discardable — framework-generated (e.g. `nuxt dev`
    //    rewrites the tracked `.nuxtrc` on boot) OR pristine lt-dev self-heal
    //    patches (config.env.ts/nuxt.config.ts/playwright.config.ts that
    //    `lt dev up` env-aware'd) — which would otherwise block the remove. NEVER
    //    discard real source edits (those keep the non-forced remove, which
    //    errors with a hint so unsaved work is never lost).
    const force = parameters.options.force === true || worktreeDirtyOnlyAutoDiscardable(wt.path);
    if (force && parameters.options.force !== true) {
      info(colors.dim('  (worktree had only generated / lt-dev-patched files dirty — removing)'));
    }
    try {
      worktreeRemove(mainRepoRoot, wt.path, force);
    } catch (e) {
      error(`git worktree remove failed: ${(e as Error).message}`);
      info(
        colors.dim('  The worktree has uncommitted SOURCE changes — commit/stash them, or pass --force to discard.'),
      );
      info(colors.dim('  Nothing was dropped — the databases are untouched.'));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket stop: worktree remove failed';
    }

    // 3. The env is provably gone now — so its databases are orphans and it is safe to
    //    do the one thing we cannot undo.
    if (keepDb) {
      info(colors.dim('  --keep-db → databases kept (nothing references them anymore; drop them manually when done).'));
      // Record the kept names on the MAIN project's entry — the ticket's own entry is
      // deleted below, and without this record the orphan sweep would collect them.
      if (plan.targets.length > 0) {
        const reg = loadRegistry();
        const main = reg.projects[base.slug];
        if (main) {
          main.keptDbs = [...new Set([...(main.keptDbs ?? []), ...plan.targets])];
          saveRegistry(reg);
          info(colors.dim(`    recorded as kept in the registry: ${plan.targets.join(', ')}`));
        }
      }
    } else if (dropTargets.length > 0) {
      const { dropped, reason } = dropDatabases(dropTargets, undefined, [mainLayout.apiDir, mainRepoRoot]);
      dropped.forEach((db) => info(colors.dim(`  dropped db ${db}`)));
      if (reason === 'no-mongosh') {
        warning('  mongosh is not installed — the ticket databases were NOT dropped.');
        info(colors.dim(`    install it (brew install mongosh) and drop them manually: ${dropTargets.join(', ')}`));
      } else if (reason === 'unreachable') {
        warning('  MongoDB is not reachable — the ticket databases were NOT dropped.');
        info(colors.dim(`    start it and drop them manually: ${dropTargets.join(', ')}`));
      }
    }

    // The whole env is gone now — drop the ticket's registry entry so its slug +
    // reserved ports are reclaimed (`lt dev down` only ends the session, keeping
    // the entry for a restart; `lt ticket stop` removes the env entirely).
    {
      const reg = loadRegistry();
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

module.exports = StopCommand;
