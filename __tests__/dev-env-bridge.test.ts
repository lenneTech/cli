import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { clearEnvBridge, detectCaddyRootCa, envBridgePath, writeEnvBridge } from '../src/lib/dev-env-bridge';
import { DevEnv } from '../src/lib/dev-env';

const fakeDevEnv: DevEnv = {
  api: { internalPort: 4010, env: { PORT: '4010' } },
  app: {
    env: {
      API_URL: 'https://api.crm.localhost',
      APP_URL: 'https://crm.localhost',
      BASE_URL: 'https://api.crm.localhost',
      NSC__APP_URL: 'https://crm.localhost',
      NSC__BASE_URL: 'https://api.crm.localhost',
      NSC__MONGOOSE__URI: 'mongodb://127.0.0.1/crm-local',
      NUXT_API_URL: 'https://api.crm.localhost',
      NUXT_PUBLIC_API_PROXY: 'false',
      NUXT_PUBLIC_API_URL: 'https://api.crm.localhost',
      NUXT_PUBLIC_SITE_URL: 'https://crm.localhost',
      NUXT_PUBLIC_STORAGE_PREFIX: 'crm',
      PORT: '4011',
      SITE_URL: 'https://crm.localhost',
    },
    internalPort: 4011,
  },
};

describe('dev-env-bridge', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'lt-dev-bridge-'));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  describe('writeEnvBridge', () => {
    test('writes all expected URL keys', () => {
      const file = writeEnvBridge(project, fakeDevEnv, 'crm-local');
      expect(file).toBe(envBridgePath(project));
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('NUXT_PUBLIC_SITE_URL=https://crm.localhost');
      expect(content).toContain('NUXT_PUBLIC_API_URL=https://api.crm.localhost');
      expect(content).toContain('NUXT_PUBLIC_STORAGE_PREFIX=crm');
      expect(content).toContain('NSC__MONGOOSE__URI=mongodb://127.0.0.1/crm-local');
      expect(content).toContain('LT_DEV_ACTIVE=true');
      expect(content).toContain('LT_DEV_DB_NAME=crm-local');
    });

    test('exports legacy aliases API_URL + SITE_URL', () => {
      // Regression: projects that read `process.env.API_URL` directly
      // (no `NUXT_PUBLIC_` prefix) need the alias in the bridge too,
      // otherwise external tools picking up the bridge miss them.
      const file = writeEnvBridge(project, fakeDevEnv, 'crm-local');
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('API_URL=https://api.crm.localhost');
      expect(content).toContain('SITE_URL=https://crm.localhost');
    });

    test('idempotent: same content does not rewrite', () => {
      writeEnvBridge(project, fakeDevEnv, 'crm-local');
      const before = readFileSync(envBridgePath(project), 'utf8');
      writeEnvBridge(project, fakeDevEnv, 'crm-local');
      const after = readFileSync(envBridgePath(project), 'utf8');
      expect(after).toBe(before);
    });

    test('header marks the file as managed', () => {
      writeEnvBridge(project, fakeDevEnv);
      const content = readFileSync(envBridgePath(project), 'utf8');
      expect(content).toMatch(/^# Managed by `lt dev up`/);
    });

    test('skips empty values', () => {
      const env: DevEnv = {
        api: { env: { PORT: '4010' }, internalPort: 4010 },
        app: { env: { APP_URL: '', NUXT_PUBLIC_SITE_URL: 'https://x.localhost' }, internalPort: 4011 },
      };
      writeEnvBridge(project, env);
      const content = readFileSync(envBridgePath(project), 'utf8');
      expect(content).not.toContain('APP_URL=\n');
      expect(content).toContain('NUXT_PUBLIC_SITE_URL=https://x.localhost');
    });
  });

  describe('clearEnvBridge', () => {
    test('removes existing file', () => {
      writeEnvBridge(project, fakeDevEnv);
      expect(existsSync(envBridgePath(project))).toBe(true);
      expect(clearEnvBridge(project)).toBe(true);
      expect(existsSync(envBridgePath(project))).toBe(false);
    });

    test('no-op when file missing', () => {
      expect(clearEnvBridge(project)).toBe(false);
    });
  });

  describe('detectCaddyRootCa', () => {
    test('returns either a path or null without throwing', () => {
      const result = detectCaddyRootCa();
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });
});
