import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const REGISTRY_TMP = mkdtempSync(join(tmpdir(), 'lt-dev-state-'));
process.env.LT_DEV_REGISTRY_PATH = join(REGISTRY_TMP, 'projects.json');

// Import AFTER setting env so the module picks up the override
import {
  allocateInternalPort,
  clearSession,
  isPidAlive,
  isValidPid,
  loadRegistry,
  loadSession,
  saveRegistry,
  saveSession,
  takenInternalPorts,
} from '../src/lib/dev-state';

describe('dev-state', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lt-dev-state-proj-'));
    // Reset registry between tests
    writeFileSync(process.env.LT_DEV_REGISTRY_PATH!, JSON.stringify({ projects: {}, version: 1 }));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(REGISTRY_TMP, { recursive: true, force: true });
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
});

// Quench unused-warning in some setups
void readFileSync;
