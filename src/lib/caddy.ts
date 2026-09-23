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
 *
 * **`lt dev` never touches a Caddy it did not start.** Someone who runs Caddy
 * runs it for something, possibly a client project on :443. Reloading our config
 * into it would silently reroute or cut off those sites, and the person affected
 * would look for the fault everywhere but here. So every write to the running
 * instance goes through `detectCaddyOwner` first, and a foreign instance gets a
 * diagnosis plus the commands to act on it (`foreignCaddyLines`), never an action.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { httpStatus } from './dev-process';
import { spawnCmd } from './platform';

/** Mapping from public hostname to internal upstream port. */
export interface CaddyRoute {
  hostname: string;
  upstreamPort: number;
}

const CADDYFILE_PATH = process.env.LT_DEV_CADDYFILE || join(homedir(), '.lenneTech', 'Caddyfile');
const HEADER = '# Managed by `lt dev`. Per-project blocks are bounded by `# >>> lt-dev:<slug> >>>` markers.';

/**
 * Name of the logger that marks a running Caddy as ours.
 *
 * Comments do not survive: Caddy adapts the Caddyfile to JSON and drops them, so
 * the `# >>> lt-dev:<slug> >>>` markers never reach `GET /config/`. A named
 * logger does, even in a Caddyfile without a single site, and `output discard`
 * makes it inert: the default logger keeps logging exactly as before (measured
 * with caddy v2.11.3). An explicit marker, rather than recognising our site
 * blocks, so that "recognises itself" does not depend on how blocks are named.
 */
export const OWNER_LOGGER = 'lt-dev-owner';
const OWNER_DIRECTIVE = [`\tlog ${OWNER_LOGGER} {`, '\t\toutput discard', '\t}'];

/** Who holds the Caddy admin endpoint on :2019. */
export type CaddyOwner = 'foreign' | 'none' | 'ours';

/** Injection points for `detectCaddyOwner`, so every branch is testable without a daemon. */
export interface CaddyOwnerDeps {
  /** `caddy adapt` of our Caddyfile as parsed JSON, or undefined when it cannot be adapted. */
  adaptOwn?: () => Promise<unknown>;
  /** Answer to `GET /config/`, or null when nothing answers at all. */
  fetchConfig?: () => Promise<HttpAnswer | null>;
}

/** Outcome of a Caddy command. */
export interface CaddyResult {
  exitCode: null | number;
  ok: boolean;
  stderr: string;
  stdout: string;
}

/** Status and body of an HTTP answer. */
export interface HttpAnswer {
  body: string;
  status: number;
}

/** Detect whether `caddy` is on PATH. */
export async function caddyAvailable(): Promise<boolean> {
  const result = await runCaddy(['version']);
  return result.ok;
}

/**
 * Detect whether the Caddy admin endpoint is reachable (i.e. a daemon is running).
 *
 * This asked `curl -fsS -o /dev/null`, and on Windows that reported a running
 * Caddy as down: `/dev/null` is an ordinary file path there, so curl completed
 * the request, received the 226-byte answer, failed to WRITE it, and exited 23.
 * The exit code was all this function looked at. Measured on the laptop against a
 * Caddy that was listening on :2019 and answering 200.
 *
 * `127.0.0.1` rather than `localhost` for consistency with the reverse-proxy
 * upstreams (see the note above `renderProjectBlock`) — not because `localhost`
 * was the fault here; it was measured to resolve correctly on that machine.
 */
export async function caddyDaemonRunning(): Promise<boolean> {
  return (await httpStatus('http://127.0.0.1:2019/config/', 2000)) !== null;
}

/**
 * Decide whether the running Caddy is ours: by what it has LOADED, never by which
 * process it is. A process check would need the command line, which is read
 * differently on every platform, so on each of them one branch would go untested.
 *
 * - Nothing answers on :2019 → `none`.
 * - Something answers, but not with a readable config (an error status, not
 *   JSON) → `foreign`. Something holds the port, and it is not us.
 * - The loaded config carries the `OWNER_LOGGER` marker → `ours`.
 * - No marker, but the loaded config is exactly what our Caddyfile adapts to →
 *   `ours`. This is how instances started before the marker existed are
 *   recognised; their next reload then carries the marker. Callers must
 *   therefore ask BEFORE they rewrite the Caddyfile. It also matches a Caddy that
 *   has loaded nothing while our file is still an empty stub; replacing an empty
 *   config cannot disturb anything that is being served.
 * - Anything else → `foreign`.
 */
export async function detectCaddyOwner(deps: CaddyOwnerDeps = {}): Promise<CaddyOwner> {
  const fetchConfig = deps.fetchConfig ?? (() => httpGetText('http://127.0.0.1:2019/config/', 2000));
  const answer = await fetchConfig();
  if (answer === null) return 'none';
  const loaded = answer.status >= 200 && answer.status < 300 ? parseJsonOrUndefined(answer.body) : undefined;
  if (loaded === undefined) return 'foreign';
  if (hasOwnerMarker(loaded)) return 'ours';
  const adaptOwn = deps.adaptOwn ?? adaptOwnCaddyfile;
  const own = await adaptOwn();
  if (own === undefined) return 'foreign';
  return canonicalJson(loaded ?? {}) === canonicalJson(own ?? {}) ? 'ours' : 'foreign';
}

