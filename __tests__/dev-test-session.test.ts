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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
  buildTestAppEnv,
  hasTestSession,
  resolveTestSession,
  shardReportDir,
  tearDownTestSession,
  TEST_INITIAL_ADMIN_ENV,
  TEST_NITRO_OUTPUT_DIR,
  TEST_NUXT_BUILD_DIR,
  testAppEntryCandidates,
  TestSessionLogger,
} from '../src/lib/dev-test-session';

const silentLog: TestSessionLogger = {
  dim: (s) => s,
  info: () => undefined,
  warn: () => undefined,
};

/**
 * The module under test, as source text.
 *
 * `bringUpTestSession` spawns real servers and reloads Caddy, so a few
 * invariants about HOW it wires its helpers can only be pinned statically. Read
 * once at module scope — two independent reads of the same file in sibling
 * `describe` blocks was a maintenance wrinkle, not two different facts.
 */
const source = readFileSync(join(__dirname, '..', 'src', 'lib', 'dev-test-session.ts'), 'utf8');

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

  // DEV-2715 — `lt dev test` and a parked `lt dev up` used to share
  // `projects/app/.nuxt`. `@nuxt/cli` takes its lock ON the build dir
  // (`acquireLock(nuxt.options.buildDir)`), so the test stack's `nuxt build`
  // aborted outright against a running dev server ("Another Nuxt dev is already
  // running") — the app never came up and every spec failed on a missing
  // selector, a failure that reads like broken specs but is pure infrastructure.
  // Giving the test stack its own build dir frees the lock and the writes.
  describe('DEV-2715 — the test stack gets its own Nuxt build dir', () => {
    test('the test build dir is distinct from BOTH the dev and the check one', () => {
      // `.nuxt` is what `nuxt dev` / the IDE use, `.nuxt-check` is the gate dir
      // (DEV-2708). Colliding with either resurrects a lock conflict, so pin the
      // value rather than merely asserting it is "set to something".
      expect(TEST_NUXT_BUILD_DIR).toBe('.nuxt-test');
      expect(TEST_NUXT_BUILD_DIR).not.toBe('.nuxt');
      expect(TEST_NUXT_BUILD_DIR).not.toBe('.nuxt-check');
    });

    test('buildTestAppEnv pins NUXT_BUILD_DIR and leaves every other var untouched', () => {
      // The app env carries the whole isolated stack (ports, URLs, proxy flag).
      // Rebuilding it instead of extending it would silently drop that.
      //
      // Asserted as "carries the base forward + pins this one var" rather than as
      // an exact-shape `toEqual`: the helper legitimately grew a second pin
      // (NITRO_OUTPUT_DIR, DEV-2724), and an exact match here would force every
      // future isolation knob to edit THIS test — where a green run would then
      // mean "the list was updated", not "nothing was lost". The exact shape is
      // pinned once, in the DEV-2724 block below.
      const base = { NUXT_PUBLIC_API_PROXY: 'false', NUXT_PUBLIC_SITE_URL: 'https://svl-test.localhost', PORT: '4501' };
      expect(buildTestAppEnv(base)).toMatchObject({ ...base, NUXT_BUILD_DIR: TEST_NUXT_BUILD_DIR });
    });

    test('an inherited NUXT_BUILD_DIR loses — the isolation is fail-closed', () => {
      // Deliberately NOT the "defaults first, explicit override wins" shape used
      // for TEST_INITIAL_ADMIN_ENV: there the override is a credential choice,
      // here it is the one thing that must hold. `buildDevEnv` seeds the app env
      // from `process.env`, so a shell that happens to export NUXT_BUILD_DIR
      // (e.g. left over from debugging a check run) would otherwise hand the test
      // stack the dev — or the gate — dir straight back.
      expect(buildTestAppEnv({ NUXT_BUILD_DIR: '.nuxt' }).NUXT_BUILD_DIR).toBe(TEST_NUXT_BUILD_DIR);
      expect(buildTestAppEnv({ NUXT_BUILD_DIR: '.nuxt-check' }).NUXT_BUILD_DIR).toBe(TEST_NUXT_BUILD_DIR);
    });

    test('does not mutate the env it was handed', () => {
      // The same object is passed to the API side and returned in the context;
      // mutating it in place would leak the test build dir into both.
      const base: NodeJS.ProcessEnv = { PORT: '4501' };
      buildTestAppEnv(base);
      expect(base).toEqual({ PORT: '4501' });
    });

    // `bringUpTestSession` spawns real servers and reloads Caddy, so it is not
    // unit-testable here (see this file's header). The assertions above prove the
    // helper in isolation — worth nothing unless the app path actually routes
    // through it. The two below pin that wiring statically, against the source.
    //
    // Deliberately NOT occurrence COUNTS. A `toHaveLength(1)` on
    // `devEnv.app.env` / `'.output/server/index.mjs'` was measured against a
    // mutation matrix: it produced 4 false failures on behaviour-neutral edits
    // (a renamed local, one extra legitimate read, a reflowed comment quoting the
    // path, extracting the list into a constant) while still MISSING the case
    // that matters most — handing a spawn site `env: process.env` passed every
    // count assertion. A count pins an invariant nobody agreed to; these two pin
    // the derivation and the absence of the known-bad spelling, which is all a
    // source-level check can honestly claim.
    test('no app process is started with the un-isolated dev env', () => {
      // `env: devEnv.app.env` is exactly the pre-fix shape: it inherits the
      // default build dir, so both `nuxt build` and the `nuxt dev` fallback take
      // the lock on `.nuxt`.
      expect(source).not.toMatch(/env:\s*devEnv\.app\.env/);
    });

    test('the app env is derived from the dev env via buildTestAppEnv', () => {
      // Pins the derivation itself. Without it, `env: appEnv` could refer to any
      // locally-built object and the assertion above would pass vacuously.
      expect(source).toMatch(/const\s+appEnv\s*=\s*buildTestAppEnv\(\s*devEnv\.app\.env\s*,?\s*\)/);
    });
  });

  // DEV-2724 — the OUTPUT dir is a second, independent axis. DEV-2715 split the
  // BUILD dir and that was enough to free the lock (`@nuxt/cli` locks the build
  // dir), but `.output/` stayed shared. For this stack that is not an edge case:
  // it serves the production bundle, so it runs a full `nuxt build` on EVERY run
  // and overwrites whatever a local `pnpm run build` — or a server started from
  // it — is using.
  describe('DEV-2724 — the test stack gets its own Nitro output dir', () => {
    test('the test output dir is distinct from the shared one', () => {
      expect(TEST_NITRO_OUTPUT_DIR).toBe('.output-test');
      expect(TEST_NITRO_OUTPUT_DIR).not.toBe('.output');
    });

    test('buildTestAppEnv pins NITRO_OUTPUT_DIR alongside NUXT_BUILD_DIR', () => {
      const base = { NUXT_PUBLIC_API_PROXY: 'false', PORT: '4501' };
      expect(buildTestAppEnv(base)).toEqual({
        ...base,
        NITRO_OUTPUT_DIR: TEST_NITRO_OUTPUT_DIR,
        NUXT_BUILD_DIR: TEST_NUXT_BUILD_DIR,
      });
    });

    test('an inherited NITRO_OUTPUT_DIR loses too — fail-closed, like the build dir', () => {
      // Same reasoning as the NUXT_BUILD_DIR case: `buildDevEnv` seeds the app env
      // from `process.env`, so an exported value would otherwise hand the test
      // stack the shared output tree straight back.
      expect(buildTestAppEnv({ NITRO_OUTPUT_DIR: '.output' }).NITRO_OUTPUT_DIR).toBe(TEST_NITRO_OUTPUT_DIR);
    });

    // THE trap of this ticket. Redirecting the build without redirecting the
    // lookup means the spawn finds no entry, silently falls back to `pnpm dev`
    // (slow, cold-compiles routes) — and that fallback is a second `nuxt dev`,
    // so it re-takes the build-dir lock the previous ticket just freed. The
    // failure is invisible: the suite still runs, just slower and unisolated.
    describe('testAppEntryCandidates', () => {
      test('looks in the isolated output dir', () => {
        expect(testAppEntryCandidates()).toContain(`${TEST_NITRO_OUTPUT_DIR}/server/index.mjs`);
      });

      test('still falls back to the shared .output', () => {
        // A project whose `nuxt.config.ts` does not (yet) read NITRO_OUTPUT_DIR
        // ignores the env var and keeps building into `.output`. Dropping this
        // candidate would push every not-yet-updated project onto the slow
        // `pnpm dev` fallback.
        expect(testAppEntryCandidates()).toContain('.output/server/index.mjs');
      });

      test('prefers the isolated dir over the shared one', () => {
        // Order is load-bearing, not cosmetic: `.find(existsSync)` takes the
        // FIRST hit, and a stale `.output/` from an earlier local build usually
        // exists. With the shared dir first, an updated project would serve that
        // stale bundle while its fresh build sat unused in `.output-test`.
        const candidates = testAppEntryCandidates();
        expect(candidates.indexOf(`${TEST_NITRO_OUTPUT_DIR}/server/index.mjs`)).toBeLessThan(candidates.indexOf('.output/server/index.mjs'));
      });
    });

    test('the spawn actually uses the candidate list', () => {
      // The helper above is worth nothing unless the app path routes through it.
      // Pinned statically so a future edit cannot re-inline a bare '.output'.
      // No occurrence COUNT here — the previous `toHaveLength(1)` also matched
      // the path inside prose comments, so reflowing one turned the suite red
      // without any behaviour change (measured). The derivation is the invariant.
      expect(source).toMatch(/const\s+appEntry\s*=\s*testAppEntryCandidates\(\)/);
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
