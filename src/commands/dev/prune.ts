import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { buildIdentity } from '../../lib/dev-identity';
import { deriveDbName, resolveLayout } from '../../lib/dev-project';
import { collectDevPrunePlan } from '../../lib/dev-prune';
import { loadRegistry, saveRegistry, withRegistryLock } from '../../lib/dev-state';
import { dropDatabases, gitMainRepoRoot, listDatabaseNames } from '../../lib/dev-ticket';
import { isNonInteractive } from '../../lib/workspace-integration';

/**
 * `lt dev prune [--dry-run] [--noConfirm]` — collect the leftovers that accumulate
 * around parallel ticket work:
 *
 *   1. ORPHANED TICKET DATABASES of this project: `<base>-<id>`(+`-test`/`-test-<n>`)
 *      whose ticket has neither a live worktree nor a live registry entry. The id
 *      set comes from this repo's own `feat/*` branches — never from name shapes,
 *      so sibling projects sharing a name prefix are safe. DBs recorded via
 *      `lt ticket stop --keep-db` are never touched.
 *   2. STALE SHARD TEST DATABASES (`<base>-test-<n>` from `lt dev test --shard`)
 *      when no test session is running — they are reset on every run anyway.
 *   3. ORPHANED SMOKE-TEST DATABASES (global): the `/lt-dev:fullstack:smoke-test`
 *      throwaway projects use the reserved `lt-smoke-test` slug; their DBs are
 *      ephemeral by convention. Leftovers (e.g. a blocked drop during the run's
 *      cleanup) would be REUSED by the next run's stack and leak state between
 *      test runs — swept here whenever no live smoke-test run is registered.
 *   4. DEAD REGISTRY ENTRIES (all projects): path no longer exists → the entry and
 *      its reserved ports are reclaimed. Databases of dead MAIN projects are NEVER
 *      dropped (a deleted folder is not consent to destroy data).
 *
 * `lt dev up` runs the same collection automatically (opt out with --no-prune), so
 * restarting an environment always cleans up after its predecessors.
 */
const PruneCommand: GluegunCommand = {
  description: 'Remove orphaned ticket databases, stale shard test DBs and dead registry entries',
  hidden: false,
  name: 'prune',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
      prompt: { confirm },
    } = toolbox;

    const dryRun = parameters.options.dryRun === true || parameters.options['dry-run'] === true;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    let mainRepoRoot = layout.root;
    try {
      mainRepoRoot = gitMainRepoRoot(layout.root);
    } catch {
      /* not a git repo — registry prune still works, ticket sweep will be empty */
    }
    const mainLayout = resolveLayout(mainRepoRoot, filesystem);
    const slug = buildIdentity(mainRepoRoot).slug;
    const projectDevDb = deriveDbName(mainLayout.apiDir, slug);

    const observed = mainLayout.apiDir ? listDatabaseNames(undefined, [mainLayout.apiDir, mainRepoRoot]) : null;
    if (mainLayout.apiDir && observed === null) {
      warning('Could not list databases (mongosh missing or MongoDB unreachable) — only the registry is pruned.');
    }

    const plan = collectDevPrunePlan({
      loadRegistry,
      mainRepoRoot,
      observedDbNames: observed,
      projectDevDb,
      slug,
    });

    const dbTargets = [...new Set([...plan.orphan.targets, ...plan.shardTargets, ...plan.smokeTargets])];
    if (dbTargets.length === 0 && plan.registryPrune.length === 0) {
      success(
        'Nothing to prune — no orphaned ticket DBs, no stale shard DBs, no smoke-test DBs, no dead registry entries.',
      );
      if (plan.orphan.protected.length > 0) {
        info(colors.dim(`  kept (registry keptDbs / referenced): ${plan.orphan.protected.join(', ')}`));
      }
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev prune: nothing to do';
    }

    if (plan.orphan.targets.length > 0) {
      info(colors.bold(`Orphaned ticket databases (tickets: ${plan.orphan.orphanIds.join(', ')}):`));
      plan.orphan.targets.forEach((db) => info(colors.dim(`  • ${db}`)));
    }
    if (plan.shardTargets.length > 0) {
      info(colors.bold('Stale shard test databases (no test session running):'));
      plan.shardTargets.forEach((db) => info(colors.dim(`  • ${db}`)));
    }
    if (plan.smokeTargets.length > 0) {
      info(colors.bold('Orphaned smoke-test databases (reserved lt-smoke-test prefix, no live run):'));
      plan.smokeTargets.forEach((db) => info(colors.dim(`  • ${db}`)));
    }
    if (plan.orphan.protected.length > 0) {
      info(colors.dim(`Kept (recorded via --keep-db or still referenced): ${plan.orphan.protected.join(', ')}`));
    }
    if (plan.registryPrune.length > 0) {
      info(colors.bold('Dead registry entries (path gone — entry + ports reclaimed, databases untouched):'));
      plan.registryPrune.forEach((key) => info(colors.dim(`  • ${key}`)));
    }

    if (dryRun) {
      info('');
      info(colors.dim('--dry-run → nothing was changed.'));
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev prune: dry run';
    }

    // Dropping databases is irreversible — confirm interactively (documented default
    // for non-interactive callers, mirroring `lt ticket stop`).
    let confirmedDbTargets = dbTargets;
    if (dbTargets.length > 0 && !isNonInteractive(parameters.options.noConfirm === true)) {
      info('');
      warning('  These databases will be DROPPED (irreversible):');
      dbTargets.forEach((db) => info(colors.dim(`    • ${db}`)));
      if (!(await confirm('Drop them?', true))) {
        info(colors.dim('  keeping the databases.'));
        confirmedDbTargets = [];
      }
    }

    if (confirmedDbTargets.length > 0) {
      const { dropped, reason } = dropDatabases(confirmedDbTargets, undefined, [mainLayout.apiDir, mainRepoRoot]);
      dropped.forEach((db) => info(colors.dim(`  dropped db ${db}`)));
      if (reason === 'no-mongosh') {
        warning('  mongosh is not installed — the databases were NOT dropped.');
      } else if (reason === 'unreachable') {
        warning('  MongoDB is not reachable — the databases were NOT dropped.');
      }
    }

    if (plan.registryPrune.length > 0) {
      try {
        // Locked read-modify-write: a parallel `lt dev up` may be registering a
        // project right now — pruning without the lock clobbers its fresh entry.
        const removed = await withRegistryLock(() => {
          const reg = loadRegistry();
          const gone: string[] = [];
          for (const key of plan.registryPrune) {
            if (reg.projects[key] && !filesystem.exists(reg.projects[key].path)) {
              delete reg.projects[key];
              gone.push(key);
            }
          }
          if (gone.length > 0) {
            saveRegistry(reg);
          }
          return gone;
        });
        if (removed.length > 0) {
          info(
            colors.dim(
              `  removed ${removed.length} dead registry entr${removed.length === 1 ? 'y' : 'ies'}: ${removed.join(', ')}`,
            ),
          );
        }
      } catch (e) {
        error(`  registry update failed: ${(e as Error).message}`);
      }
    }

    info('');
    success('Prune complete.');
    if (!parameters.options.fromGluegunMenu) process.exit();
    return 'dev prune: done';
  },
};

module.exports = PruneCommand;
