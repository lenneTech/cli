/**
 * Tests for the pure / observable parts of `dev-test-session`.
 *
 * The full `bringUpTestSession` is not unit-tested here — it spawns real
 * dev servers and reloads Caddy, which only makes sense in a manual
 * integration run (see `dev-service-e2e.manual.ts` for the existing
 * pattern). Everything that can be observed without those side effects
 * is covered: identity + db-name resolution, `hasTestSession` toggling,
 * and the idempotent / residue-free behaviour of `tearDownTestSession`
 * across registry, session file, and env bridge.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Redirect side-effecting paths BEFORE importing the modules under test.
const REGISTRY_TMP = mkdtempSync(join(tmpdir(), 'lt-dev-test-session-reg-'));
const CADDYFILE_TMP = join(REGISTRY_TMP, 'Caddyfile');
process.env.LT_DEV_REGISTRY_PATH = join(REGISTRY_TMP, 'projects.json');
process.env.LT_DEV_CADDYFILE = CADDYFILE_TMP;

import { writeEnvBridge } from '../src/lib/dev-env-bridge';
import { buildTestIdentity, DevIdentity } from '../src/lib/dev-identity';
import { pickPackageManager } from '../src/lib/dev-package-manager';
import { DevProjectLayout } from '../src/lib/dev-project';
import { loadRegistry, saveRegistry, saveSession, TEST_SESSION_FILE } from '../src/lib/dev-state';
import {
  buildShardPlaywrightInvocation,
  hasTestSession,
  resolveTestSession,
  shardReportDir,
  tearDownTestSession,
  TEST_INITIAL_ADMIN_ENV,
  TestSessionLogger,
} from '../src/lib/dev-test-session';

const silentLog: TestSessionLogger = {
  dim: (s) => s,
  info: () => undefined,
  warn: () => undefined,
};

describe('dev-test-session', () => {
  let projectRoot: string;
  let layout: DevProjectLayout;
  let baseIdentity: DevIdentity;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lt-dev-test-session-proj-'));
    // Reset registry between tests.
    writeFileSync(process.env.LT_DEV_REGISTRY_PATH!, JSON.stringify({ projects: {}, version: 1 }));

    layout = {
      apiDir: join(projectRoot, 'projects', 'api'),
      appDir: join(projectRoot, 'projects', 'app'),
      root: projectRoot,
      workspace: true,
    };
    baseIdentity = {
      root: projectRoot,
      slug: 'svl',
      subdomains: {
        api: { hostname: 'api.svl.localhost', isPrimaryApp: false, subdir: 'projects/api' },
        app: { hostname: 'svl.localhost', isPrimaryApp: true, subdir: 'projects/app' },
      },
    };
  });

  afterEach(() => {
    rmSync(projectRoot, { force: true, recursive: true });
  });

  afterAll(() => {
    rmSync(REGISTRY_TMP, { force: true, recursive: true });
  });

  describe('resolveTestSession', () => {
    test('test identity + dbName fall back to <slug>-test', () => {
      // apiDir does not exist on disk → deriveDbName falls back to <slug>-local
      // → deriveTestDbName strips -local and appends -test.
      const { dbName, testIdentity } = resolveTestSession({ ...layout, apiDir: null }, baseIdentity);
      expect(testIdentity.slug).toBe('svl-test');
      expect(testIdentity.subdomains.app.hostname).toBe('svl-test.localhost');
      expect(dbName).toBe('svl-test');
    });

    test('honors a custom dbName from config.env.ts', () => {
      const apiSrc = join(projectRoot, 'src');
      require('fs').mkdirSync(apiSrc, { recursive: true });
      writeFileSync(join(apiSrc, 'config.env.ts'), `    dbName: 'custom-name-local',\n`);
      // Point apiDir at the synthetic project root we just populated.
      const customLayout: DevProjectLayout = { ...layout, apiDir: projectRoot };
      const { dbName } = resolveTestSession(customLayout, baseIdentity);
      expect(dbName).toBe('custom-name-test');
    });

    test('per-ticket devDbName override → test DB derived from the ticket DB (+ shard suffix)', () => {
      // `lt ticket test` passes the ticket dev DB so each ticket gets its OWN
      // test DB (never shared between tickets), and sharding still appends `-<i>`.
      const a = resolveTestSession(layout, baseIdentity, undefined, 'svl-sports-system-2200');
      expect(a.dbName).toBe('svl-sports-system-2200-test');
      const b = resolveTestSession(layout, baseIdentity, 2, 'svl-sports-system-2200');
      expect(b.dbName).toBe('svl-sports-system-2200-test-2');
    });
  });

  describe('TEST_INITIAL_ADMIN_ENV', () => {
    // Drift guard: `lt dev test` seeds the isolated test DB with these exact
    // NSC__… admin vars so a fresh template project's auth E2E specs run locally
    // against a set-up system — the same values the lt-monorepo CI uses. If the
    // template CI credentials change, this must change with them (CI ↔ local).
    test('matches the lt-monorepo CI initial-admin credentials exactly', () => {
      expect(TEST_INITIAL_ADMIN_ENV).toEqual({
        NSC__SYSTEM_SETUP__INITIAL_ADMIN__EMAIL: 'ci-admin@test.com',
        NSC__SYSTEM_SETUP__INITIAL_ADMIN__NAME: 'CI Admin',
        NSC__SYSTEM_SETUP__INITIAL_ADMIN__PASSWORD: 'CiThrowawayAdmin123!',
      });
    });
  });

  describe('hasTestSession', () => {
    test('false by default', () => {
      expect(hasTestSession(projectRoot)).toBe(false);
    });
    test('true after saving a test session', () => {
      saveSession(
        projectRoot,
        { pids: { api: 4_000_000, app: 4_000_001 }, startedAt: '2026-06-05T00:00:00Z' },
        TEST_SESSION_FILE,
      );
      expect(hasTestSession(projectRoot)).toBe(true);
    });
    test('does not leak across the dev session file', () => {
      // A normal `lt dev up` session must NOT make hasTestSession() truthy.
      saveSession(projectRoot, { pids: { api: 4_000_002 }, startedAt: '2026-06-05T00:00:00Z' });
      expect(hasTestSession(projectRoot)).toBe(false);
    });
  });

  describe('tearDownTestSession — idempotent + residue-free', () => {
    test('no-op when nothing exists (silent)', async () => {
      const result = await tearDownTestSession(layout, baseIdentity, silentLog, { silent: true });
      expect(result.stopped).toEqual([]);
      expect(hasTestSession(projectRoot)).toBe(false);
    });

    test('removes session file, registry entry, and env bridge', async () => {
      // Seed: session file, registry entry, env bridge.
      saveSession(
        projectRoot,
        { pids: { api: 4_000_010, app: 4_000_011 }, startedAt: '2026-06-05T00:00:00Z' },
        TEST_SESSION_FILE,
      );

      const testId = buildTestIdentity(baseIdentity);
      const reg = loadRegistry();
      reg.projects[testId.slug] = {
        dbName: 'svl-test',
        internalPorts: { api: 4500, app: 4501 },
        path: projectRoot,
        subdomains: { api: testId.subdomains.api.hostname, app: testId.subdomains.app.hostname },
      };
      saveRegistry(reg);

      writeEnvBridge(
        projectRoot,
        {
          api: { env: { PORT: '4500' }, internalPort: 4500 },
          app: { env: { APP_URL: 'https://svl-test.localhost' }, internalPort: 4501 },
        },
        'svl-test',
        '.env.test',
      );
      expect(existsSync(join(projectRoot, '.lt-dev', '.env.test'))).toBe(true);

      // Act — silent so the missing real caddy daemon never warns.
      const result = await tearDownTestSession(layout, baseIdentity, silentLog, { silent: true });

      // Both PIDs report back as "already dead" (we deliberately used bogus PIDs).
      expect(result.stopped).toEqual(
        expect.arrayContaining([
          expect.stringContaining('api (pid 4000010, already dead)'),
          expect.stringContaining('app (pid 4000011, already dead)'),
        ]),
      );
      expect(hasTestSession(projectRoot)).toBe(false);
      expect(loadRegistry().projects[testId.slug]).toBeUndefined();
      expect(existsSync(join(projectRoot, '.lt-dev', '.env.test'))).toBe(false);
    });

    test('second call is a clean no-op (idempotent)', async () => {
      saveSession(projectRoot, { pids: { api: 4_000_020 }, startedAt: '2026-06-05T00:00:00Z' }, TEST_SESSION_FILE);
      await tearDownTestSession(layout, baseIdentity, silentLog, { silent: true });
      const second = await tearDownTestSession(layout, baseIdentity, silentLog, { silent: true });
      expect(second.stopped).toEqual([]);
    });

    test('does not touch the dev session or its registry entry', async () => {
      // Seed a normal dev session + dev registry entry — neither must be removed.
      saveSession(projectRoot, { pids: { api: 4_000_030 }, startedAt: '2026-06-05T00:00:00Z' });
      const reg = loadRegistry();
      reg.projects[baseIdentity.slug] = {
        dbName: 'svl-local',
        internalPorts: { api: 4000, app: 4001 },
        path: projectRoot,
        subdomains: { api: 'api.svl.localhost', app: 'svl.localhost' },
      };
      saveRegistry(reg);

      await tearDownTestSession(layout, baseIdentity, silentLog, { silent: true });

      // Dev side completely untouched.
      const after = loadRegistry();
      expect(after.projects[baseIdentity.slug]).toBeDefined();
      expect(after.projects[baseIdentity.slug].dbName).toBe('svl-local');
    });
  });

  describe('buildShardPlaywrightInvocation (DEV-2676 skip-gate regression)', () => {
    // Both fixtures pass an EXPLICIT env so the resolution is hermetic: a runner
    // shell that exports the documented `LT_PM_BIN` / `LT_PNPM_BIN` overrides must
    // not flip the pnpm fixture off its fallback (no lockfile + empty env → pnpm).
    const pnpm = pickPackageManager('/does-not-exist', {} as NodeJS.ProcessEnv);
    const npm = pickPackageManager('/does-not-exist', { LT_PM_BIN: 'npm' } as NodeJS.ProcessEnv);

    test('NEVER injects a --reporter flag — that would replace the project reporter list', () => {
      // The whole ticket: a CLI `--reporter` REPLACES playwright.config.ts's
      // `reporter` array, dropping the DEV-2098 no-skips release gate. The shard
      // path must therefore leave the reporter to the project config.
      const { args } = buildShardPlaywrightInvocation(pnpm, 1, 2, [], '/tmp/report');
      // `.startsWith('--reporter')` subsumes the exact old `--reporter=line` string.
      expect(args.some((a) => a.startsWith('--reporter'))).toBe(false);
    });

    test('pnpm: exec playwright test --shard=i/N with forwarded args, no reporter', () => {
      const { args } = buildShardPlaywrightInvocation(pnpm, 2, 3, ['forms-audit', '--grep', 'E32'], '/tmp/r');
      expect(args).toEqual(['exec', 'playwright', 'test', '--shard=2/3', 'forms-audit', '--grep', 'E32']);
    });

    test('npm: keeps the `--` separator before the binary, still no reporter', () => {
      const { args } = buildShardPlaywrightInvocation(npm, 1, 2, [], '/tmp/r');
      expect(args).toEqual(['exec', '--', 'playwright', 'test', '--shard=1/2']);
      expect(args.some((a) => a.startsWith('--reporter'))).toBe(false);
    });

    test('isolates the HTML reporter per shard + forces open:never (shard-safe, generic no-op)', () => {
      // The one config reporter that is shard-hostile: N shards share one project
      // dir and would all write `playwright-report/`. A per-shard output dir +
      // `open: never` keep them from racing; both env vars are inert when the
      // project has no HTML reporter.
      const { env } = buildShardPlaywrightInvocation(pnpm, 4, 4, [], '/root/.lt-dev/shard.4.playwright-report');
      expect(env.PLAYWRIGHT_HTML_OPEN).toBe('never');
      expect(env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBe('/root/.lt-dev/shard.4.playwright-report');
      // Pin the env to EXACTLY these two keys: it is spread into the real shard
      // process, so a stray key would silently shadow one of its vars.
      expect(Object.keys(env).sort()).toEqual(['PLAYWRIGHT_HTML_OPEN', 'PLAYWRIGHT_HTML_OUTPUT_DIR']);
    });

    test('npm: forwarded args survive verbatim AFTER the `--` separator, in order', () => {
      const { args } = buildShardPlaywrightInvocation(npm, 2, 2, ['forms-audit', '--grep', 'E32'], '/tmp/r');
      expect(args).toEqual(['exec', '--', 'playwright', 'test', '--shard=2/2', 'forms-audit', '--grep', 'E32']);
    });

    test('shardReportDir gives each shard its OWN report dir — the isolation guarantee', () => {
      // The per-shard-distinctness (which buildShardPlaywrightInvocation only
      // echoes) lives here, so prove it directly: same root, different index →
      // different dir. This is what stops N shards racing on one report folder.
      expect(shardReportDir('/root', 1)).toBe('/root/.lt-dev/shard.1.playwright-report');
      expect(shardReportDir('/root', 1)).not.toBe(shardReportDir('/root', 2));
    });
  });
});
