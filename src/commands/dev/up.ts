import { existsSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning, CaddyRoute, reloadCaddy, upsertProjectBlock } from '../../lib/caddy';
import { buildDevEnv } from '../../lib/dev-env';
import { writeEnvBridge } from '../../lib/dev-env-bridge';
import { addToGitignore, patchClaudeMd } from '../../lib/dev-patches';
import { killProcessGroup, listenSnapshot, spawnDetached } from '../../lib/dev-process';
import { apiNeedsPortPatch, appNeedsPortPatch, resolveLayout } from '../../lib/dev-project';
import {
  allocateInternalPort,
  detectSlugConflict,
  isPidAlive,
  loadRegistry,
  loadSession,
  saveRegistry,
  saveSession,
  takenInternalPorts,
  withRegistryLock,
} from '../../lib/dev-state';
import { resolveDevIdentity } from '../../lib/dev-ticket';

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
      error('No API or App project detected at this path. Run `lt dev init` first.');
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

    // Sanft auto-migrate sichere Operationen (ohne Code-Modifikation):
    // CLAUDE.md-URL-Block einfügen + .gitignore ergänzen.
    // Code-Patches (config.env.ts, nuxt.config.ts) bleiben explizit `lt dev init`.
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

    // Warnung bei Legacy-Code (hardcoded ports) — kein Auto-Patch.
    {
      const legacyFiles: string[] = [];
      if (layout.apiDir) {
        const f = apiNeedsPortPatch(layout.apiDir);
        if (f) legacyFiles.push(f);
      }
      if (layout.appDir) legacyFiles.push(...appNeedsPortPatch(layout.appDir));
      if (legacyFiles.length > 0) {
        warning('Legacy hardcoded ports detected — Caddy will proxy correctly only after running `lt dev init`:');
        legacyFiles.forEach((f) => info(colors.dim(`  - ${f}`)));
        info(
          colors.dim('  (Continuing — env-aware files will work; legacy files may bind on 3000/3001 and miss Caddy.)'),
        );
      }
    }

    // Already running?
    const existingSession = loadSession(layout.root);
    if (existingSession) {
      const apiUp = existingSession.pids.api ? isPidAlive(existingSession.pids.api) : false;
      const appUp = existingSession.pids.app ? isPidAlive(existingSession.pids.app) : false;
      if (apiUp || appUp) {
        warning(
          `Already running (api pid ${existingSession.pids.api ?? '-'}, app pid ${existingSession.pids.app ?? '-'}).`,
        );
        // Surface the bound URLs so the user can copy them out without having
        // to look up `lt dev status` separately. Falls back to the in-process
        // identity/registry data — both sources stay in sync via saveRegistry.
        const existingEntry = loadRegistry().projects[identity.slug];
        printProjectUrls(info, {
          apiHostname: identity.subdomains.api?.hostname,
          apiUpstreamPort: existingEntry?.internalPorts.api,
          appHostname: identity.subdomains.app?.hostname,
          appUpstreamPort: existingEntry?.internalPorts.app,
          dbName: existingEntry?.dbName ?? dbName,
        });
        info('Run `lt dev down` first.');
        if (!parameters.options.fromGluegunMenu) process.exit(1);
        return 'dev up: already running';
      }
    }

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
        apiPort = entry?.internalPorts.api ?? (layout.apiDir ? allocateInternalPort(4000, taken) : undefined);
        if (apiPort) taken.add(apiPort);
        appPort = entry?.internalPorts.app ?? (layout.appDir ? allocateInternalPort(4000, taken) : undefined);

        const portsToCheck = [apiPort, appPort].filter((p): p is number => typeof p === 'number');
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
    if (identity.subdomains.api) info(`  api: https://${identity.subdomains.api.hostname}  →  127.0.0.1:${apiPort}`);
    info(`  db:  mongodb://127.0.0.1/${dbName}`);
    info('');

    // Build env per process.
    const devEnv = buildDevEnv({
      apiInternalPort: apiPort ?? 0,
      appInternalPort: appPort ?? 0,
      baseEnv: process.env,
      dbName,
      identity,
    });

    const pnpmBin = process.env.LT_PNPM_BIN || 'pnpm';
    const pids: { api?: number; app?: number } = {};

    const rotationNotes: string[] = [];
    if (layout.apiDir && existsSync(join(layout.apiDir, 'package.json')) && apiPort) {
      const apiResult = spawnDetached(pnpmBin, ['start'], {
        cwd: layout.apiDir,
        env: devEnv.api.env,
        logFile: join(layout.root, '.lt-dev', 'api.log'),
      });
      if (apiResult) {
        pids.api = apiResult.pid;
        if (apiResult.rotated.rotated && apiResult.rotated.archivePath !== undefined) {
          rotationNotes.push(
            formatRotationNote('api', apiResult.rotated.archivePath, apiResult.rotated.previousSize ?? 0),
          );
        }
      }
    }
    if (layout.appDir && existsSync(join(layout.appDir, 'package.json')) && appPort) {
      const appResult = spawnDetached(pnpmBin, ['dev'], {
        cwd: layout.appDir,
        env: devEnv.app.env,
        logFile: join(layout.root, '.lt-dev', 'app.log'),
      });
      if (appResult) {
        pids.app = appResult.pid;
        if (appResult.rotated.rotated && appResult.rotated.archivePath !== undefined) {
          rotationNotes.push(
            formatRotationNote('app', appResult.rotated.archivePath, appResult.rotated.previousSize ?? 0),
          );
        }
      }
    }

    // Persist the session (PIDs). The registry entry (ports) was already reserved
    // atomically before the spawn, above.
    saveSession(layout.root, { pids, startedAt: new Date().toISOString() });

    // Write the ENV bridge so external tools (Playwright, IDE test runners,
    // custom shell scripts) can pick up the URLs without inheriting our shell.
    const bridgePath = writeEnvBridge(layout.root, devEnv, dbName);
    info(colors.dim(`ENV bridge: ${bridgePath}`));

    success(`Started: api pid=${pids.api ?? '-'}, app pid=${pids.app ?? '-'}`);
    // Echo the bound URLs next to the PIDs as well — the "Starting" block
    // prints them before the spawn, but on a long boot log they scroll out
    // of view, so repeating them here keeps PID + URL visually grouped.
    printProjectUrls(info, {
      apiHostname: identity.subdomains.api?.hostname,
      apiUpstreamPort: apiPort,
      appHostname: identity.subdomains.app?.hostname,
      appUpstreamPort: appPort,
      dbName,
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

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev up: api=${pids.api}, app=${pids.app}`;
  },
};

module.exports = UpCommand;
