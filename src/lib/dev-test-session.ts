/**
 * Ephemeral, isolated test session for `lt dev test`.
 *
 * Brings up a SECOND, fully separate stack (own URLs, own internal ports,
 * own Caddy block, own database) that runs PARALLEL to — and never touches —
 * the developer's `lt dev up` session. Used to run the Playwright E2E suite
 * against a clean, dedicated database so a developer can keep working in their
 * own environment while tests run, and so a test run never pollutes dev data.
 *
 * Topology (for slug `svl`):
 *   - dev session  : svl.localhost / api.svl.localhost   → db `<…>-local`
 *   - test session : svl-test.localhost / api.svl-test.… → db `<…>-test`
 *
 * Both halves run BUILT for speed + prod-fidelity: the API COMPILED (`node dist`,
 * ts-node intermittently dies mid-run) and the App as the production Nitro output
 * (`nuxt build` → `node .output/server/index.mjs`, no Vite cold-compile). Each
 * falls back to its dev runner (`pnpm start` / `pnpm dev`) when no build output is
 * found. bringUp waits for a real 2xx on the API `/meta` before returning so the
 * suite never starts against a not-yet-serving API.
 *
 * Lifecycle: `bringUpTestSession` → run Playwright → `tearDownTestSession`.
 * Teardown is idempotent and residue-free (processes, Caddy block, env bridge,
 * session file, registry entry), so a stale session is always safely reclaimed.
 */
import { existsSync, readdirSync } from 'fs';
import { cpus, totalmem } from 'os';
import { join } from 'path';

import { reloadCaddy, removeProjectBlock, upsertProjectBlock } from './caddy';
import { buildDevEnv } from './dev-env';
import { clearEnvBridge, writeEnvBridge } from './dev-env-bridge';
import { buildTestIdentity, DevIdentity } from './dev-identity';
import { type PackageManagerCommand, pickPackageManager } from './dev-package-manager';
import { autoPatch } from './dev-patches';
import {
  listenSnapshot,
  runChildInherit,
  runChildToFile,
  spawnDetached,
  terminateProcessGroup,
  waitForHttp,
} from './dev-process';
import { deriveDbName, deriveTestDbName, DevProjectLayout } from './dev-project';
import {
  allocateInternalPort,
  clearSession,
  isPidAlive,
  loadRegistry,
  loadSession,
  saveRegistry,
  saveSession,
  takenInternalPorts,
  TEST_SESSION_FILE,
  withRegistryLock,
} from './dev-state';

/** Per-bring-up options. `shardIndex` selects an isolated shard stack; `skipBuild` reuses an existing build. */
export interface BringUpOptions {
  /** Override the dev DB the test DB is derived from (per-ticket isolation). */
  devDbName?: string;
  shardIndex?: number;
  skipBuild?: boolean;
}

/** Result of a successful bring-up. */
export interface TestSessionContext {
  apiUrl: string;
  /** The App-process env (URLs, CA, flags) — pass this (plus MONGO_URI) to the Playwright child. */
  appEnv: NodeJS.ProcessEnv;
  appUrl: string;
  dbName: string;
  pids: { api?: number; app?: number };
  testIdentity: DevIdentity;
}

