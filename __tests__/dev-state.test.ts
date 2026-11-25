import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// dev-state reads LT_DEV_REGISTRY_PATH when it is imported, and vitest evaluates every
// import before the first statement: only a hoisted block runs early enough.
const { REGISTRY_TMP } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-dev-state-'));
  process.env.LT_DEV_REGISTRY_PATH = path.join(dir, 'projects.json');
  return { REGISTRY_TMP: dir };
});

import {
  allocateInternalPort,
  classifyComponentHealth,
  clearSession,
  detectSlugConflict,
  FETCH_BLOCKED_PORTS,
  healthAfterPortMove,
  healthAfterStackPortMove,
  isPidAlive,
  isValidPid,
  loadRegistry,
  loadSession,
  planInternalPort,
  planStackPorts,
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
            web: {
              dbName: 'web-local',
              internalPorts: { app: 4001 },
              path: '/web',
              subdomains: { app: 'web.localhost' },
            },
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

    /** Every port from `from` up to (not including) `to`. */
    const range = (from: number, to: number) => new Set(Array.from({ length: to - from }, (_, i) => from + i));

    // An API on 4045 served, and every Nuxt SSR call and `generate-types` failed with "bad port"
    // (excel-toolbox, 2026-11-24). The sequential allocator reached it once 4000-4044 were taken.
    test.each([
      [4000, 4045, 4046],
      [4000, 4190, 4191],
      [4500, 5060, 5062],
    ])('skips the fetch-blocked ports from %i on, with %i next in line', (start, blocked, expected) => {
      expect(allocateInternalPort(start, range(start, blocked))).toBe(expected);
    });

    test('every blocked port is refused by the fetch of the Node running the tests', async () => {
      const notBadPort: number[] = [];
      for (const port of FETCH_BLOCKED_PORTS) {
        // Refused before any connection is made, so nothing on the machine is contacted.
        const cause = await fetch(`http://127.0.0.1:${port}/`).then(
          () => undefined,
          (e: { cause?: { message?: string } }) => e.cause?.message,
        );
        if (cause !== 'bad port') notBadPort.push(port);
      }
      expect(notBadPort).toEqual([]);
    });

    test('planInternalPort keeps a registered port that fetch accepts', () => {
      expect(planInternalPort({ needed: true, registered: 4003, start: 4000, taken: new Set() })).toEqual({
        port: 4003,
        reused: true,
      });
    });

    test('planInternalPort moves a registered blocked port to a fresh one', () => {
      expect(planInternalPort({ needed: true, registered: 4045, start: 4000, taken: range(4000, 4045) })).toEqual({
        movedFrom: 4045,
        port: 4046,
        reused: false,
      });
    });

    test('planInternalPort gives a component without a registered port a fresh one', () => {
      expect(planInternalPort({ needed: true, start: 4000, taken: new Set([4000]) })).toEqual({
        port: 4001,
        reused: false,
      });
    });

    // The registry the old allocator wrote when 4000-4044 were taken. Moved off 4045 without
    // knowing the App keeps 4046, the API got 4046 too: `lt dev up` refused on every run with
    // the App running, and registered both on one port with it stopped.
    test('planStackPorts never moves the API onto the port the App keeps', () => {
      const plan = planStackPorts({
        needed: { api: true, app: true },
        registered: { api: 4045, app: 4046 },
        start: 4000,
        taken: range(4000, 4045),
      });
      expect(plan.api).toEqual({ movedFrom: 4045, port: 4047, reused: false });
      expect(plan.app).toEqual({ port: 4046, reused: true });
    });

    test('planStackPorts never moves the App onto the port the API keeps', () => {
      const plan = planStackPorts({
        needed: { api: true, app: true },
        registered: { api: 4189, app: 4190 },
        start: 4189,
        taken: new Set(),
      });
      expect(plan.api).toEqual({ port: 4189, reused: true });
      expect(plan.app).toEqual({ movedFrom: 4190, port: 4191, reused: false });
    });

    test('planStackPorts keeps both registered ports fetch accepts, and leaves `taken` alone', () => {
      const taken = new Set([4000]);
      expect(
        planStackPorts({ needed: { api: true, app: true }, registered: { api: 4003, app: 4004 }, start: 4000, taken }),
      ).toEqual({ api: { port: 4003, reused: true }, app: { port: 4004, reused: true } });
      expect([...taken]).toEqual([4000]);
    });

    test('planStackPorts gives a new stack two distinct fresh ports', () => {
      expect(
        planStackPorts({ needed: { api: true, app: true }, registered: {}, start: 4000, taken: new Set() }),
      ).toEqual({
        api: { port: 4000, reused: false },
        app: { port: 4001, reused: false },
      });
    });

    // A kept App's env still names the API's old internal port (`NUXT_API_URL`), which is the
    // blocked port the move left: SSR would go on failing with "bad port".
    test.each([
      ['running', 'crashed'],
      ['starting', 'crashed'],
      ['crashed', 'crashed'],
      ['dead', 'dead'],
    ] as const)('healthAfterPortMove restarts a %s component whose env names a moved port', (health, expected) => {
      expect(healthAfterPortMove(health, true)).toBe(expected);
    });

    test('healthAfterPortMove leaves a component alone when no port of its env moved', () => {
      expect(healthAfterPortMove('running', false)).toBe('running');
      expect(healthAfterPortMove('starting', false)).toBe('starting');
      expect(healthAfterPortMove(undefined, true)).toBeUndefined();
    });

    // The pairing `lt dev up` relies on. Checking only the App's own move here would keep a
    // serving App whose NUXT_API_URL still names the API's old, blocked port.
    test('healthAfterStackPortMove restarts the App too when only the API moved', () => {
      const plan = planStackPorts({
        needed: { api: true, app: true },
        registered: { api: 4045, app: 4046 },
        start: 4000,
        taken: range(4000, 4045),
      });
      expect(plan.api.movedFrom).toBe(4045);
      expect(plan.app.movedFrom).toBeUndefined();
      expect(healthAfterStackPortMove({ api: 'running', app: 'running' }, plan)).toEqual({
        api: 'crashed',
        app: 'crashed',
      });
    });

    test('healthAfterStackPortMove keeps the API when only the App moved', () => {
      const plan = planStackPorts({
        needed: { api: true, app: true },
        registered: { api: 4189, app: 4190 },
        start: 4189,
        taken: new Set(),
      });
      expect(plan.app.movedFrom).toBe(4190);
      expect(healthAfterStackPortMove({ api: 'running', app: 'starting' }, plan)).toEqual({
        api: 'running',
        app: 'crashed',
      });
    });

    test('healthAfterStackPortMove changes nothing when no port moved, and adds no component', () => {
      const kept = planStackPorts({
        needed: { api: true, app: true },
        registered: { api: 4001, app: 4002 },
        start: 4000,
        taken: new Set(),
      });
      expect(healthAfterStackPortMove({ api: 'running', app: 'starting' }, kept)).toEqual({
        api: 'running',
        app: 'starting',
      });
      const apiOnly = planStackPorts({
        needed: { api: true, app: false },
        registered: { api: 4045 },
        start: 4000,
        taken: new Set(),
      });
      expect(healthAfterStackPortMove({ api: 'dead' }, apiOnly)).toEqual({ api: 'dead', app: undefined });
    });

    test('planInternalPort allocates nothing for a component the project does not have', () => {
      expect(planInternalPort({ needed: false, start: 4000, taken: new Set() })).toEqual({
        port: undefined,
        reused: false,
      });
      expect(planInternalPort({ needed: false, registered: 4190, start: 4000, taken: new Set() })).toEqual({
        movedFrom: 4190,
        port: undefined,
        reused: false,
      });
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
      await expect(withRegistryLock(() => 'never', { staleMs: 60_000, timeoutMs: 200 })).rejects.toThrow(
        /registry lock busy/,
      );
      release();
      await holder;
      expect(existsSync(LOCK_PATH)).toBe(false);
    });
  });
});
