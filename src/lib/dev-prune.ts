/**
 * Garbage collection for `lt dev` / `lt ticket` leftovers.
 *
 * Two classes of orphans accumulate on a busy machine and nothing collected them:
 *
 *   1. TICKET DATABASES whose environment is gone. `lt ticket stop` is the only
 *      path that drops `<base>-<id>`(+`-test`/`-test-<n>`) — when a worktree is
 *      deleted manually, the ticket predates the drop feature, `--keep-db` was
 *      not intended, or mongosh/Mongo was unavailable at stop time, the DBs stay
 *      forever (observed: 19 orphaned per-ticket DBs for a single project).
 *
 *   2. REGISTRY ENTRIES whose `path` no longer exists. They hold reserved
 *      internal ports and slugs indefinitely; `lastUsedAt` is recorded but was
 *      never used for cleanup.
 *
 * Safety model (fail closed, like `lt ticket stop`):
 *   - Ticket ids are taken from THIS project's own `feat/*` branches — the one
 *     durable record of every ticket ever started here (branches are kept on
 *     stop). A name that merely LOOKS ticket-shaped is never enough: prefix
 *     collisions between sibling projects (`nest-server` vs `nest-server-starter`)
 *     make shape-based sweeps destructive.
 *   - An id is only orphaned when it has NO live worktree and NO live registry
 *     entry.
 *   - Every candidate must pass {@link isTicketScopedDb} — the same last gate
 *     `lt ticket stop` uses.
 *   - Databases recorded in any registry entry (dbName or keptDbs — the
 *     `lt ticket stop --keep-db` record) are NEVER touched.
 *   - Registry pruning removes ENTRIES only, never a `-local` dev database:
 *     a deleted folder is not consent to destroy data (the project may be
 *     re-cloned).
 */
import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import type { ProjectsRegistry } from './dev-state';

import { deriveTestDbName } from './dev-project';
import { deriveTicketId, isReservedTicketId, isTicketScopedDb, listWorktrees } from './dev-ticket';

/** Branch prefix `lt ticket start` creates worktrees on. */
const TICKET_BRANCH_PREFIX = 'feat/';

/** Everything `lt dev prune` (or the `lt dev up` auto-prune) would do — pure planning. */
export interface DevPrunePlan {
  /** Server listing used for observation, or null when unavailable. */
  observed: null | string[];
  /** Orphaned ticket databases of THIS project. */
  orphan: OrphanSweepPlan;
  /** Dead-path registry entries (all projects) — entries only, never databases. */
  registryPrune: string[];
  /** Stale sharded-test databases of THIS project. */
  shardTargets: string[];
}

export interface OrphanSweepPlan {
  /** Ticket ids considered orphaned (no worktree, no live registry entry). */
  orphanIds: string[];
  /** Excluded although orphaned: recorded as kept (`lt ticket stop --keep-db`) or registry-referenced. */
  protected: string[];
  /** Databases to drop. */
  targets: string[];
}

/**
 * Collect the full prune plan for one project. Reads the registry and the Mongo
 * database listing; performs NO destructive action.
 */
export function collectDevPrunePlan(args: {
  loadRegistry: () => ProjectsRegistry;
  mainRepoRoot: string;
  observedDbNames: null | string[];
  projectDevDb: string;
  slug: string;
}): DevPrunePlan {
  const { loadRegistry, mainRepoRoot, observedDbNames, projectDevDb, slug } = args;
  const registry = loadRegistry();
  return {
    observed: observedDbNames,
    orphan: planOrphanTicketDbSweep({
      mainRepoRoot,
      observedDbNames,
      projectDevDb,
      registry,
      slug,
    }),
    registryPrune: planRegistryPrune(registry),
    shardTargets: planStaleShardDbSweep({
      observedDbNames,
      projectDevDb,
      projectRoot: mainRepoRoot,
    }),
  };
}

/** Ticket ids that still have a live environment (worktree and/or live registry entry). */
export function listLiveTicketIds(mainRepoRoot: string, registry: ProjectsRegistry, slug: string): string[] {
  const live = new Set<string>();
  try {
    for (const wt of listWorktrees(mainRepoRoot)) {
      if (wt.ticket) live.add(wt.ticket);
      if (wt.branch?.startsWith(TICKET_BRANCH_PREFIX)) {
        live.add(deriveTicketId(wt.branch.slice(TICKET_BRANCH_PREFIX.length)));
      }
    }
  } catch {
    /* fail closed below: without worktree info we do not sweep at all */
    return [];
  }
  for (const [key, entry] of Object.entries(registry.projects)) {
    if (key.startsWith(`${slug}-`) && entry.path && existsSync(entry.path)) {
      live.add(key.slice(slug.length + 1));
    }
  }
  return [...live];
}

/**
 * Ticket ids of every ticket EVER started in this repo, derived from its local
 * `feat/*` branches (kept by `lt ticket stop` on purpose). Best-effort: an
 * unreadable repo yields an empty list, which makes the sweep a no-op.
 */