/** Minimal logger so this module integrates with the gluegun print toolbox. */
export interface TestSessionLogger {
  dim: (msg: string) => string;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const TEST_API_LOG = 'api.test.log';
const TEST_APP_LOG = 'app.test.log';
const TEST_BRIDGE_FILE = '.env.test';
/** Internal port band for the test stack — distinct from the dev band (4000+). */
const TEST_PORT_BASE = 4500;

/**
 * Heuristic for the default local shard count (`--shard auto` / bare `--shard`).
 *
 * Unlike CI — where each shard gets its OWN container (CPU + RAM), so N is just
 * the runner-matrix width — local shards all share ONE machine: every shard runs
 * a built Nuxt/Nitro server + headless Chromium + a compiled API, which together
 * peak at ~2 PERFORMANCE cores during SSR render. The catch is headroom: once the
 * shards' peak demand reaches the perf-core count there is nothing left for the
 * OS / mongod / orchestrator, SSR slows 2-3x, and timing-sensitive navigations
 * FAIL no matter how generous their timeout (true over-subscription).
 *
 * Measured on an M2 Max (8 perf + 4 eff cores, 12 logical) on a heavy built-SSR
 * suite: N=2 → 7.4 min, 0 failures (stable); N=3 → 8.7 min, flaky; N=4 → 6-10 min
 * (high variance), flaky. So the stable optimum is ~perfCores/4 — half the perf
 * cores busy, half free as headroom. On Apple silicon ~2/3 of logical cores are
 * perf cores, so `logical/6 ≈ perfCores/4`. This default deliberately FAVOURS a
 * green, repeatable run over the fastest-on-paper N. Cap by RAM (~4 GB/shard),
 * clamp to [2, 8].
 *
 * A LIGHTER suite (no built SSR, fast tests) or a bigger box can take more —
 * override with an explicit `--shard N`. Always measure N vs N±1 (wall-clock AND
 * flakes) to tune. Higher N also needs generous navigation timeouts under load
 * (see the project's shard-aware `LT_DEV_TEST_SHARDS` timeout handling).
 */
export function autoShardCount(): number {
  const logical = cpus().length || 4;
  const byCpu = Math.floor(logical / 6);
  const byRam = Math.floor(totalmem() / 1024 ** 3 / 4);
  return Math.max(2, Math.min(byCpu, byRam, 8));
}

/**
 * Bring up the isolated test stack. Tears down any stale test session first,
 * so this is safe to call even if a previous run crashed.
 */
export async function bringUpTestSession(
  layout: DevProjectLayout,
  baseIdentity: DevIdentity,
  log: TestSessionLogger,
  opts: BringUpOptions = {},
): Promise<TestSessionContext> {
  const { devDbName, shardIndex, skipBuild } = opts;
  const names = testStackNames(shardIndex);
  const { dbName, testIdentity } = resolveTestSession(layout, baseIdentity, shardIndex, devDbName);

  // Always start from a clean slate — reclaim a stale/crashed test session.
  await tearDownTestSession(layout, baseIdentity, log, { shardIndex, silent: true });

  // Self-heal legacy hardcoded ports BEFORE the build below — the test API runs
  // COMPILED (`node dist/...`), so config.env.ts must already honour the injected
  // `PORT` or the compiled bundle binds 3000 and misses Caddy. Belt-and-suspenders
  // for a project that never ran `lt dev up` first; idempotent and only ever
  // touches the three configs (never CLAUDE.md), so it is ticket-safe. Mirrors the
  // self-heal in `lt dev up` (see commands/dev/up.ts).
  {
    const filesToPatch: string[] = [];
    if (layout.apiDir) {
      const apiCfg = join(layout.apiDir, 'src', 'config.env.ts');
      if (existsSync(apiCfg)) filesToPatch.push(apiCfg);
    }
    if (layout.appDir) {
      for (const rel of ['nuxt.config.ts', 'playwright.config.ts']) {
        const f = join(layout.appDir, rel);
        if (existsSync(f)) filesToPatch.push(f);
      }
    }
    for (const r of filesToPatch.map((f) => autoPatch(f))) {
      if (r.patched) log.info(`patched ${r.replacements}× in ${r.file} (env-aware ports for lt dev test)`);
    }
  }

  // Allocate internal ports AND reserve them in the registry ATOMICALLY, under a
  // cross-process lock — so two parallel `lt dev test` runs (different ticket
  // worktrees) can never read the registry, pick the same free ports, and both
  // try to bind them during the long build window (the port-allocation race).
  // The lock is held ONLY for this fast section; the build below runs unlocked +
  // fully in parallel. Allocation avoids every other registry entry (dev session
  // + sibling shards) plus anything currently listening.
  let apiPort: number | undefined;
  let appPort: number | undefined;
  await withRegistryLock(async () => {
    const reg = loadRegistry();
    const taken = takenInternalPorts(reg, testIdentity.slug);
    apiPort = layout.apiDir ? allocateInternalPort(TEST_PORT_BASE, taken) : undefined;
    if (apiPort) taken.add(apiPort);
    appPort = layout.appDir ? allocateInternalPort(TEST_PORT_BASE, taken) : undefined;

    const portsToCheck = [apiPort, appPort].filter((p): p is number => typeof p === 'number');
    const snap = await listenSnapshot(portsToCheck);
    for (const p of portsToCheck) {
      const r = snap.get(p);
      if (r) throw new Error(`test internal port ${p} already in use by ${r.command} (pid ${r.pid}).`);
    }

    // Reserve immediately (still under the lock) so a concurrent run sees these
    // ports as taken. PIDs are written to the session file after spawn, below.
    const subdomainMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(testIdentity.subdomains)) subdomainMap[k] = v.hostname;
    reg.projects[testIdentity.slug] = {
      dbName,
      internalPorts: { api: apiPort, app: appPort },
      lastUsedAt: new Date().toISOString(),
      path: layout.root,
      subdomains: subdomainMap,
    };
    saveRegistry(reg);
  });

