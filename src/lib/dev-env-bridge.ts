/**
 * ENV bridge file at `<root>/.lt-dev/.env` — written by `lt dev up`,
 * removed by `lt dev down`. External tools (Playwright, custom scripts,
 * IDE test runners) load this file via dotenv to pick up the URLs and
 * the Caddy root CA path without depending on the parent shell.
 *
 * Why a file (not just inherited env): the typical workflow is
 *   1. `lt dev up`    (in shell A)
 *   2. `pnpm test:e2e` (in shell B, IDE, or VS Code task)
 * Shell B does not inherit shell A's exports. Reading a file solves
 * this without polluting global state.
 *
 * The file is gitignored via `.lt-dev/` and written 0600, because it is no longer
 * URLs only: `NUXT_SESSION_PASSWORD` is a session-sealing key. Usually that is the
 * value `lt dev` derived itself, but when the project exported its own it is THAT
 * one being copied here — so treat the file as credential-bearing, and think twice
 * before adding a key to it. Format: standard dotenv KEY=VALUE.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';

import { DevEnv } from './dev-env';

const HEADER = `# Managed by \`lt dev up\` — do NOT edit, will be overwritten.\n# Removed by \`lt dev down\`. Loaded by Playwright + other tools.\n`;

/** Remove the ENV bridge file. No-op if missing. */
export function clearEnvBridge(projectRoot: string, fileName = '.env'): boolean {
  const file = envBridgePath(projectRoot, fileName);
  if (!existsSync(file)) return false;
  try {
    rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the local Caddy root CA certificate path.
 *
 * Caddy stores its locally-signed root CA at a platform-specific
 * data dir. We probe the common locations first; if none exists,
 * we fall back to `caddy environ` (slow but authoritative).
 */
export function detectCaddyRootCa(): null | string {
  const candidates: string[] = [];
  if (platform() === 'darwin') {
    candidates.push(join(homedir(), 'Library/Application Support/Caddy/pki/authorities/local/root.crt'));
  }
  // Linux + fallback
  candidates.push(join(homedir(), '.local/share/caddy/pki/authorities/local/root.crt'));
  // XDG_DATA_HOME override
  if (process.env.XDG_DATA_HOME) {
    candidates.push(join(process.env.XDG_DATA_HOME, 'caddy/pki/authorities/local/root.crt'));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Resolve the path to the ENV bridge file for a project. */
export function envBridgePath(projectRoot: string, fileName = '.env'): string {
  return join(projectRoot, '.lt-dev', fileName);
}

/**
 * Write the ENV bridge file. Idempotent — same content = no rewrite.
 *
 * Returns the absolute path that was written.
 */
export function writeEnvBridge(projectRoot: string, devEnv: DevEnv, dbName?: string, fileName = '.env'): string {
  const file = envBridgePath(projectRoot, fileName);
  const lines: string[] = [];

  // The App-side env is the more "external" one (Playwright, browser tools).
  // We expose every URL/storage/api key the App env carries.
  const exported: Array<keyof NodeJS.ProcessEnv> = [
    'BASE_URL',
    'APP_URL',
    'NSC__BASE_URL',
    'NSC__APP_URL',
    'NUXT_API_URL',
    'NUXT_PUBLIC_API_URL',
    'NUXT_PUBLIC_SITE_URL',
    'NUXT_PUBLIC_STORAGE_PREFIX',
    'NUXT_PUBLIC_API_PROXY',
    // Not needed by the runner itself, but external suites check it to tell a stack that
    // can log in from one that will 500 on every login, and a suite that seals its own
    // session cookie to skip the login form needs the value (see dev-env.ts). This is the
    // one credential-shaped key in the bridge — it is why the file is written 0600.
    'NUXT_SESSION_PASSWORD',
    'NSC__MONGOOSE__URI',
    'DATABASE_URL',
    // Legacy aliases — see dev-env.ts for the rationale.
    'API_URL',
    'SITE_URL',
    // The loopback addresses. An external runner that RESOLVES a URL from Node —
    // an API helper, a seeding script, a readiness check — needs these: on Windows
    // `*.localhost` does not resolve for Node at all, only for browsers. The
    // public names above stay, because browser-facing values (a Playwright
    // `baseURL`, a link a developer opens) must keep them. See `dev-env.ts#internalUrl`.
    'LT_DEV_API_INTERNAL_URL',
    'LT_DEV_APP_INTERNAL_URL',
  ];
  for (const key of exported) {
    const v = devEnv.app.env[key as string];
    if (v !== undefined && v !== '') lines.push(`${String(key)}=${v}`);
  }

  // Marker so consumers can detect "lt dev mode" reliably.
  lines.push(`LT_DEV_ACTIVE=true`);
  if (dbName) lines.push(`LT_DEV_DB_NAME=${dbName}`);

  // Caddy root CA — Playwright/Chromium use NODE_EXTRA_CA_CERTS to trust it.
  const caPath = detectCaddyRootCa();
  if (caPath) lines.push(`NODE_EXTRA_CA_CERTS=${caPath}`);

  const content = `${HEADER}${lines.join('\n')}\n`;
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return file;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
  // `mode` only applies when the file is CREATED, so an existing bridge from an older
  // lt version would keep its 0644. chmod unconditionally to heal those.
  chmodSync(file, 0o600);
  return file;
}
