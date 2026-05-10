import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { dirname, join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { resolveLayout } from '../../lib/local-project';
import {
  isPidAlive,
  listenSnapshot,
  loadLocalState,
  loadRegistry,
  portsForSlot,
  projectSlug,
  saveLocalState,
} from '../../lib/port-registry';

/**
 * Start API + App with project-specific ports.
 *
 * Reads the slot from the central registry, exports env vars,
 * spawns `pnpm start` (api) and `pnpm dev` (app) detached, and
 * persists the PIDs to <root>/.lt-local/state.json.
 *
 * Environment-variable contract injected into spawned children
 * (single source of truth — keep in sync with the CLAUDE.md port
 * block in `lib/local-patches.ts#patchClaudeMd`):
 *
 *   PORT                       — Nest (api) / Nuxt dev server (app); slot-derived
 *   BASE_URL                   — nest-server config.env.ts (canonical API base)
 *   APP_URL                    — nest-server config.env.ts (frontend origin for redirects/CORS)
 *   NUXT_API_URL               — Nuxt vite-proxy target for /api, /iam, …
 *   NUXT_PUBLIC_API_URL        — public, exposed via useRuntimeConfig().public.apiUrl
 *   NUXT_PUBLIC_SITE_URL       — public, used by useRuntimeConfig().public.siteUrl + Playwright
 *   NUXT_PUBLIC_STORAGE_PREFIX — namespaces sessionStorage/localStorage so parallel
 *                                projects don't share auth tokens (e.g. "crm-local")
 *   NSC__MONGOOSE__URI         — nest-server-config Mongoose URI (only when dbName known)
 */
const UpCommand: GluegunCommand = {
  alias: ['u'],
  description: 'Start API + App',
  hidden: false,
  name: 'up',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    const slug = projectSlug(layout.root);
    const registry = loadRegistry();
    const entry = registry.projects[slug];
    if (!entry) {
      error(`Project "${slug}" not registered. Run \`lt local init\` first.`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'local up: not registered';
    }
    const ports = portsForSlot(entry.slot);

    // Already running?
    const existing = loadLocalState(layout.root);
    if (
      existing &&
      ((existing.pids.api && isPidAlive(existing.pids.api)) || (existing.pids.app && isPidAlive(existing.pids.app)))
    ) {
      warning(
        `Already running (api pid ${existing.pids.api ?? '-'}, app pid ${existing.pids.app ?? '-'}). Run \`lt local down\` first.`,
      );
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'local up: already running';
    }

    // Pre-flight port check (single lsof call covers both ports).
    const snapshot = await listenSnapshot([ports.api, ports.app]);
    for (const p of [ports.api, ports.app]) {
      const r = snapshot.get(p);
      if (r) {
        error(`Port ${p} already in use by ${r.command} (pid ${r.pid}).`);
        if (!parameters.options.fromGluegunMenu) process.exit(1);
        return 'local up: port busy';
      }
    }

    const env = {
      ...process.env,
      APP_URL: `http://localhost:${ports.app}`,
      BASE_URL: `http://localhost:${ports.api}`,
      NUXT_API_URL: `http://localhost:${ports.api}`,
      NUXT_PUBLIC_API_URL: `http://localhost:${ports.api}`,
      NUXT_PUBLIC_SITE_URL: `http://localhost:${ports.app}`,
      NUXT_PUBLIC_STORAGE_PREFIX: `${slug}-local`,
      ...(entry.dbName ? { NSC__MONGOOSE__URI: `mongodb://127.0.0.1/${entry.dbName}` } : {}),
    };

    info('');
    info(colors.bold(`Starting "${slug}" on slot ${entry.slot}`));
    info(`  api: http://localhost:${ports.api}`);
    info(`  app: http://localhost:${ports.app}`);
    if (entry.dbName) info(`  db:  mongodb://127.0.0.1/${entry.dbName}`);
    info('');

    const pids: { api?: number; app?: number } = {};
    // Allow corporate / pinned setups to override the binary used for `lt local up`.
    const pnpmBin = process.env.LT_PNPM_BIN || 'pnpm';

    if (layout.apiDir && existsSync(join(layout.apiDir, 'package.json'))) {
      const apiPid = spawnDetached(pnpmBin, ['start'], {
        cwd: layout.apiDir,
        env: { ...env, PORT: String(ports.api) },
        logFile: join(layout.root, '.lt-local', 'api.log'),
      });
      if (apiPid) pids.api = apiPid;
    }
    if (layout.appDir && existsSync(join(layout.appDir, 'package.json'))) {
      const appPid = spawnDetached(pnpmBin, ['dev'], {
        cwd: layout.appDir,
        env: { ...env, PORT: String(ports.app) },
        logFile: join(layout.root, '.lt-local', 'app.log'),
      });
      if (appPid) pids.app = appPid;
    }

    saveLocalState(layout.root, { pids, ports, startedAt: new Date().toISOString() });

    success(`Started: api pid=${pids.api ?? '-'}, app pid=${pids.app ?? '-'}`);
    info(colors.dim('Logs: <root>/.lt-local/api.log, <root>/.lt-local/app.log'));
    info(colors.dim('Stop with: lt local down'));

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `local up: api=${pids.api}, app=${pids.app}`;
  },
};

interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
}

/**
 * Spawn a detached child whose stdio is redirected to a log file.
 *
 * The parent's copy of the log file descriptor is closed in the `finally`
 * block — the child has already inherited its own fd before `spawn` returns,
 * so closing here prevents fd leaks and avoids racing-write artifacts on
 * filesystems where O_APPEND is not atomic.
 */
function spawnDetached(cmd: string, args: string[], opts: SpawnOptions): number | undefined {
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const out = openSync(opts.logFile, 'a');

  try {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      detached: true,
      env: opts.env,
      stdio: ['ignore', out, out],
    });
    child.unref();
    return child.pid;
  } catch {
    return undefined;
  } finally {
    try {
      closeSync(out);
    } catch {
      /* fd already inherited by child; ignore */
    }
  }
}

module.exports = UpCommand;
