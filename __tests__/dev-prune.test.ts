import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { ProjectsRegistry } from '../src/lib/dev-state';

import {
  listLiveTicketIds,
  listPastTicketIds,
  planOrphanTicketDbSweep,
  planRegistryPrune,
  planSmokeTestDbSweep,
  planStaleShardDbSweep,
} from '../src/lib/dev-prune';

/**
 * The prune plan decides IRREVERSIBLE database drops from derived data, so these
 * tests pin down the safety gates, not just the happy path. Each negative test
 * describes a way real data would be destroyed by a naive implementation.
 */
describe('dev-prune', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

  /** Minimal real repo: main branch + feat/* ticket branches (+ optional live worktree). */
  function makeRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'lt-prune-repo-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'ci@lenne.tech');
    git(repo, 'config', 'user.name', 'CI');
    writeFileSync(join(repo, 'README.md'), 'x');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    return repo;
  }

  function emptyRegistry(): ProjectsRegistry {
    return { projects: {}, version: 1 };
  }

  let repo: string;
  const cleanups: string[] = [];

  beforeEach(() => {
    repo = makeRepo();
    cleanups.push(repo);
  });

  afterAll(() => {
    for (const dir of cleanups) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  describe('listPastTicketIds', () => {
    test('derives ids from feat/* branches only (same deriveTicketId mapping as `lt ticket start`)', () => {
      git(repo, 'branch', 'feat/DEV-2381');
      git(repo, 'branch', 'feat/slot-2'); // `<word>-<digits>` → numeric tail, exactly like start
      git(repo, 'branch', 'release/1.0'); // not a ticket branch
      expect(listPastTicketIds(repo).sort()).toEqual(['2', '2381']);
    });

    test('non-repo → empty (sweep becomes a no-op)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'lt-prune-nongit-'));
      cleanups.push(dir);
      expect(listPastTicketIds(dir)).toEqual([]);
    });
  });

  describe('planOrphanTicketDbSweep', () => {
    test('collects dev + test + SHARD dbs of an orphaned ticket', () => {
      git(repo, 'branch', 'feat/DEV-2381');
      const plan = planOrphanTicketDbSweep({
        mainRepoRoot: repo,
        observedDbNames: ['svl-2381', 'svl-2381-test', 'svl-2381-test-1', 'svl-2381-test-2', 'svl-local'],
        projectDevDb: 'svl-local',
        registry: emptyRegistry(),
        slug: 'svl',
      });
      expect(plan.targets.sort()).toEqual(['svl-2381', 'svl-2381-test', 'svl-2381-test-1', 'svl-2381-test-2']);
      expect(plan.targets).not.toContain('svl-local');
    });

    test('a LIVE worktree shields its ticket databases', () => {
      git(repo, 'branch', 'feat/DEV-2381');
      const wt = mkdtempSync(join(tmpdir(), 'lt-prune-wt-'));
      cleanups.push(wt);
      rmSync(wt, { force: true, recursive: true });
      git(repo, 'worktree', 'add', '-q', wt, 'feat/DEV-2381');
      const plan = planOrphanTicketDbSweep({
        mainRepoRoot: repo,
        observedDbNames: ['svl-2381', 'svl-2381-test'],
        projectDevDb: 'svl-local',
        registry: emptyRegistry(),
        slug: 'svl',
      });
      expect(plan.targets).toEqual([]);
    });

    test('a live registry entry shields its ticket databases', () => {
      git(repo, 'branch', 'feat/DEV-2381');
      const livePath = mkdtempSync(join(tmpdir(), 'lt-prune-live-'));
      cleanups.push(livePath);
      const registry = emptyRegistry();
      registry.projects['svl-2381'] = { internalPorts: {}, path: livePath, subdomains: {} };
      const plan = planOrphanTicketDbSweep({
        mainRepoRoot: repo,
        observedDbNames: ['svl-2381'],
        projectDevDb: 'svl-local',
        registry,
        slug: 'svl',
      });
      expect(plan.targets).toEqual([]);
    });

    test('`lt ticket stop --keep-db` records are never collected', () => {
      git(repo, 'branch', 'feat/DEV-2381');
      const registry = emptyRegistry();
      registry.projects['svl'] = {
        dbName: 'svl-local',
        internalPorts: {},
        keptDbs: ['svl-2381'],
        path: repo,
        subdomains: {},
      };
      const plan = planOrphanTicketDbSweep({
        mainRepoRoot: repo,
        observedDbNames: ['svl-2381', 'svl-2381-test'],
        projectDevDb: 'svl-local',
        registry,
        slug: 'svl',
      });
      expect(plan.targets).toEqual(['svl-2381-test']);
      expect(plan.protected).toContain('svl-2381');
    });

    test('SIBLING SHIELD: a registered project whose base extends ours is untouchable', () => {
      // Contrived worst case: our repo has a branch whose derived id makes the
      // sibling's ticket DB parse as ticket-scoped for US (`feat/starter-x2205`
      // → id `starter-x2205` → candidate `nest-server-starter-x2205`, which is
      // also ticket `x2205` of the sibling project `nest-server-starter`).
      git(repo, 'branch', 'feat/starter-x2205');
      const registry = emptyRegistry();
      registry.projects['nest-server-starter'] = {
        dbName: 'nest-server-starter-local',
        internalPorts: {},
        path: repo, // alive
        subdomains: {},
      };
      const plan = planOrphanTicketDbSweep({
        mainRepoRoot: repo,
        observedDbNames: ['nest-server-starter-x2205'],
        projectDevDb: 'nest-server-local',
        registry,
        slug: 'nest-server',
      });
      expect(plan.targets).toEqual([]);
      expect(plan.protected).toContain('nest-server-starter-x2205');
    });

    test('no observation → no drops (listing failure fails closed)', () => {
      git(repo, 'branch', 'feat/DEV-2381');
      const plan = planOrphanTicketDbSweep({
        mainRepoRoot: repo,
        observedDbNames: null,
        projectDevDb: 'svl-local',
        registry: emptyRegistry(),
        slug: 'svl',
      });
      expect(plan.targets).toEqual([]);
    });
  });

  describe('listLiveTicketIds', () => {
    test('worktree ticket ids are live', () => {
      git(repo, 'branch', 'feat/DEV-2381');
      const wt = mkdtempSync(join(tmpdir(), 'lt-prune-wt2-'));
      cleanups.push(wt);
      rmSync(wt, { force: true, recursive: true });
      git(repo, 'worktree', 'add', '-q', wt, 'feat/DEV-2381');
      expect(listLiveTicketIds(repo, emptyRegistry(), 'svl')).toContain('2381');
    });
  });

  describe('planStaleShardDbSweep', () => {
    test('collects only numeric shard suffixes of the project test DB', () => {
      const targets = planStaleShardDbSweep({
        observedDbNames: ['svl-test-1', 'svl-test-2', 'svl-test', 'svl-local', 'svl-test-x', 'svl-2381-test-1'],
        projectDevDb: 'svl-local',
        projectRoot: repo,
      });
      expect(targets.sort()).toEqual(['svl-test-1', 'svl-test-2']);
    });

    test('a live test session shields all shard DBs', () => {
      mkdirSync(join(repo, '.lt-dev'), { recursive: true });
      writeFileSync(join(repo, '.lt-dev', 'state.test.1.json'), '{}');
      const targets = planStaleShardDbSweep({
        observedDbNames: ['svl-test-1'],
        projectDevDb: 'svl-local',
        projectRoot: repo,
      });
      expect(targets).toEqual([]);
    });
  });

  describe('planRegistryPrune', () => {
    test('dead paths are pruned, live paths and their DBs stay', () => {
      const registry = emptyRegistry();
      registry.projects['alive'] = { internalPorts: {}, path: repo, subdomains: {} };
      registry.projects['gone'] = {
        dbName: 'gone-local',
        internalPorts: {},
        path: join(repo, 'does-not-exist'),
        subdomains: {},
      };
      expect(planRegistryPrune(registry)).toEqual(['gone']);
    });
  });

  describe('planSmokeTestDbSweep', () => {
    test('collects every DB under the reserved smoke-test prefix, nothing else', () => {
      const targets = planSmokeTestDbSweep({
        observedDbNames: [
          'lt-smoke-test-local',
          'lt-smoke-test-test',
          'lt-smoke-test-develop',
          'lt-smoke-test', // bare name counts too
          'lt-smoke-testing-local', // different slug — NOT ours (no dash boundary)
          'imo-local',
          'admin',
        ],
        registry: emptyRegistry(),
      });
      expect(targets.sort()).toEqual([
        'lt-smoke-test',
        'lt-smoke-test-develop',
        'lt-smoke-test-local',
        'lt-smoke-test-test',
      ]);
    });

    test('no server listing → no sweep (fail closed)', () => {
      expect(planSmokeTestDbSweep({ observedDbNames: null, registry: emptyRegistry() })).toEqual([]);
      expect(planSmokeTestDbSweep({ observedDbNames: [], registry: emptyRegistry() })).toEqual([]);
    });

    test('a LIVE smoke-test run (registry path exists) blocks the whole sweep', () => {
      const registry = emptyRegistry();
      registry.projects['lt-smoke-test'] = { dbName: 'lt-smoke-test-local', internalPorts: {}, path: repo, subdomains: {} };
      expect(
        planSmokeTestDbSweep({
          observedDbNames: ['lt-smoke-test-local', 'lt-smoke-test-test'],
          registry,
        }),
      ).toEqual([]);
    });

    test('a DEAD smoke-test registry entry does not protect its DBs (that is the leak being fixed)', () => {
      const registry = emptyRegistry();
      registry.projects['lt-smoke-test'] = {
        dbName: 'lt-smoke-test-local',
        internalPorts: {},
        path: join(repo, 'does-not-exist'),
        subdomains: {},
      };
      expect(
        planSmokeTestDbSweep({ observedDbNames: ['lt-smoke-test-local'], registry }).sort(),
      ).toEqual(['lt-smoke-test-local']);
    });

    test('keptDbs are honored even under the smoke prefix', () => {
      const registry = emptyRegistry();
      registry.projects['other'] = {
        internalPorts: {},
        keptDbs: ['lt-smoke-test-local'],
        path: join(repo, 'does-not-exist'),
        subdomains: {},
      };
      expect(
        planSmokeTestDbSweep({
          observedDbNames: ['lt-smoke-test-local', 'lt-smoke-test-test'],
          registry,
        }),
      ).toEqual(['lt-smoke-test-test']);
    });
  });
});
