import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const REGISTRY_TMP = mkdtempSync(join(tmpdir(), 'lt-dev-state-'));
process.env.LT_DEV_REGISTRY_PATH = join(REGISTRY_TMP, 'projects.json');

// Import AFTER setting env so the module picks up the override
import {
  allocateInternalPort,
  classifyComponentHealth,
  clearSession,
  detectSlugConflict,
  isPidAlive,
  isValidPid,
  loadRegistry,
  loadSession,
  saveRegistry,
  saveSession,
  takenInternalPorts,
  withRegistryLock,
} from '../src/lib/dev-state';

const LOCK_PATH = `${process.env.LT_DEV_REGISTRY_PATH!}.lock`;

describe('dev-state', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lt-dev-state-proj-'));
    // Reset registry between tests
    writeFileSync(process.env.LT_DEV_REGISTRY_PATH!, JSON.stringify({ projects: {}, version: 1 }));
  });
  afterEach(() => {
    rmSync(projectRoot, { force: true, recursive: true });
  });
  afterAll(() => {
    rmSync(REGISTRY_TMP, { force: true, recursive: true });
  });

  describe('isValidPid', () => {
    test('accepts plausible PIDs', () => {
      expect(isValidPid(1)).toBe(true);
      expect(isValidPid(12345)).toBe(true);
    });
    test('rejects bogus PIDs', () => {
      expect(isValidPid(0)).toBe(false);
      expect(isValidPid(-1)).toBe(false);
      expect(isValidPid(5_000_000)).toBe(false);
      expect(isValidPid('not-a-pid')).toBe(false);
      expect(isValidPid(null)).toBe(false);
    });
  });

  describe('isPidAlive', () => {
    test('current process is alive', () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });
    test('bogus PID is dead', () => {
      expect(isPidAlive(4_000_000)).toBe(false);
    });
  });

  describe('classifyComponentHealth', () => {
    // 4194303 = top of the valid PID range; no such process is running.
    const DEAD_PID = 4194303;
    test('supervisor alive + port bound → running', () => {
      expect(classifyComponentHealth({ pid: process.pid, portBound: true })).toBe('running');
    });
    test('supervisor alive + port free → crashed (zombie nodemon)', () => {
      expect(classifyComponentHealth({ pid: process.pid, portBound: false })).toBe('crashed');
    });
    test('supervisor dead → dead, regardless of port', () => {
      expect(classifyComponentHealth({ pid: DEAD_PID, portBound: true })).toBe('dead');
      expect(classifyComponentHealth({ pid: DEAD_PID, portBound: false })).toBe('dead');
    });
    test('no recorded PID → dead', () => {
      expect(classifyComponentHealth({ pid: undefined, portBound: true })).toBe('dead');
      expect(classifyComponentHealth({ pid: undefined, portBound: false })).toBe('dead');
    });
  });

  describe('registry', () => {
    test('round-trip save/load', () => {
      const reg = loadRegistry();
      reg.projects.crm = {
        dbName: 'crm-local',
        internalPorts: { api: 4010, app: 4011 },
        path: '/tmp/crm',
        subdomains: { api: 'api.crm.localhost', app: 'crm.localhost' },
      };
      saveRegistry(reg);
      const reloaded = loadRegistry();
      expect(reloaded.projects.crm.subdomains.api).toBe('api.crm.localhost');
      expect(reloaded.projects.crm.internalPorts.api).toBe(4010);
    });
    test('returns empty when file missing', () => {
      rmSync(process.env.LT_DEV_REGISTRY_PATH!);
      const reg = loadRegistry();
      expect(reg.projects).toEqual({});
      expect(reg.version).toBe(1);
    });
    test('returns empty when file malformed', () => {
      writeFileSync(process.env.LT_DEV_REGISTRY_PATH!, 'not json');
      const reg = loadRegistry();
      expect(reg.projects).toEqual({});
    });

    // An App-only project has no database. Older registries (written before
    // `lt dev up` stopped persisting one for App-only stacks) still carry a
    // derived dbName; loadRegistry strips it so readers can test dbName alone.
    test('strips dbName from an entry without an api subdomain', () => {
      writeFileSync(
        process.env.LT_DEV_REGISTRY_PATH!,
        JSON.stringify({
          projects: {
            web: { dbName: 'web-local', internalPorts: { app: 4001 }, path: '/web', subdomains: { app: 'web.localhost' } },
          },
          version: 1,
        }),
      );
      expect(loadRegistry().projects.web.dbName).toBeUndefined();
    });

    test('keeps dbName when an api subdomain is present', () => {
      writeFileSync(
        process.env.LT_DEV_REGISTRY_PATH!,
        JSON.stringify({
          projects: {
            crm: {
              dbName: 'crm-local',
              internalPorts: { api: 4010, app: 4011 },
              path: '/crm',
              subdomains: { api: 'api.crm.localhost', app: 'crm.localhost' },
            },
          },
          version: 1,
        }),
      );
      expect(loadRegistry().projects.crm.dbName).toBe('crm-local');
    });
  });

  describe('session', () => {
    test('round-trip save/load/clear', () => {
      saveSession(projectRoot, { pids: { api: 1234, app: 5678 }, startedAt: '2026-05-10T00:00:00Z' });
      const loaded = loadSession(projectRoot);
      expect(loaded?.pids.api).toBe(1234);
      expect(loaded?.pids.app).toBe(5678);
      clearSession(projectRoot);
      expect(loadSession(projectRoot)).toBeNull();
    });
    test('drops invalid PIDs from state.json', () => {
      const raw = JSON.stringify({ pids: { api: -1, app: 5678 }, startedAt: '2026-05-10T00:00:00Z' });
      const dir = join(projectRoot, '.lt-dev');
      require('fs').mkdirSync(dir);
      writeFileSync(join(dir, 'state.json'), raw);
      const loaded = loadSession(projectRoot);
      expect(loaded?.pids.api).toBeUndefined();
      expect(loaded?.pids.app).toBe(5678);
    });
  });

  describe('port allocation', () => {
    test('allocates first free port', () => {
      const taken = new Set<number>([4000, 4001]);
      expect(allocateInternalPort(4000, taken)).toBe(4002);
    });
    test('takenInternalPorts collects across registry', () => {
      const reg = loadRegistry();
      reg.projects.a = { internalPorts: { api: 4000, app: 4001 }, path: '/a', subdomains: {} };
      reg.projects.b = { internalPorts: { api: 4002 }, path: '/b', subdomains: {} };
      const t = takenInternalPorts(reg);
      expect(t.has(4000)).toBe(true);
      expect(t.has(4001)).toBe(true);
      expect(t.has(4002)).toBe(true);
    });
    test('takenInternalPorts excludes given slug', () => {
      const reg = loadRegistry();
      reg.projects.a = { internalPorts: { api: 4000 }, path: '/a', subdomains: {} };
      reg.projects.b = { internalPorts: { api: 4001 }, path: '/b', subdomains: {} };
      const t = takenInternalPorts(reg, 'a');
      expect(t.has(4000)).toBe(false);
      expect(t.has(4001)).toBe(true);
    });
  });

  describe('detectSlugConflict', () => {
    let otherRoot: string;
    beforeEach(() => {
      otherRoot = mkdtempSync(join(tmpdir(), 'lt-dev-state-other-'));
    });
    afterEach(() => rmSync(otherRoot, { force: true, recursive: true }));

    const register = (path: string) =>
      saveRegistry({ projects: { svl: { internalPorts: {}, path, subdomains: {} } }, version: 1 });

    test('no registry entry → null', () => {
      expect(detectSlugConflict('svl', projectRoot)).toBeNull();
    });

    test('entry belongs to THIS checkout → null', () => {
      register(projectRoot);
      expect(detectSlugConflict('svl', projectRoot)).toBeNull();
    });

    test('entry points to ANOTHER checkout (no session) → conflict, not alive', () => {
      register(otherRoot);
      const c = detectSlugConflict('svl', projectRoot);
      expect(c).not.toBeNull();
      expect(c!.otherPath).toBe(otherRoot);
      expect(c!.otherSessionAlive).toBe(false);
    });

    test('another checkout with a LIVE session → otherSessionAlive true', () => {
      register(otherRoot);
      saveSession(otherRoot, { pids: { api: process.pid }, startedAt: '2026-01-01T00:00:00.000Z' });
      expect(detectSlugConflict('svl', projectRoot)?.otherSessionAlive).toBe(true);
    });

    test('another checkout with a DEAD session → otherSessionAlive false', () => {
      register(otherRoot);
      // 4194303 = max valid PID range but no such process is running.
      saveSession(otherRoot, { pids: { api: 4194303 }, startedAt: '2026-01-01T00:00:00.000Z' });
      expect(detectSlugConflict('svl', projectRoot)?.otherSessionAlive).toBe(false);
    });
  });

  describe('withRegistryLock', () => {
    // Make sure no leftover lock file from a previous test leaks into the next one.
    beforeEach(() => {
      if (existsSync(LOCK_PATH)) rmSync(LOCK_PATH, { force: true });
    });
    afterEach(() => {
      if (existsSync(LOCK_PATH)) rmSync(LOCK_PATH, { force: true });
    });

    test('runs fn and returns its result; releases the lock afterwards', async () => {
      const result = await withRegistryLock(() => 42);
      expect(result).toBe(42);
      expect(existsSync(LOCK_PATH)).toBe(false);
    });

    test('serializes concurrent callers (no two run simultaneously)', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const work = (id: number) =>
        withRegistryLock(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          // Hold the lock briefly so a concurrent caller would observe overlap.
          await new Promise((resolve) => setTimeout(resolve, 30));
          inFlight--;
          return id;
        });
      const results = await Promise.all([work(1), work(2), work(3)]);
      expect(results.sort()).toEqual([1, 2, 3]);
      expect(maxInFlight).toBe(1);
      expect(existsSync(LOCK_PATH)).toBe(false);
    });

    test('releases the lock even when fn throws', async () => {
      await expect(
        withRegistryLock(() => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(existsSync(LOCK_PATH)).toBe(false);
      // A subsequent caller must succeed immediately (lock is gone).
      const after = await withRegistryLock(() => 'ok');
      expect(after).toBe('ok');
    });

    test('reclaims a stale lock left by a crashed holder', async () => {
      // Simulate a crashed holder: a lock file present, but older than staleMs.
      writeFileSync(LOCK_PATH, '');
      const oldTime = new Date(Date.now() - 60_000);
      require('fs').utimesSync(LOCK_PATH, oldTime, oldTime);
      const result = await withRegistryLock(() => 'reclaimed', { staleMs: 1_000, timeoutMs: 2_000 });
      expect(result).toBe('reclaimed');
      expect(existsSync(LOCK_PATH)).toBe(false);
    });

    test('throws a clear error when the lock stays busy past timeoutMs', async () => {
      // Hold the lock long enough that a second caller hits the timeout.
      let release: () => void = () => undefined;
      const holdUntil = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = withRegistryLock(async () => {
        await holdUntil;
      });
      // Give the holder a moment to actually grab the lock.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(
        withRegistryLock(() => 'never', { staleMs: 60_000, timeoutMs: 200 }),
      ).rejects.toThrow(/registry lock busy/);
      release();
      await holder;
      expect(existsSync(LOCK_PATH)).toBe(false);
    });
  });
});