/**
 * Make sure our Caddyfile exists and carries the owner marker, without touching
 * its project blocks. `lt dev install` used to write the empty stub on every run,
 * which dropped the block of every project that was up at the time.
 */
export function ensureCaddyfile(): void {
  if (!existsSync(CADDYFILE_PATH)) {
    writeCaddyfile('# lt dev — managed Caddyfile\n# Add per-project blocks via `lt dev up`.\n');
    return;
  }
  const current = readCaddyfile();
  if (ensureOwnerMarker(current) !== current) writeCaddyfile(current);
}

/**
 * Add the owner marker to a Caddyfile, idempotently. A global options block must
 * come first in a Caddyfile, so the marker goes into an existing one or becomes
 * a new one right after the leading comments.
 */
export function ensureOwnerMarker(content: string): string {
  if (new RegExp(`^\\s*log\\s+${OWNER_LOGGER}\\b`, 'm').test(content)) return content;
  const lines = content.split('\n');
  let first = 0;
  while (first < lines.length && (lines[first].trim() === '' || lines[first].trim().startsWith('#'))) first++;
  if (first < lines.length && lines[first].trim() === '{') {
    lines.splice(first + 1, 0, ...OWNER_DIRECTIVE);
    return lines.join('\n');
  }
  const head = lines.slice(0, first).join('\n').replace(/\n+$/, '');
  const rest = lines.slice(first).join('\n').replace(/^\n+/, '');
  const block = ['{', ...OWNER_DIRECTIVE, '}'].join('\n');
  return [head, block, rest].filter((part) => part.length > 0).join('\n\n');
}

/**
 * What to tell someone whose Caddy on :2019 is not ours. A diagnosis and the
 * commands to act on it; deliberately no command that stops their Caddy. Whether
 * to end it, adopt our config or ignore us is their decision.
 */
export function foreignCaddyLines(caddyfile: string = CADDYFILE_PATH): string[] {
  return [
    'A Caddy is running on :2019 that `lt dev` did not start. It was left untouched.',
    `lt dev's config: ${caddyfile}`,
    'Load it into that Caddy (replaces that Caddy\'s whole configuration):',
    `  caddy reload --config "${caddyfile}" --adapter caddyfile`,
    'Or, once :2019 is free, run lt dev\'s own Caddy:',
    `  caddy run --config "${caddyfile}" --adapter caddyfile`,
  ];
}

/** Read the current Caddyfile (or empty string). */
export function readCaddyfile(): string {
  if (!existsSync(CADDYFILE_PATH)) return '';
  return readFileSync(CADDYFILE_PATH, 'utf8');
}

/**
 * Reload Caddy with the global Caddyfile. This REPLACES whatever config the
 * running Caddy holds, so callers must have established
 * `detectCaddyOwner() === 'ours'` (or passed `ensureOwnCaddy`) first — asked
 * before they rewrote the Caddyfile. Starting Caddy is not this function's job.
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
 * Stop the running Caddy through its admin API. Callers must have established
 * `detectCaddyOwner() === 'ours'` first: this stops whatever answers on :2019.
 */
export async function stopCaddy(): Promise<CaddyResult> {
  return runCaddy(['stop']);
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
  const next = ensureOwnerMarker(content.startsWith('#') ? content : `${HEADER}\n\n${content}`);
  writeFileSync(CADDYFILE_PATH, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
}

/** `caddy adapt` of our Caddyfile, parsed; undefined when it cannot be adapted. */
async function adaptOwnCaddyfile(): Promise<unknown> {
  if (!existsSync(CADDYFILE_PATH)) return {};
  const result = await runCaddy(['adapt', '--config', CADDYFILE_PATH, '--adapter', 'caddyfile']);
  if (!result.ok) return undefined;
  const parsed = parseJsonOrUndefined(result.stdout);
  return parsed === undefined ? undefined : parsed;
}

/** JSON with sorted keys, so two equal configs compare equal regardless of key order. */
function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

function hasOwnerMarker(config: unknown): boolean {
  const logs = (config as null | { logging?: { logs?: Record<string, unknown> } })?.logging?.logs;
  return !!logs && Object.prototype.hasOwnProperty.call(logs, OWNER_LOGGER);
}

/** Status and body of a plain-http GET, or null when nothing answers. */
function httpGetText(url: string, timeoutMs: number): Promise<HttpAnswer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: HttpAnswer | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const request = httpRequest(url, { timeout: timeoutMs }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => done({ body, status: response.statusCode ?? 0 }));
        response.on('error', () => done({ body, status: 0 }));
      });
      request.on('timeout', () => {
        request.destroy();
        done(null);
      });
      request.on('error', () => done(null));
      request.end();
    } catch {
      done(null);
    }
  });
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Run a caddy subcommand and capture stdout/stderr. */
function runCaddy(args: string[]): Promise<CaddyResult> {
  return new Promise((resolve) => {
    const child = spawnCmd('caddy', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