  // Caddy block for the test URLs (slug-keyed → no cross-stack conflict; safe
  // outside the lock).
  const routes = [];
  if (testIdentity.subdomains.api && apiPort)
    routes.push({ hostname: testIdentity.subdomains.api.hostname, upstreamPort: apiPort });
  if (testIdentity.subdomains.app && appPort)
    routes.push({ hostname: testIdentity.subdomains.app.hostname, upstreamPort: appPort });
  if (routes.length === 0) throw new Error('test session has no subdomains to expose (need an app project).');
  upsertProjectBlock(testIdentity.slug, routes);
  const reload = await reloadCaddy();
  if (!reload.ok) throw new Error(`caddy reload failed:\n${reload.stderr}`);

  const apiUrl = testIdentity.subdomains.api ? `https://${testIdentity.subdomains.api.hostname}` : '';
  const appUrl = testIdentity.subdomains.app ? `https://${testIdentity.subdomains.app.hostname}` : '';

  log.info('');
  log.info(`Starting isolated test stack "${testIdentity.slug}"`);
  if (appUrl) log.info(`  app: ${appUrl}  →  127.0.0.1:${appPort}`);
  if (apiUrl) log.info(`  api: ${apiUrl}  →  127.0.0.1:${apiPort}`);
  log.info(`  db:  mongodb://127.0.0.1/${dbName}  (reset before the suite by Playwright global-setup)`);
  log.info('');

  const devEnv = buildDevEnv({
    apiInternalPort: apiPort ?? 0,
    appInternalPort: appPort ?? 0,
    baseEnv: process.env,
    dbName,
    identity: testIdentity,
  });

  const pids: { api?: number; app?: number } = {};

  // --- API: compiled (`node dist`) for stability; fall back to the project's
  // own dev start script. `skipBuild` (sibling shards) reuses the dist the
  // first shard produced. Per-component PM detection mirrors `lt dev up`:
  // a monorepo with an npm api and a pnpm app must drive each correctly. ---
  if (layout.apiDir && apiPort) {
    const apiPm = pickPackageManager(layout.apiDir);
    let build: null | number = 0;
    if (!skipBuild) {
      log.info(log.dim('Building API (compiled, for stable long runs) …'));
      build = await runChildInherit(apiPm.bin, apiPm.runScript('build'), { cwd: layout.apiDir, env: process.env });
    }
    const entry = ['dist/src/main.js', 'dist/main.js']
      .map((rel) => join(layout.apiDir as string, rel))
      .find((p) => existsSync(p));
    const apiEnv = { ...devEnv.api.env, NODE_ENV: 'local' };
    let apiSpawn: ReturnType<typeof spawnDetached>;
    if (build === 0 && entry) {
      apiSpawn = spawnDetached('node', [entry], {
        cwd: layout.apiDir,
        env: apiEnv,
        logFile: join(layout.root, '.lt-dev', names.apiLog),
      });
    } else {
      log.warn(`compiled API not available — falling back to \`${apiPm.bin} start\` (ts-node).`);
      apiSpawn = spawnDetached(apiPm.bin, apiPm.runScript('start'), {
        cwd: layout.apiDir,
        env: apiEnv,
        logFile: join(layout.root, '.lt-dev', names.apiLog),
      });
    }
    if (apiSpawn) pids.api = apiSpawn.pid;
  }

