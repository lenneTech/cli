import { existsSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning, CaddyRoute, reloadCaddy, upsertProjectBlock } from '../../lib/caddy';
import { CommandHelp } from '../../lib/command-help';
import { isApiCompiledRequested, startCompiledApi } from '../../lib/dev-api-launch';
import { buildDevEnv } from '../../lib/dev-env';
import { writeEnvBridge } from '../../lib/dev-env-bridge';
import { buildIdentity } from '../../lib/dev-identity';
import { pickPackageManager } from '../../lib/dev-package-manager';
import { addToGitignore, autoPatch, patchClaudeMd } from '../../lib/dev-patches';
import { killProcessGroup, listenSnapshot, spawnDetached, terminateProcessGroup } from '../../lib/dev-process';
import { deriveDbName, resolveLayout } from '../../lib/dev-project';
import { collectDevPrunePlan } from '../../lib/dev-prune';
import {
  allocateInternalPort,
  classifyComponentHealth,
  type ComponentHealth,
  detectSlugConflict,
  loadRegistry,
  loadSession,
  saveRegistry,
  saveSession,
  takenInternalPorts,
  withRegistryLock,
} from '../../lib/dev-state';
import { dropDatabases, gitMainRepoRoot, listDatabaseNames, resolveDevIdentity } from '../../lib/dev-ticket';

/**
 * Start API + App behind Caddy with project-specific URLs.
 *
 * Pre-flight:
 * - Caddy must be installed and running (otherwise points to install)
 * - No existing `lt dev up` session for THIS project
 * - Internal upstream ports must be free
 *
 * Process:
 * 1. Resolve layout + identity
 * 2. Allocate (or reuse) internal upstream ports
 * 3. Upsert Caddy block + reload
 * 4. Spawn API + App detached, log into `<root>/.lt-dev/{api,app}.log`
 * 5. Persist registry entry + session state
 *
 * Env-vars injected (see lib/dev-env.ts):
 *   PORT, BASE_URL, APP_URL, NUXT_API_URL, NUXT_PUBLIC_API_URL,
 *   NUXT_PUBLIC_SITE_URL, NUXT_PUBLIC_STORAGE_PREFIX,
 *   NSC__MONGOOSE__URI, NSC__BASE_URL, NSC__APP_URL, DATABASE_URL,
 *   NUXT_PUBLIC_API_PROXY=false (Caddy makes vite-proxy obsolete).
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatRotationNote(label: string, archivePath: string, previousSize: number): string {
  const size = formatBytes(previousSize);
  const huge = previousSize > 100 * 1024 * 1024 ? ' (large — consider fixing noisy warnings)' : '';
  return `Rotated previous ${label} log → ${archivePath} (${size})${huge}`;
}

/**
 * Print the project's bound URLs (app, api, db) as a small info block.
 *
 * Used in two places so the user always sees the URLs next to the PIDs —
 * once after a successful `up` and once when `up` short-circuits on
 * "Already running". Falls back gracefully when only one of api/app is
 * present (single-side projects).
 */
function printProjectUrls(
  info: (message: string) => void,
  options: {
    apiHostname?: string;
    apiUpstreamPort?: number;
    appHostname?: string;
    appUpstreamPort?: number;
    dbName?: string;
  },
): void {
  if (options.appHostname) {
    const arrow = options.appUpstreamPort ? `  →  127.0.0.1:${options.appUpstreamPort}` : '';
    info(`  app: https://${options.appHostname}${arrow}`);
  }
  if (options.apiHostname) {
    const arrow = options.apiUpstreamPort ? `  →  127.0.0.1:${options.apiUpstreamPort}` : '';
    info(`  api: https://${options.apiHostname}${arrow}`);
  }
  if (options.dbName) {
    info(`  db:  mongodb://127.0.0.1/${options.dbName}`);
  }
}