export function listPastTicketIds(mainRepoRoot: string): string[] {
  let branches: string[];
  try {
    branches = execFileSync(
      'git',
      ['-C', mainRepoRoot, 'branch', '--list', `${TICKET_BRANCH_PREFIX}*`, '--format=%(refname:short)'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    )
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
  const ids = branches.map((branch) => deriveTicketId(branch.slice(TICKET_BRANCH_PREFIX.length)));
  return [...new Set(ids)].filter((id) => id && !isReservedTicketId(id));
}

/**
 * Plan the orphan-ticket-database sweep for ONE project. Pure — no side effects.
 *
 * `observedDbNames` must come from an actual server listing; null (listing
 * failed) yields an empty plan. Observation selects candidates, the safety
 * gates decide.
 */
export function planOrphanTicketDbSweep(args: {
  mainRepoRoot: string;
  observedDbNames: null | string[];
  projectDevDb: string;
  registry: ProjectsRegistry;
  slug: string;
}): OrphanSweepPlan {
  const { mainRepoRoot, observedDbNames, projectDevDb, registry, slug } = args;
  if (!observedDbNames || observedDbNames.length === 0) {
    return { orphanIds: [], protected: [], targets: [] };
  }

  const pastIds = listPastTicketIds(mainRepoRoot);
  if (pastIds.length === 0) {
    return { orphanIds: [], protected: [], targets: [] };
  }
  const liveIds = new Set(listLiveTicketIds(mainRepoRoot, registry, slug));
  const orphanIds = pastIds.filter((id) => !liveIds.has(id));

  // Never touch anything a registry entry still references or explicitly kept.
  const protectedNames = new Set<string>();
  for (const entry of Object.values(registry.projects)) {
    if (entry.dbName) {
      protectedNames.add(entry.dbName);
      protectedNames.add(deriveTestDbName(entry.dbName));
    }
    for (const kept of entry.keptDbs ?? []) {
      protectedNames.add(kept);
    }
  }

  // Sibling shield: when another REGISTERED project's DB base extends ours
  // (`nest-server` vs `nest-server-starter`), every name under the longer base
  // belongs to the sibling — even if one of OUR branch-derived ids happens to
  // make it parse as ticket-scoped for us (branch `feat/starter-2205` +
  // sibling DB `nest-server-starter-2205`). The longer base wins, always.
  const base = projectDevDb.replace(/-(local|dev)$/i, '');
  const siblingBases = Object.values(registry.projects)
    .map((entry) => entry.dbName?.replace(/-(local|dev)$/i, ''))
    .filter((b): b is string => Boolean(b) && b !== base && b.startsWith(`${base}-`));

  const targets: string[] = [];
  const shielded: string[] = [];
  for (const id of orphanIds) {
    for (const name of observedDbNames) {
      if (!isTicketScopedDb(name, id, projectDevDb)) continue;
      if (protectedNames.has(name) || siblingBases.some((sb) => name === sb || name.startsWith(`${sb}-`))) {
        shielded.push(name);
      } else {
        targets.push(name);
      }
    }
  }
  return {
    orphanIds: orphanIds.filter((id) => targets.some((t) => isTicketScopedDb(t, id, projectDevDb))),
    protected: shielded,
    targets: [...new Set(targets)],
  };
}

/**
 * Registry entries whose recorded path no longer exists. Their slug + reserved
 * internal ports are reclaimed by deleting the ENTRY; their databases are left
 * alone here (ticket DBs are handled by the orphan sweep; `-local` dev DBs are
 * never auto-dropped).
 */
export function planRegistryPrune(registry: ProjectsRegistry): string[] {
  return Object.entries(registry.projects)
    .filter(([, entry]) => entry.path && !existsSync(entry.path))
    .map(([key]) => key);
}

/**
 * Stale sharded-test databases of the project itself (`<base>-test-<n>` from
 * `lt dev test --shard`). They are ephemeral by definition — every shard run
 * resets its DB on boot — so with no test session alive they are pure leftovers.
 * The UNSHARDED `<base>-test` DB is kept: it is the project's steady-state test
 * database (dev DB + test DB is the intended per-project footprint).
 */
export function planStaleShardDbSweep(args: {
  observedDbNames: null | string[];
  projectDevDb: string;
  /** Project root — checked for live `state.test*.json` sessions. */
  projectRoot: string;
}): string[] {
  const { observedDbNames, projectDevDb, projectRoot } = args;
  if (!observedDbNames) return [];
  try {
    const sessionDir = join(projectRoot, '.lt-dev');
    if (existsSync(sessionDir) && readdirSync(sessionDir).some((f) => /^state\.test.*\.json$/.test(f))) {
      // A test session (or shard) is live — its DBs are in use.
      return [];
    }
  } catch {
    return [];
  }
  const shardPattern = new RegExp(`^${escapeRegExp(`${deriveTestDbName(projectDevDb)}-`)}\\d+$`);
  return observedDbNames.filter((name) => shardPattern.test(name));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