  // --- App: BUILT (`nuxt build` → `node .output/server/index.mjs`) for speed +
  // prod-fidelity; fall back to the Nuxt dev server when no build output exists.
  // The built server has no Vite cold-compile (which dominates a dev-mode suite
  // — ~84% of runtime) and runs the SAME production bundle a deployment ships.
  // buildDevEnv sets NUXT_PUBLIC_API_PROXY=false, so the built app talks
  // cross-origin to the test API exactly like prod (the injected session cookie
  // must be a cross-subdomain DOMAIN cookie — see the project's parseCookieHeader).
  // Rebuilt every run so the suite never hits stale code (no build-skip / reuse). ---
  if (layout.appDir && appPort) {
    const appPm = pickPackageManager(layout.appDir);
    let appBuild: null | number = 0;
    if (!skipBuild) {
      log.info(log.dim('Building App (nuxt build, for speed + prod-fidelity) …'));
      appBuild = await runChildInherit(appPm.bin, appPm.runScript('build'), {
        cwd: layout.appDir,
        env: devEnv.app.env,
      });
    }
    const appEntry = ['.output/server/index.mjs']
      .map((rel) => join(layout.appDir as string, rel))
      .find((p) => existsSync(p));
    let appSpawn: ReturnType<typeof spawnDetached>;
    if (appBuild === 0 && appEntry) {
      appSpawn = spawnDetached('node', [appEntry], {
        cwd: layout.appDir,
        env: devEnv.app.env,
        logFile: join(layout.root, '.lt-dev', names.appLog),
      });
    } else {
      log.warn(`built app not available — falling back to \`${appPm.bin} dev\` (slower: cold-compiles routes).`);
      appSpawn = spawnDetached(appPm.bin, appPm.runScript('dev'), {
        cwd: layout.appDir,
        env: devEnv.app.env,
        logFile: join(layout.root, '.lt-dev', names.appLog),
      });
    }
    if (appSpawn) pids.app = appSpawn.pid;
  }

  // Persist the session (PIDs are known now). The registry entry (ports) was
  // already reserved BEFORE the build, above, to avoid a concurrent-allocation
  // race between parallel ticket test runs.
  saveSession(layout.root, { pids, startedAt: new Date().toISOString() }, names.sessionFile);

  // ENV bridge for external tooling (kept separate from the dev `.env`).
  writeEnvBridge(layout.root, devEnv, dbName, names.bridgeFile);

  // Wait for the test App to answer (best-effort).
  if (appUrl) {
    log.info(log.dim(`Waiting for ${appUrl} …`));
    await waitForHttp(appUrl, 90_000);
  }
  // Wait for the test API to actually SERVE (real 2xx on /meta) before handing
  // off to Playwright. Previously bringUp only waited for the App, so a compiled
  // API still connecting to Mongo made the first specs skip via the suite's
  // `ensureApiReachableOrSkip` guard (the API-readiness race). A strict 2xx is
  // required: Caddy answers 502 while its upstream is still booting, which the
  // default (lenient) predicate would accept as "up".
  if (apiUrl) {
    log.info(log.dim(`Waiting for ${apiUrl}/meta …`));
    const apiReady = await waitForHttp(`${apiUrl}/meta`, 120_000, (status) => status >= 200 && status < 300);
    if (!apiReady) log.warn(`Test API did not answer 2xx on ${apiUrl}/meta within 120s — the first specs may skip.`);
  }

  return { apiUrl, appEnv: devEnv.app.env, appUrl, dbName, pids, testIdentity };
}

/** True when a test session file exists (used by status/down). */
export function hasTestSession(root: string): boolean {
  return loadSession(root, TEST_SESSION_FILE) !== null;
}

/** Build the dedicated test identity + test DB name for a project. */
export function resolveTestSession(
  layout: DevProjectLayout,
  baseIdentity: DevIdentity,
  shardIndex?: number,
  devDbName?: string,
): {
  dbName: string;
  testIdentity: DevIdentity;
} {
  const names = testStackNames(shardIndex);
  const testIdentity = buildTestIdentity(baseIdentity, names.identitySuffix);
  // For a ticket worktree the caller passes the ticket dev DB (e.g.
  // `svl-sports-system-2200`), so each ticket's test DB is its own
  // (`…-2200-test[-<shard>]`) and tickets never share a test database.
  const baseDb = devDbName ?? deriveDbName(layout.apiDir, baseIdentity.slug);
  const dbName = deriveTestDbName(baseDb) + names.dbSuffix;
  return { dbName, testIdentity };
}

