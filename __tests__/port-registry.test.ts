import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  allocatedSlots,
  allocateSlot,
  clearLocalState,
  isPidAlive,
  isValidPid,
  loadLocalState,
  loadRegistry,
  localStatePath,
  portsForSlot,
  projectSlug,
  saveLocalState,
  saveRegistry,
  SLOT_BASE_API,
  SLOT_MAX,
  SLOT_PORT_RANGE_END,
  SLOT_STEP,
  slotFromSlug,
} from '../src/lib/port-registry';

describe('port-registry', () => {
  describe('slotFromSlug', () => {
    it('produces a deterministic slot in [0, SLOT_MAX) for any string', () => {
      const slot = slotFromSlug('crm');
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(SLOT_MAX);
    });

    it('returns the same slot for the same slug across calls', () => {
      expect(slotFromSlug('showroom')).toBe(slotFromSlug('showroom'));
    });

    it('returns different slots for different slugs (in most cases)', () => {
      // Two arbitrary slugs are very unlikely to collide; the assertion is
      // probabilistic but holds for the chosen names.
      expect(slotFromSlug('crm')).not.toBe(slotFromSlug('showroom'));
    });
  });

  describe('portsForSlot', () => {
    it('maps slot 0 to the base ports', () => {
      expect(portsForSlot(0)).toEqual({ api: SLOT_BASE_API, app: SLOT_BASE_API + 1 });
    });

    it('increments by SLOT_STEP per slot', () => {
      expect(portsForSlot(3)).toEqual({ api: SLOT_BASE_API + 3 * SLOT_STEP, app: SLOT_BASE_API + 3 * SLOT_STEP + 1 });
    });
  });

  describe('projectSlug', () => {
    it('uses the basename of the path', () => {
      expect(projectSlug('/Users/me/code/lenneTech/crm')).toBe('crm');
    });

    it('lowercases and replaces non-alphanumerics with dashes', () => {
      expect(projectSlug('/tmp/My Project_Name')).toBe('my-project-name');
    });

    it('strips trailing slashes', () => {
      expect(projectSlug('/foo/bar/')).toBe('bar');
    });

    it('falls back to "project" for empty input', () => {
      expect(projectSlug('')).toBe('project');
    });
  });

  describe('allocateSlot', () => {
    it('returns the deterministic slot when free', () => {
      const registry = { projects: {}, version: 1 as const };
      const expected = slotFromSlug('crm');
      expect(allocateSlot('crm', registry)).toBe(expected);
    });

    it('falls through to the next free slot on collision', () => {
      const slug = 'foo';
      const taken = slotFromSlug(slug);
      const registry = {
        projects: {
          other: { path: '/x', ports: portsForSlot(taken), slot: taken },
        },
        version: 1 as const,
      };
      const next = allocateSlot(slug, registry);
      expect(next).not.toBe(taken);
      expect(allocatedSlots(registry).has(next)).toBe(false);
    });

    it('throws when all slots are taken', () => {
      const projects: Record<string, { path: string; ports: { api: number; app: number }; slot: number }> = {};
      for (let i = 0; i < SLOT_MAX; i++) {
        projects[`p${i}`] = { path: `/${i}`, ports: portsForSlot(i), slot: i };
      }
      const registry = { projects, version: 1 as const };
      expect(() => allocateSlot('any', registry)).toThrow();
    });
  });

  describe('registry persistence', () => {
    const TEMP = join(tmpdir(), `lt-port-registry-test-${process.pid}`);
    const REGISTRY = join(TEMP, 'ports.json');
    const ORIGINAL = process.env.LT_PORTS_REGISTRY_PATH;

    beforeEach(() => {
      mkdirSync(TEMP, { recursive: true });
      process.env.LT_PORTS_REGISTRY_PATH = REGISTRY;
    });

    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.LT_PORTS_REGISTRY_PATH;
      else process.env.LT_PORTS_REGISTRY_PATH = ORIGINAL;
      if (existsSync(TEMP)) rmSync(TEMP, { force: true, recursive: true });
    });

    it('returns an empty registry when the file does not exist', () => {
      const r = loadRegistry();
      expect(r).toEqual({ projects: {}, version: 1 });
    });

    it('round-trips a registry through save + load', () => {
      const r = {
        projects: {
          crm: { path: '/x/crm', ports: portsForSlot(5), slot: 5 },
        },
        version: 1 as const,
      };
      saveRegistry(r);
      expect(loadRegistry()).toEqual(r);
      expect(existsSync(REGISTRY)).toBe(true);
    });

    it('falls back to an empty registry on corrupt JSON', () => {
      writeFileSync(REGISTRY, '{ not json');
      expect(loadRegistry()).toEqual({ projects: {}, version: 1 });
    });

    it('falls back to an empty registry on wrong schema version', () => {
      writeFileSync(REGISTRY, JSON.stringify({ projects: {}, version: 999 }));
      expect(loadRegistry()).toEqual({ projects: {}, version: 1 });
    });
  });

  describe('local state persistence', () => {
    const PROJECT = join(tmpdir(), `lt-local-state-test-${process.pid}`);

    beforeEach(() => {
      mkdirSync(PROJECT, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(PROJECT)) rmSync(PROJECT, { force: true, recursive: true });
    });

    it('returns null when no state file exists', () => {
      expect(loadLocalState(PROJECT)).toBeNull();
    });

    it('round-trips state through save + load', () => {
      const state = {
        pids: { api: 1234, app: 5678 },
        ports: { api: 3030, app: 3031 },
        startedAt: '2026-05-08T10:00:00.000Z',
      };
      saveLocalState(PROJECT, state);
      expect(loadLocalState(PROJECT)).toEqual(state);
      const written = readFileSync(localStatePath(PROJECT), 'utf8');
      expect(written.endsWith('\n')).toBe(true);
    });
  });

  describe('isPidAlive', () => {
    it('returns true for the current process', () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });

    it('returns false for an obviously-dead pid', () => {
      // PID 1 exists but a high random number very likely does not on a test machine.
      expect(isPidAlive(2147483647)).toBe(false);
    });

    it('refuses zero, negative, and non-integer pids', () => {
      expect(isPidAlive(0)).toBe(false);
      expect(isPidAlive(-1)).toBe(false);
      expect(isPidAlive(-process.pid)).toBe(false);
      expect(isPidAlive(1.5)).toBe(false);
      expect(isPidAlive(NaN)).toBe(false);
    });
  });

  describe('isValidPid', () => {
    it('accepts undefined', () => {
      expect(isValidPid(undefined)).toBe(true);
    });

    it('accepts a positive integer in range', () => {
      expect(isValidPid(1234)).toBe(true);
      expect(isValidPid(0x7fffffff)).toBe(true);
    });

    it('refuses values below 100, zero, negative numbers, and non-integers', () => {
      expect(isValidPid(0)).toBe(false);
      expect(isValidPid(50)).toBe(false);
      expect(isValidPid(99)).toBe(false);
      expect(isValidPid(-1)).toBe(false);
      expect(isValidPid(1.5)).toBe(false);
      expect(isValidPid(0x80000000)).toBe(false);
    });

    it('refuses non-numeric values', () => {
      expect(isValidPid('1234')).toBe(false);
      expect(isValidPid(null)).toBe(false);
      expect(isValidPid({})).toBe(false);
      expect(isValidPid([])).toBe(false);
    });
  });

  describe('clearLocalState', () => {
    const PROJECT = join(tmpdir(), `lt-clear-state-test-${process.pid}`);

    beforeEach(() => {
      mkdirSync(PROJECT, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(PROJECT)) rmSync(PROJECT, { force: true, recursive: true });
    });

    it('is a no-op when no state file exists', () => {
      clearLocalState(PROJECT);
      expect(existsSync(localStatePath(PROJECT))).toBe(false);
    });

    it('zeroes out an existing state file (does NOT delete)', () => {
      saveLocalState(PROJECT, {
        pids: { api: 1234, app: 5678 },
        ports: { api: 3030, app: 3031 },
        startedAt: '2026-05-08T10:00:00.000Z',
      });
      expect(existsSync(localStatePath(PROJECT))).toBe(true);

      clearLocalState(PROJECT);

      expect(existsSync(localStatePath(PROJECT))).toBe(true);
      const content = JSON.parse(readFileSync(localStatePath(PROJECT), 'utf8'));
      expect(content).toEqual({ pids: {}, ports: { api: 0, app: 0 }, startedAt: '' });
    });
  });

  describe('loadLocalState validation', () => {
    const PROJECT = join(tmpdir(), `lt-load-validation-test-${process.pid}`);

    beforeEach(() => {
      mkdirSync(join(PROJECT, '.lt-local'), { recursive: true });
    });

    afterEach(() => {
      if (existsSync(PROJECT)) rmSync(PROJECT, { force: true, recursive: true });
    });

    it('returns null when JSON is malformed', () => {
      writeFileSync(localStatePath(PROJECT), '{not json');
      expect(loadLocalState(PROJECT)).toBeNull();
    });

    it('returns null when pids contains a negative number', () => {
      writeFileSync(
        localStatePath(PROJECT),
        JSON.stringify({ pids: { api: -1 }, ports: { api: 3000, app: 3001 }, startedAt: '' }),
      );
      expect(loadLocalState(PROJECT)).toBeNull();
    });

    it('returns null when pids contains a system-range pid (< 100)', () => {
      writeFileSync(
        localStatePath(PROJECT),
        JSON.stringify({ pids: { api: 1 }, ports: { api: 3000, app: 3001 }, startedAt: '' }),
      );
      expect(loadLocalState(PROJECT)).toBeNull();
    });

    it('returns null when pids contains a string', () => {
      writeFileSync(
        localStatePath(PROJECT),
        JSON.stringify({ pids: { api: '1234' }, ports: { api: 3000, app: 3001 }, startedAt: '' }),
      );
      expect(loadLocalState(PROJECT)).toBeNull();
    });

    it('returns null when ports has wrong shape', () => {
      writeFileSync(
        localStatePath(PROJECT),
        JSON.stringify({ pids: {}, ports: 'broken', startedAt: '' }),
      );
      expect(loadLocalState(PROJECT)).toBeNull();
    });

    it('accepts a valid record', () => {
      writeFileSync(
        localStatePath(PROJECT),
        JSON.stringify({ pids: { api: 1234, app: 5678 }, ports: { api: 3000, app: 3001 }, startedAt: '2026-05-10T00:00:00Z' }),
      );
      expect(loadLocalState(PROJECT)).toEqual({
        pids: { api: 1234, app: 5678 },
        ports: { api: 3000, app: 3001 },
        startedAt: '2026-05-10T00:00:00Z',
      });
    });
  });

  describe('SLOT_PORT_RANGE_END', () => {
    it('matches SLOT_BASE_API + SLOT_MAX * SLOT_STEP', () => {
      expect(SLOT_PORT_RANGE_END).toBe(SLOT_BASE_API + SLOT_MAX * SLOT_STEP);
      expect(SLOT_PORT_RANGE_END).toBe(3900);
    });
  });
});
