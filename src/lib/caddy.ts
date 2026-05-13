/**
 * Caddy integration for `lt dev`.
 *
 * Caddy is the HTTPS engine: it provides automatic local TLS for
 * `*.localhost` (no /etc/hosts edits needed — RFC 6761), atomic
 * config reload, and a long-stable Caddyfile format. Compared to
 * portless / mkcert / nginx, Caddy gives all of this with a single
 * binary and no sudo daemon.
 *
 * Layout:
 * - Global Caddyfile at `~/.lenneTech/Caddyfile` — one block per
 *   project, marked with `# >>> lt-dev:<slug> >>>` / `# <<<`.
 * - Atomic reload via `caddy reload --config ~/.lenneTech/Caddyfile`.
 *
 * Lifecycle is owned by `lt dev install` (one-time setup) and
 * `lt dev up`/`lt dev down` (per-project block management).
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Mapping from public hostname to internal upstream port. */
export interface CaddyRoute {
  hostname: string;
  upstreamPort: number;
}

const CADDYFILE_PATH = process.env.LT_DEV_CADDYFILE || join(homedir(), '.lenneTech', 'Caddyfile');
const HEADER = '# Managed by `lt dev`. Per-project blocks are bounded by `# >>> lt-dev:<slug> >>>` markers.';

/** Outcome of a Caddy command. */
export interface CaddyResult {
  exitCode: null | number;
  ok: boolean;
  stderr: string;
  stdout: string;
}

/** Detect whether `caddy` is on PATH. */
export async function caddyAvailable(): Promise<boolean> {
  const result = await runCaddy(['version']);
  return result.ok;
}

/** Detect whether the Caddy admin endpoint is reachable (i.e. a daemon is running). */
export async function caddyDaemonRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('curl', ['-fsS', '-o', '/dev/null', 'http://localhost:2019/config/'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Read the current Caddyfile (or empty string). */
export function readCaddyfile(): string {
  if (!existsSync(CADDYFILE_PATH)) return '';
  return readFileSync(CADDYFILE_PATH, 'utf8');
}

/**
 * Reload Caddy with the global Caddyfile. Caller is responsible for
 * starting Caddy in the first place (typically via `lt dev install`).
 */
export async function reloadCaddy(): Promise<CaddyResult> {
  return runCaddy(['reload', '--config', CADDYFILE_PATH, '--adapter', 'caddyfile']);
}

/**
 * Remove a project block from the Caddyfile.
 * Returns true if anything was removed.
 */
export function removeProjectBlock(slug: string): boolean {
  const current = readCaddyfile();
  const startMarker = `# >>> lt-dev:${slug} >>>`;
  const endMarker = `# <<< lt-dev:${slug} <<<`;
  const startIdx = current.indexOf(startMarker);
  const endIdx = current.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return false;
  const before = current.slice(0, startIdx).replace(/\n+$/, '');
  const after = current.slice(endIdx + endMarker.length).replace(/^\n+/, '');
  const next = [before, after].filter((s) => s.length > 0).join('\n\n');
  writeCaddyfile(next);
  return true;
}

/**
 * Generate the Caddyfile block for one project's routes.
 *
 * Upstream uses `127.0.0.1:<port>` explicitly — paired with
 * `HOST=127.0.0.1` injected into the dev-server processes (see
 * `dev-env.ts`). This guarantees a single, unambiguous loopback path:
 *
 *   - Vite/Nuxt/Nest, when given `HOST=127.0.0.1`, bind exclusively
 *     to IPv4. There is no second IPv6 listener that could shadow
 *     the port (which had been the source of the 502 / hanging
 *     requests when two processes both registered on `[::1]:<port>`).
 *   - `localhost` as Caddy upstream resolves to `::1` first on macOS,
 *     so it would still pick the IPv6 family and miss the IPv4 bind.
 *     Pinning to `127.0.0.1` removes that ambiguity entirely.
 */
export function renderProjectBlock(slug: string, routes: CaddyRoute[]): string {
  const lines: string[] = [`# >>> lt-dev:${slug} >>>`];
  for (const route of routes) {
    lines.push(`${route.hostname} {`);
    lines.push(`  reverse_proxy 127.0.0.1:${route.upstreamPort}`);
    lines.push('}');
  }
  lines.push(`# <<< lt-dev:${slug} <<<`);
  return lines.join('\n');
}

/**
 * Insert/replace a project block in the Caddyfile.
 *
 * Idempotent — re-applying with the same routes is a no-op.
 * Returns true if the file was modified.
 */
export function upsertProjectBlock(slug: string, routes: CaddyRoute[]): boolean {
  const current = readCaddyfile();
  const block = renderProjectBlock(slug, routes);
  const startMarker = `# >>> lt-dev:${slug} >>>`;
  const endMarker = `# <<< lt-dev:${slug} <<<`;

  const startIdx = current.indexOf(startMarker);
  const endIdx = current.indexOf(endMarker);

  let next: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = current.slice(0, startIdx).replace(/\n+$/, '');
    const after = current.slice(endIdx + endMarker.length).replace(/^\n+/, '');
    next = [before, block, after].filter((s) => s.length > 0).join('\n\n');
  } else {
    next = current.length > 0 ? `${current.replace(/\n+$/, '')}\n\n${block}` : block;
  }
  if (next === current.replace(/\s+$/, '')) return false;
  writeCaddyfile(next);
  return true;
}

/** Validate the current Caddyfile syntax. */
export async function validateCaddyfile(): Promise<CaddyResult> {
  return runCaddy(['validate', '--config', CADDYFILE_PATH, '--adapter', 'caddyfile']);
}

/** Write the Caddyfile, ensuring the parent directory exists. */
export function writeCaddyfile(content: string): void {
  mkdirSync(dirname(CADDYFILE_PATH), { recursive: true });
  const next = content.startsWith('#') ? content : `${HEADER}\n\n${content}`;
  writeFileSync(CADDYFILE_PATH, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
}

/** Run a caddy subcommand and capture stdout/stderr. */
function runCaddy(args: string[]): Promise<CaddyResult> {
  return new Promise((resolve) => {
    const child = spawn('caddy', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let errored = false;
    child.stdout?.on('data', (b) => (stdout += String(b)));
    child.stderr?.on('data', (b) => (stderr += String(b)));
    child.on('error', () => (errored = true));
    child.on('close', (code) => {
      if (errored) resolve({ exitCode: null, ok: false, stderr: 'caddy: command not found', stdout: '' });
      else resolve({ exitCode: code, ok: code === 0, stderr, stdout });
    });
  });
}

/** Path constants for tests + status displays. */
export const paths = {
  caddyfile: CADDYFILE_PATH,
};