/**
 * Run the suite SHARDED across `total` fully-isolated stacks in parallel — the
 * local equivalent of the CI `parallel: N` + `--shard=i/N` matrix, but on one
 * machine: each shard gets its own URLs/ports/Caddy block AND its own DB
 * (`<…>-test-<i>`), so there is zero cross-shard data contention (the reason
 * in-process `workers > 1` against a single stack produces false results —
 * `cleanupTestEntities` / "pick any active season" collide).
 *
 * The first shard builds the API + App; siblings reuse that build (`skipBuild`),
 * since the bundles are shard-agnostic (URLs come from runtime env). Stacks are
 * brought up sequentially (builds + Caddy reloads serialise cleanly), then the
 * N Playwright `--shard=i/N` processes run CONCURRENTLY, each against its own
 * stack, output captured to `.lt-dev/shard.<i>.test.log`. Returns 0 iff every
 * shard passed. Teardown is the caller's responsibility (so `--keep` works).
 */
export async function runShardedTestSession(
  layout: DevProjectLayout,
  baseIdentity: DevIdentity,
  log: TestSessionLogger,
  opts: { devDbName?: string; forwarded: string[]; pm: PackageManagerCommand; total: number },
): Promise<number> {
  const total = Math.max(2, Math.floor(opts.total));
  const contexts: Array<{ ctx: TestSessionContext; index: number }> = [];

  // Bring up the N isolated stacks sequentially (shard 1 builds; 2..N reuse).
  for (let index = 1; index <= total; index++) {
    log.info('');
    log.info(`▶ shard ${index}/${total}: bringing up isolated stack …`);
    const ctx = await bringUpTestSession(layout, baseIdentity, log, {
      devDbName: opts.devDbName,
      shardIndex: index,
      skipBuild: index > 1,
    });
    contexts.push({ ctx, index });
  }

  // Run the N Playwright shards CONCURRENTLY, each against its own stack/DB.
  log.info('');
  log.info(`Running ${total} Playwright shards in parallel (one isolated stack each) …`);
  const appDir = layout.appDir as string;
  const results = await Promise.all(
    contexts.map(async ({ ctx, index }) => {
      // `LT_DEV_TEST_SHARDS` signals to the project's playwright.config that the
      // suite runs under concurrent sharded load, so it can relax navigation /
      // test timeouts (N built SSR servers + N Chromium saturate the CPU and slow
      // every navigation) without loosening them for serial runs.
      const env: NodeJS.ProcessEnv = {
        ...ctx.appEnv,
        LT_DEV_TEST_SHARDS: String(total),
        MONGO_URI: `mongodb://127.0.0.1/${ctx.dbName}`,
      };
      const logFile = join(layout.root, '.lt-dev', `shard.${index}.test.log`);
      // Invoke Playwright DIRECTLY via the manager's `exec` (NOT `<pm> run
      // test:e2e -- …`): forwarding option flags through `<pm> run`'s `--`
      // is unreliable — pnpm passed the separator on to Playwright, which
      // then read `--shard` / `--reporter` as file FILTERS (not options) →
      // every shard ran the whole suite. `<pm> exec` hands args straight
      // to the binary (mirrors CI); the helper inserts `--` for npm so
      // those flags don't get re-parsed as npm's own.
      const args = opts.pm.exec('playwright', [
        'test',
        `--shard=${index}/${total}`,
        '--reporter=line',
        ...opts.forwarded,
      ]);
      const code = await runChildToFile(opts.pm.bin, args, { cwd: appDir, env, logFile });
      return { code, index, logFile };
    }),
  );

  // Aggregate per-shard exit codes into a single result.
  let failed = 0;
  log.info('');
  for (const r of results.sort((a, b) => a.index - b.index)) {
    const ok = r.code === 0;
    if (!ok) failed++;
    log.info(`  shard ${r.index}/${total}: ${ok ? 'passed' : `FAILED (exit ${r.code})`}  (log: ${r.logFile})`);
  }
  return failed === 0 ? 0 : 1;
}

/**
 * Tear down the unsharded test stack AND every sharded stack discovered on disk
 * (`state.test.<i>.json` in `.lt-dev/`). Used by `lt dev test down` so a
 * `--keep`-ed sharded run is fully reclaimed by one command.
 */