const UpCommand: GluegunCommand = {
  alias: ['u'],
  description: 'Start API + App behind Caddy',
  hidden: false,
  name: 'up',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (!layout.apiDir && !layout.appDir) {
      error(
        'No lt project detected at this path. Expected an API (src/config.env.ts or nest-cli.json), ' +
          'an App (nuxt.config.ts), or a monorepo with projects/api and/or projects/app.',
      );
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev up: not a project';
    }

    // Pre-flight: Caddy
    if (!(await caddyAvailable())) {
      error('caddy is not installed. Run `lt dev install` first.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev up: caddy missing';
    }
    if (!(await caddyDaemonRunning())) {
      error('caddy daemon is not running. Run `lt dev install` to start the lt-dev service.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev up: caddy daemon down';
    }

    // Ticket-aware: in a `lt ticket` worktree (tagged by a `.lt-dev/ticket`
    // marker) — or with an explicit `--ticket <name>` — the slug / URLs / DB are
    // suffixed so the stack is fully isolated from the base dev session and every
    // other ticket. Without a ticket this is the plain project identity.
    const { dbName, identity, ticket } = resolveDevIdentity(layout, { ticket: parameters.options.ticket });

    // `--api-compiled`: run the API compiled (`node dist`) instead of ts-node.
    // Trades hot reload for stability — ts-node intermittently dies under browser
    // load without a stacktrace (DEV-2525); `lt dev test` already runs compiled.
    const apiCompiled = isApiCompiledRequested(parameters.options);

    // Guard against two checkouts of the SAME project (same package.json "name"
    // → same slug → shared URLs / ports / DB / Caddy block). If another checkout
    // is already RUNNING under this slug, abort with a clear message — otherwise
    // both fight over the same ports and one `lt dev down` unroutes the other.
    {
      const conflict = detectSlugConflict(identity.slug, layout.root);
      if (conflict?.otherSessionAlive) {
        error(`Slug "${identity.slug}" is already in use by another RUNNING checkout:`);
        info(colors.dim(`  ${conflict.otherPath}`));
        info('Two checkouts of the same project share URLs / ports / database and collide.');
        info('Stop it there (`lt dev down`), or give THIS checkout a distinct package.json "name".');
        if (!parameters.options.fromGluegunMenu) process.exit(1);
        return 'dev up: slug in use by another checkout';
      }
    }

    // Auto-establish every prerequisite so the user never has to run `lt dev
    // init` first: CLAUDE.md URL block (base only) + `.gitignore` + the code
    // patches that make config.env.ts / nuxt.config.ts / playwright.config.ts
    // honour the env `lt dev` injects (PORT, URLs).
    {
      // NEVER patch the git-tracked CLAUDE.md for a ticket worktree: it would
      // differ per worktree and risk committing ticket-specific URLs. The lt-dev
      // plugin hook surfaces the ticket context per prompt instead (from the
      // gitignored `.lt-dev/ticket` marker). For the base project we keep the
      // committed URL block up to date as before.
      if (!ticket) {
        const claudeCandidates = [
          join(layout.root, 'CLAUDE.md'),
          ...(layout.apiDir ? [join(layout.apiDir, 'CLAUDE.md')] : []),
          ...(layout.appDir ? [join(layout.appDir, 'CLAUDE.md')] : []),
        ];
        const patched = claudeCandidates.map((f) => patchClaudeMd(f, { dbName, identity })).filter((r) => r.patched);
        if (patched.length > 0) {
          info(colors.dim(`updated CLAUDE.md URL block in ${patched.length} file(s)`));
        }
      }
      // Always keep `.lt-dev/` (state, env bridge, ticket marker) out of git.
      if (addToGitignore(layout.root, '.lt-dev/')) {
        info(colors.dim('added `.lt-dev/` to .gitignore'));
      }
    }

    // Self-heal legacy hardcoded ports instead of just warning. An unmigrated
    // project hardcodes `port: 3000`/`3001` and ignores the injected `PORT`, so
    // it binds the framework defaults and misses Caddy → the (ticket) URLs don't
    // route and collide with parallel stacks. `autoPatch` is idempotent (no-op on
    // an already-env-aware config) and only ever touches config.env.ts /
    // nuxt.config.ts / playwright.config.ts — never CLAUDE.md — so it is safe in a
    // ticket worktree. In a worktree these are uncommitted patches; `lt ticket
    // stop` recognises a pristine lt-dev patch and tears down without `--force`.
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
      const patched = filesToPatch.map((f) => autoPatch(f)).filter((r) => r.patched);
      if (patched.length > 0) {
        patched.forEach((r) => success(`patched ${r.replacements}× in ${r.file} (env-aware ports for lt dev)`));
        if (ticket) {
          info(
            colors.dim(
              '  (worktree config self-healed — auto-discarded on `lt ticket stop`, or commit it to migrate the project)',
            ),
          );
        }
      }
    }

    // Load any existing session up-front. The "is it already running?" decision
    // is deliberately deferred until AFTER port allocation: a recorded wrapper
    // PID being alive is NOT proof a component serves (a crashed ts-node leaves
    // nodemon alive), so we probe the actual internal ports once we know them.
    const existingSession = loadSession(layout.root);

    // Allocate internal ports (reuse existing if registered), verify they are
    // free, AND reserve them in the registry — all ATOMICALLY under a cross-
    // process lock, so two simultaneous `lt ticket start` (each → `lt dev up`)
    // can never grab the same ports.
    let apiPort: number | undefined;
    let appPort: number | undefined;
    try {
      await withRegistryLock(async () => {
        const reg = loadRegistry();
        const entry = reg.projects[identity.slug];
        const taken = takenInternalPorts(reg, identity.slug);
        let apiPortReused = false;
        let appPortReused = false;
        if (entry?.internalPorts.api) {
          apiPort = entry.internalPorts.api;
          apiPortReused = true;
        } else if (layout.apiDir) {
          apiPort = allocateInternalPort(4000, taken);
        }
        if (apiPort) taken.add(apiPort);
        if (entry?.internalPorts.app) {
          appPort = entry.internalPorts.app;
          appPortReused = true;
        } else if (layout.appDir) {
          appPort = allocateInternalPort(4000, taken);
        }

        // Only FRESHLY allocated ports must be verified free here. A reused
        // (registered) port may legitimately be bound by our own still-healthy
        // component; the spawn phase below decides per-component whether to keep
        // or restart it (and reclaims a reused port held by a crashed/orphaned
        // process). Free-checking a reused port would falsely abort a partial
        // restart of just the crashed half.
        const portsToCheck = [apiPortReused ? undefined : apiPort, appPortReused ? undefined : appPort].filter(
          (p): p is number => typeof p === 'number',
        );
        const snap = await listenSnapshot(portsToCheck);
        for (const p of portsToCheck) {
          const r = snap.get(p);
          if (r) throw new Error(`Internal port ${p} already in use by ${r.command} (pid ${r.pid}).`);
        }

        // Reserve immediately so a concurrent `lt dev up` sees these as taken.
        const subdomainMap: Record<string, string> = {};
        for (const [k, v] of Object.entries(identity.subdomains)) subdomainMap[k] = v.hostname;
        reg.projects[identity.slug] = {
          dbName,
          internalPorts: { api: apiPort, app: appPort },
          lastUsedAt: new Date().toISOString(),
          path: layout.root,
          subdomains: subdomainMap,
        };
        saveRegistry(reg);
      });
    } catch (e) {
      error((e as Error).message);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev up: port in use';
    }

    // ── Health-aware (re)start decision ──────────────────────────────────────
    // Probe the just-resolved ports so we can tell a still-serving component
    // from a crashed one (supervisor PID alive, port free). Only dead/crashed
    // components get (re)started; a running one keeps serving untouched — and a
    // still-BOOTING one (`starting`: PID alive, port not bound yet, within the
    // startup grace window after a recent `up`) is ALSO kept, not force-restarted.
    // Passing `startedAt` is what lets the classifier distinguish that boot window
    // from a real crash — otherwise a re-run of `lt dev up` during the API's slow
    // boot would kill the still-booting component and reset its progress (the very
    // false-positive the `starting` state exists to prevent).
    const hasApi = Boolean(layout.apiDir && existsSync(join(layout.apiDir, 'package.json')) && apiPort);
    const hasApp = Boolean(layout.appDir && existsSync(join(layout.appDir, 'package.json')) && appPort);
    const healthSnap = await listenSnapshot([apiPort, appPort].filter((p): p is number => typeof p === 'number'));
    const apiHealth: ComponentHealth | undefined = hasApi
      ? classifyComponentHealth({
          pid: existingSession?.pids.api,
          portBound: !!apiPort && healthSnap.has(apiPort),
          startedAt: existingSession?.startedAt,
        })
      : undefined;
    const appHealth: ComponentHealth | undefined = hasApp
      ? classifyComponentHealth({
          pid: existingSession?.pids.app,
          portBound: !!appPort && healthSnap.has(appPort),
          startedAt: existingSession?.startedAt,
        })
      : undefined;
    // A component we leave running untouched is either serving (`running`) or
    // still within its boot grace window (`starting`).
    const isKeepable = (h: ComponentHealth | undefined): boolean => h === 'running' || h === 'starting';

    // All present components already serving → nothing to do.
    const presentHealth = [apiHealth, appHealth].filter((h): h is ComponentHealth => h !== undefined);
    if (presentHealth.length > 0 && presentHealth.every((h) => h === 'running')) {
      warning(
        `Already running (api pid ${existingSession?.pids.api ?? '-'}, app pid ${existingSession?.pids.app ?? '-'}) — all components healthy.`,
      );
      const existingEntry = loadRegistry().projects[identity.slug];
      printProjectUrls(info, {
        apiHostname: identity.subdomains.api?.hostname,
        apiUpstreamPort: existingEntry?.internalPorts.api,
        appHostname: identity.subdomains.app?.hostname,
        appUpstreamPort: existingEntry?.internalPorts.app,
        // App-only projects have no database — don't advertise a Mongo URL
        // that nothing listens on.
        dbName: identity.subdomains.api ? (existingEntry?.dbName ?? dbName) : undefined,
      });
      info('Run `lt dev down` first to force a full restart.');
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev up: already running';
    }

    // Partial restart — at least one component is kept (running or still booting)
    // and at least one is down. Announce what we keep vs. restart so the user sees
    // the honest state. A `starting` component is kept (booting), NOT restarted.
    const partialRestart = presentHealth.some(isKeepable);
    if (partialRestart) {
      const announceDecision = (name: 'api' | 'app', h: ComponentHealth | undefined, pid?: number, port?: number) => {
        if (h === 'running') info(colors.dim(`${name} healthy (pid ${pid}) → keeping`));
        else if (h === 'starting') info(colors.cyan(`${name} still booting (pid ${pid}) → keeping (grace window)`));
        else if (h) warning(`${name} ${h} (port ${port} not serving) → restarting`);
      };
      announceDecision('api', apiHealth, existingSession?.pids.api, apiPort);
      announceDecision('app', appHealth, existingSession?.pids.app, appPort);
    }

    // Caddy block + reload.
    const routes: CaddyRoute[] = [];
    if (identity.subdomains.api && apiPort)
      routes.push({ hostname: identity.subdomains.api.hostname, upstreamPort: apiPort });
    if (identity.subdomains.app && appPort)
      routes.push({ hostname: identity.subdomains.app.hostname, upstreamPort: appPort });
    if (routes.length === 0) {
      error('No subdomains to expose (project has neither api nor app).');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev up: nothing to expose';
    }
    upsertProjectBlock(identity.slug, routes);
    const reload = await reloadCaddy();
    if (!reload.ok) {
      error(`caddy reload failed:\n${reload.stderr}`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev up: caddy reload failed';
    }

    info('');
    info(colors.bold(`Starting "${identity.slug}"`) + (ticket ? colors.dim(` (ticket ${ticket})`) : ''));
    if (identity.subdomains.app) info(`  app: https://${identity.subdomains.app.hostname}  →  127.0.0.1:${appPort}`);
    if (identity.subdomains.api)
      info(
        `  api: https://${identity.subdomains.api.hostname}  →  127.0.0.1:${apiPort}${
          apiCompiled ? colors.dim('  (compiled, no hot reload)') : ''
        }`,
      );
    if (identity.subdomains.api) info(`  db:  mongodb://127.0.0.1/${dbName}`);
    info('');

    // Build env per process.
    const devEnv = buildDevEnv({
      apiInternalPort: apiPort ?? 0,
      appInternalPort: appPort ?? 0,
      baseEnv: process.env,
      dbName,
      identity,
    });

    const pids: { api?: number; app?: number } = {};
    const rotationNotes: string[] = [];
    const started: string[] = [];
    const kept: string[] = [];

    // Free a reused internal port before respawning: stop a CRASHED component's
    // still-alive supervisor group (otherwise its idle nodemon leaks and a
    // second one stacks on top), and kill any orphaned listener squatting the
    // port (e.g. a ts-node whose supervisor already died). No-op on a clean
    // first start (no prev PID, port free).
    const reclaimPort = async (prevPid: number | undefined, port: number | undefined, health: ComponentHealth) => {
      if (health === 'crashed' && prevPid) await terminateProcessGroup(prevPid);
      const bound = port ? healthSnap.get(port) : undefined;
      if (bound?.pid) await terminateProcessGroup(bound.pid);
    };

    if (hasApi && layout.apiDir && apiPort) {
      if (isKeepable(apiHealth)) {
        pids.api = existingSession?.pids.api;
        kept.push('api');
        // `--api-compiled` only takes effect when the API (re)starts; a running or
        // still-booting API is kept as-is (force-restarting it would contradict the
        // keep logic), so tell the user how to switch a currently-live ts-node API
        // to compiled.
        if (apiCompiled)
          info(colors.dim('  --api-compiled: API already running/booting — `lt dev down` first to switch it.'));
      } else {
        await reclaimPort(existingSession?.pids.api, apiPort, apiHealth ?? 'dead');
        // Per-component PM detection: a monorepo may have an npm api and a
        // pnpm app, and the legacy hard-coded `pnpm start` would silently
        // regenerate a foreign lockfile + crash on un-approved build
        // scripts when run against an npm-only project.
        const apiPm = pickPackageManager(layout.apiDir);
        const apiLogFile = join(layout.root, '.lt-dev', 'api.log');
        const apiResult = apiCompiled
          ? await startCompiledApi({
              apiDir: layout.apiDir,
              env: devEnv.api.env,
              log: { info, warn: warning },
              logFile: apiLogFile,
              pm: apiPm,
            })
          : spawnDetached(apiPm.bin, apiPm.runScript('start'), {
              cwd: layout.apiDir,
              env: devEnv.api.env,
              logFile: apiLogFile,
            });
        if (apiResult) {
          pids.api = apiResult.pid;
          started.push('api');
          if (apiResult.rotated.rotated && apiResult.rotated.archivePath !== undefined) {
            rotationNotes.push(
              formatRotationNote('api', apiResult.rotated.archivePath, apiResult.rotated.previousSize ?? 0),
            );
          }
        }
      }
    }
    if (hasApp && layout.appDir && appPort) {
      if (isKeepable(appHealth)) {
        pids.app = existingSession?.pids.app;
        kept.push('app');
      } else {
        await reclaimPort(existingSession?.pids.app, appPort, appHealth ?? 'dead');
        const appPm = pickPackageManager(layout.appDir);
        const appResult = spawnDetached(appPm.bin, appPm.runScript('dev'), {
          cwd: layout.appDir,
          env: devEnv.app.env,
          logFile: join(layout.root, '.lt-dev', 'app.log'),
        });
        if (appResult) {
          pids.app = appResult.pid;
          started.push('app');
          if (appResult.rotated.rotated && appResult.rotated.archivePath !== undefined) {
            rotationNotes.push(
              formatRotationNote('app', appResult.rotated.archivePath, appResult.rotated.previousSize ?? 0),
            );
          }
        }
      }
    }

    // Persist the session (PIDs) — merging kept (running/booting) + freshly
    // started PIDs. The registry entry (ports) was already reserved atomically
    // above. Reset the session clock ONLY when something was actually (re)started:
    //   - A freshly restarted component MUST get "now" so its startup grace window
    //     is measured from its real start — inheriting a stale `startedAt` would
    //     make a just-restarted, still-booting component read as `crashed` during
    //     its own boot (a kept `running` component is classified by port-bound, not
    //     `startedAt`, so a fresh timestamp never mis-ages it).
    //   - When nothing was started (all kept — e.g. both still booting), preserve
    //     the original so repeated `up` during a boot can't keep extending the
    //     grace window indefinitely.
    const startedAt =
      started.length > 0 ? new Date().toISOString() : (existingSession?.startedAt ?? new Date().toISOString());
    saveSession(layout.root, { pids, startedAt });

    // Write the ENV bridge so external tools (Playwright, IDE test runners,
    // custom shell scripts) can pick up the URLs without inheriting our shell.
    const bridgePath = writeEnvBridge(layout.root, devEnv, dbName);
    info(colors.dim(`ENV bridge: ${bridgePath}`));

    const summary =
      started.length === 0
        ? kept.length > 0
          ? `Kept ${kept.join('+')} (already running or booting)`
          : 'Nothing restarted'
        : kept.length > 0
          ? `Restarted ${started.join('+')} (kept ${kept.join('+')})`
          : `Started ${started.join('+')}`;
    success(`${summary}: api pid=${pids.api ?? '-'}, app pid=${pids.app ?? '-'}`);
    // Echo the bound URLs next to the PIDs as well — the "Starting" block
    // prints them before the spawn, but on a long boot log they scroll out
    // of view, so repeating them here keeps PID + URL visually grouped.
    printProjectUrls(info, {
      apiHostname: identity.subdomains.api?.hostname,
      apiUpstreamPort: apiPort,
      appHostname: identity.subdomains.app?.hostname,
      appUpstreamPort: appPort,
      dbName: identity.subdomains.api ? dbName : undefined,
    });
    info(colors.dim('Logs: <root>/.lt-dev/api.log, <root>/.lt-dev/app.log'));
    for (const note of rotationNotes) info(colors.dim(note));
    info(colors.dim('Stop with: lt dev down'));

    // Best-effort: kill orphaned children if neither spawned (unlikely, but tidy).
    if (Object.keys(pids).length === 0) {
      warning('Nothing was spawned. Check package.json scripts (`start` for api, `dev` for app).');
      if (pids.api) killProcessGroup(pids.api);
      if (pids.app) killProcessGroup(pids.app);
    }

    // AUTO-PRUNE — restarting an environment is the moment to clean up after its
    // predecessors: orphaned ticket DBs (ids from this repo's own feat/* branches,
    // no live worktree/registry entry, `--keep-db` records excluded), stale shard
    // test DBs, and dead-path registry entries. Same guards as `lt dev prune`;
    // best-effort and non-blocking — a failure here must never affect `up` itself.
    // Opt out with `--no-prune`.
    if (parameters.options.prune !== false) {
      try {
        let mainRepoRoot = layout.root;
        try {
          mainRepoRoot = gitMainRepoRoot(layout.root);
        } catch {
          /* not a git repo — registry prune still applies */
        }
        const mainLayout = resolveLayout(mainRepoRoot, filesystem);
        const baseSlug = buildIdentity(mainRepoRoot).slug;
        const plan = collectDevPrunePlan({
          loadRegistry,
          mainRepoRoot,
          // Always observe (not only with an own api dir): the smoke-test sweep is
          // global, and mongosh against the local default URI needs no project driver.
          observedDbNames: listDatabaseNames(undefined, [mainLayout.apiDir, mainRepoRoot].filter(Boolean)),
          projectDevDb: deriveDbName(mainLayout.apiDir, baseSlug),
          slug: baseSlug,
        });
        const dbTargets = [...new Set([...plan.orphan.targets, ...plan.shardTargets, ...plan.smokeTargets])];
        if (dbTargets.length > 0) {
          const { dropped, reason } = dropDatabases(dbTargets, undefined, [mainLayout.apiDir, mainRepoRoot]);
          if (dropped.length > 0) {
            info(colors.dim(`Pruned ${dropped.length} orphaned test/ticket database(s): ${dropped.join(', ')}`));
          }
          if (reason) {
            info(
              colors.dim(
                `(prune incomplete — ${reason === 'no-mongosh' ? 'mongosh missing' : 'MongoDB unreachable'}; run \`lt dev prune\` later)`,
              ),
            );
          }
        }
        if (plan.registryPrune.length > 0) {
          // Under the registry lock: a parallel `lt dev up` (another project) may be
          // REGISTERING right now — an unlocked read-modify-write here would clobber
          // its fresh entry (classic lost update; observed with two simultaneous ups).
          const removed = await withRegistryLock(() => {
            const reg = loadRegistry();
            const gone: string[] = [];
            for (const key of plan.registryPrune) {
              if (reg.projects[key] && !existsSync(reg.projects[key].path)) {
                delete reg.projects[key];
                gone.push(key);
              }
            }
            if (gone.length > 0) {
              saveRegistry(reg);
            }
            return gone;
          });
          if (removed.length > 0) {
            info(
              colors.dim(
                `Pruned ${removed.length} dead registry entr${removed.length === 1 ? 'y' : 'ies'}: ${removed.join(', ')} (ports reclaimed)`,
              ),
            );
          }
        }
      } catch {
        /* never block `up` on cleanup */
      }
    }

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev up: api=${pids.api}, app=${pids.app}`;
  },
};

export const help: CommandHelp = {
  aliases: ['u'],
  configuration:
    'Ephemeral dev-orchestration flags — no lt.config counterpart. Override the spawn binary for both processes via the LT_PNPM_BIN env var.',
  description:
    'Start the API + App behind Caddy under stable https://<slug>.localhost URLs. Health-aware and idempotent: re-running (re)starts only the component(s) that are not truly serving.',
  examples: ['dev up', 'dev up --api-compiled', 'dev up --ticket DEV-1234'],
  features: [
    'Registers a Caddy block and allocates opaque internal ports (4000+).',
    'Spawns API + App detached; persists PIDs to <root>/.lt-dev/state.json.',
    'Self-heals legacy hardcoded ports and restarts only the down component(s).',
  ],
  name: 'up',
  options: [
    {
      description:
        'Run the API compiled (node dist/src/main.js) instead of ts-node — trades hot reload for stability under browser load (DEV-2525). Builds + migrates first; falls back to the ts-node start if the build fails. Only applies when the API (re)starts.',
      flag: '--api-compiled',
      type: 'boolean',
    },
    {
      description:
        'Suffix the slug / URLs / DB for an isolated ticket stack (also auto-detected from a .lt-dev/ticket marker).',
      flag: '--ticket',
      type: 'string',
    },
  ],
};

module.exports = Object.assign(UpCommand, { help });