export async function tearDownAllTestSessions(
  layout: DevProjectLayout,
  baseIdentity: DevIdentity,
  log: TestSessionLogger,
  opts: { silent?: boolean } = {},
): Promise<{ stopped: string[] }> {
  const stopped: string[] = [];
  // Unsharded session first.
  const base = await tearDownTestSession(layout, baseIdentity, log, { silent: opts.silent });
  stopped.push(...base.stopped);

  // Then any sharded sessions still on disk.
  let entries: string[] = [];
  try {
    entries = readdirSync(join(layout.root, '.lt-dev'));
  } catch {
    /* no .lt-dev dir → nothing sharded to reclaim */
  }
  const shardIndices = entries
    .map((f) => f.match(/^state\.test\.(\d+)\.json$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  for (const shardIndex of shardIndices) {
    const r = await tearDownTestSession(layout, baseIdentity, log, { shardIndex, silent: opts.silent });
    stopped.push(...r.stopped);
  }
  return { stopped };
}

/**
 * Tear down the test stack: stop processes, remove the Caddy block, clear the
 * env bridge + session file + registry entry. Idempotent + residue-free.
 */
export async function tearDownTestSession(
  layout: DevProjectLayout,
  baseIdentity: DevIdentity,
  log: TestSessionLogger,
  opts: { shardIndex?: number; silent?: boolean } = {},
): Promise<{ stopped: string[] }> {
  const names = testStackNames(opts.shardIndex);
  const testIdentity = buildTestIdentity(baseIdentity, names.identitySuffix);
  const stopped: string[] = [];

  const session = loadSession(layout.root, names.sessionFile);
  if (session) {
    for (const [name, pid] of Object.entries(session.pids) as [string, number | undefined][]) {
      if (!pid) continue;
      if (!isPidAlive(pid)) {
        stopped.push(`${name} (pid ${pid}, already dead)`);
        continue;
      }
      // SIGTERM → wait → SIGKILL. A compiled `node dist` API catches SIGTERM
      // for graceful shutdown and can hang on open Mongo connections, so a
      // single SIGTERM would leave it listening + holding the test DB. Escalate
      // to guarantee the residue-free teardown promise.
      const gone = await terminateProcessGroup(pid);
      stopped.push(gone ? `${name} (pid ${pid})` : `${name} (pid ${pid}, SURVIVED SIGKILL!)`);
    }
    clearSession(layout.root, names.sessionFile);
  }

  const removed = removeProjectBlock(testIdentity.slug);
  if (removed) {
    const r = await reloadCaddy();
    if (!r.ok && !opts.silent) log.warn(`Removed test Caddy block but reload failed: ${r.stderr.split('\n')[0]}`);
  }

  clearEnvBridge(layout.root, names.bridgeFile);

  // Drop the registry entry so the test slug + ports are reclaimed.
  const reg = loadRegistry();
  if (reg.projects[testIdentity.slug]) {
    delete reg.projects[testIdentity.slug];
    saveRegistry(reg);
  }

  if (!opts.silent && stopped.length > 0) log.info(`Stopped test stack: ${stopped.join(', ')}`);
  return { stopped };
}

/**
 * Resolve the per-stack file/identity names. For a sharded run (`shardIndex`
 * given) everything gets a `.<i>` / `-<i>` suffix so N stacks coexist without
 * clobbering each other's session file, env bridge, logs, Caddy block or DB.
 * Unsharded (shardIndex undefined) keeps the original single-stack names.
 */
function testStackNames(shardIndex?: number): {
  apiLog: string;
  appLog: string;
  bridgeFile: string;
  dbSuffix: string;
  identitySuffix: string;
  sessionFile: string;
} {
  const sharded = shardIndex !== undefined;
  return {
    apiLog: sharded ? `api.test.${shardIndex}.log` : TEST_API_LOG,
    appLog: sharded ? `app.test.${shardIndex}.log` : TEST_APP_LOG,
    bridgeFile: sharded ? `${TEST_BRIDGE_FILE}.${shardIndex}` : TEST_BRIDGE_FILE,
    dbSuffix: sharded ? `-${shardIndex}` : '',
    identitySuffix: sharded ? `-test-${shardIndex}` : '-test',
    sessionFile: sharded ? `state.test.${shardIndex}.json` : TEST_SESSION_FILE,
  };
}
