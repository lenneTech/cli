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
import { get as httpGet } from 'http';
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
/** Content of a new Caddyfile (`lt dev install`, or the first on-demand start on Windows). */
const CADDYFILE_STUB = '# lt dev — managed Caddyfile\n# Add per-project blocks via `lt dev up`.\n';
/** Upstream connection cap per route — well below the 128 of macOS `somaxconn` (see `renderProjectBlock`). */
const UPSTREAM_MAX_CONNS = 32;
const HEADER = '# Managed by `lt dev`. Per-project blocks are bounded by `# >>> lt-dev:<slug> >>>` markers.';
/** Start of every project block; the owner marker must never land inside one (see `ensureOwnerMarker`). */
const BLOCK_START = '# >>> lt-dev:';
/**
 * The global option CLI 1.51.0/1.51.1 wrote to keep Caddy off the LAN. It broke `lt dev` on every
 * Mac: macOS lets an unprivileged process bind a port below 1024 only on the WILDCARD address, so
 * `127.0.0.1:443` fails with "bind: permission denied" while `*:443` works (measured: Errno 13 for
 * 127.0.0.1 and ::1, ok for 0.0.0.0 and ::). A running Caddy kept its old config because every
 * reload failed; a restart failed completely. `caddy validate` / `adapt` passed all along, since
 * neither binds. Removed by {@link removeLegacyLoopbackBind} wherever lt writes the Caddyfile.
 */
const LEGACY_LOOPBACK_BIND = /^[ \t]*default_bind[ \t]+127\.0\.0\.1[ \t]+\[::1\][ \t]*\r?$/;

/**
 * Per-site guard that keeps a stack off the LAN instead: Caddy still listens on `*:443`/`*:80`,
 * but answers only connections from this machine and aborts every other one (measured with a
 * throwaway Caddy: 127.0.0.1 and [::1] get the response, the LAN address gets an aborted
 * connection). Without it a running stack answers anyone on the network who sends the right Host
 * header (`curl --resolve`), the `lt dev test` stack with its seeded admin included, whose
 * password is in this public repository (`TEST_INITIAL_ADMIN_ENV`).
 */
const LOOPBACK_ONLY = ['  @lt_remote not remote_ip 127.0.0.0/8 ::1', '  abort @lt_remote'];

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
  /** `caddy adapt` of our Caddyfile (default: the real one, see `compareLoadedConfig`). */
  adapt?: () => Promise<CaddyResult>;
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

/** How the config the running Caddy serves relates to the Caddyfile on disk. */
export type LoadedConfigState = 'differs' | 'matches' | 'unknown';

/**
 * Add the loopback guard ({@link LOOPBACK_ONLY}) to every site block inside lt's own markers
 * (`# >>> lt-dev:<slug> >>>` … `# <<<`) that lacks it. Blocks outside the markers are the user's
 * and stay untouched. Pure and idempotent. Exists so that one migration step protects EVERY
 * project of a machine, not only the one whose `lt dev up` happens to run next: removing the
 * 1.51.x `default_bind` without this would leave all other running stacks reachable from the LAN.
 * @param content - Caddyfile content
 * @returns Content in which every managed site block starts with the guard
 */
export function addLoopbackGuards(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let managed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    if (line.startsWith('# >>> lt-dev:')) managed = true;
    else if (line.startsWith('# <<< lt-dev:')) managed = false;
    else if (
      managed &&
      /^\S.*\{\s*$/.test(line) &&
      !line.startsWith('#') &&
      lines[i + 1]?.trim() !== LOOPBACK_ONLY[0].trim()
    ) {
      out.push(...LOOPBACK_ONLY);
    }
  }
  return out.join('\n');
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
 * Whether the running Caddy serves the current Caddyfile.
 *
 * A failed reload leaves Caddy on its previous config, and no other check sees it: the admin
 * endpoint answers, port 443 is held by Caddy, and `caddy validate` passes because validating
 * never binds. That was the state of CLI 1.51.0 on macOS: every reload died on
 * `listen tcp 127.0.0.1:443: bind: permission denied`, the old Caddy kept serving the old routes,
 * and `lt dev doctor` reported "all checks passed". So this compares what Caddy has loaded
 * (`GET /config/`) with what the file adapts to. Read-only: it neither reloads nor writes.
 *
 * Measured against a live daemon: both sides are equal once keys are sorted (Caddy re-marshals
 * the stored config, so only the key order differs), a changed upstream port or the 1.51.x
 * `default_bind` reads as `differs`, and a Caddyfile without project blocks is `{}` on both sides.
 * @param adapt - Adapts the Caddyfile to JSON (injectable for tests)
 * @param loaded - The JSON the daemon serves, or null when it cannot be read (injectable for tests)
 * @returns `unknown` when either side cannot be read or parsed
 */
export async function compareLoadedConfig(
  adapt: () => Promise<CaddyResult> = () => runCaddy(['adapt', '--config', CADDYFILE_PATH, '--adapter', 'caddyfile']),
  loaded: () => Promise<null | string> = loadedCaddyConfig,
): Promise<LoadedConfigState> {
  const adapted = await adapt();
  if (!adapted.ok) {
    return 'unknown';
  }
  const served = await loaded();
  if (served === null) {
    return 'unknown';
  }
  try {
    return sameCaddyConfig(JSON.parse(adapted.stdout), JSON.parse(served)) ? 'matches' : 'differs';
  } catch {
    return 'unknown';
  }
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
 * - No marker, but {@link compareLoadedConfig} says the loaded config is exactly
 *   what our Caddyfile adapts to → `ours`. This is how instances started before
 *   the marker existed are recognised; their next reload then carries the marker.
 *   Callers must therefore ask BEFORE anything rewrites the Caddyfile, and that
 *   includes {@link migrateCaddyfile}: its guards and its marker change what the
 *   file adapts to. An instance holding our stub serves `{}`, as the stub adapts
 *   to; a Caddy started without any config serves `null` and is not ours
 *   (measured, caddy v2.11.3).
 * - Anything else, a Caddyfile that cannot be adapted included → `foreign`: no
 *   proof, no reload.
 */
export async function detectCaddyOwner(deps: CaddyOwnerDeps = {}): Promise<CaddyOwner> {
  const answer = await (deps.fetchConfig ?? (() => fetchAdminConfig()))();
  if (answer === null) return 'none';
  const loaded = answer.status === 200 ? parseJsonOrUndefined(answer.body) : undefined;
  if (loaded === undefined) return 'foreign';
  if (hasOwnerMarker(loaded)) return 'ours';
  return (await compareLoadedConfig(deps.adapt, async () => answer.body)) === 'matches' ? 'ours' : 'foreign';
}

/**
 * Create the Caddyfile with `stub` when it is missing; otherwise repair it with
 * {@link migrateCaddyfile}. Never replaces an existing file: `lt dev install` used to write the
 * stub on every run, which dropped the routes of every registered project, although its own
 * docs said "if absent".
 * @param stub - Content for a new Caddyfile
 * @returns true if the file was created or changed
 */
export function ensureCaddyfile(stub: string = CADDYFILE_STUB): boolean {
  if (!existsSync(CADDYFILE_PATH)) {
    writeCaddyfile(stub);
    return true;
  }
  return healCaddyfile();
}

/**
 * Add the owner marker to a Caddyfile, idempotently. A global options block must
 * come first in a Caddyfile, so the marker goes into an existing one or becomes
 * a new one right after the leading comments. The leading comments end at the
 * first project block: a marker placed after `# >>> lt-dev:<slug> >>>` would sit
 * inside that block, and `removeProjectBlock` would take it along.
 * @param content - Caddyfile content
 * @returns Content whose global options block carries `log lt-dev-owner { output discard }`
 */
export function ensureOwnerMarker(content: string): string {
  if (new RegExp(`^\\s*log\\s+${OWNER_LOGGER}\\b`, 'm').test(content)) return content;
  const lines = content.split('\n');
  const isLeading = (line: string): boolean =>
    !line.startsWith(BLOCK_START) && (line.trim() === '' || line.trim().startsWith('#'));
  let first = 0;
  while (first < lines.length && isLeading(lines[first])) first++;
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
    "Load it into that Caddy (replaces that Caddy's whole configuration):",
    `  caddy reload --config "${caddyfile}" --adapter caddyfile`,
    "Or, once :2019 is free, run lt dev's own Caddy:",
    `  caddy run --config "${caddyfile}" --adapter caddyfile`,
  ];
}

/**
 * Whether the Caddyfile still carries the `default_bind` of CLI 1.51.0/1.51.1 (see
 * {@link LEGACY_LOOPBACK_BIND}). Every lt write removes it; this only names it as the cause when
 * nothing has written the file since.
 * @param content - Caddyfile content
 */
export function hasLegacyLoopbackBind(content: string): boolean {
  return content.split('\n').some((line) => LEGACY_LOOPBACK_BIND.test(line));
}

/**
 * Apply {@link migrateCaddyfile} to the file on disk and write it back if that changed anything.
 * Never creates a missing file (that is {@link ensureCaddyfile}).
 * @returns true if the Caddyfile was changed (the caller reloads Caddy, if it is ours)
 */
export function healCaddyfile(): boolean {
  const current = readCaddyfile();
  if (!current || migrateCaddyfile(current) === current) {
    return false;
  }
  writeCaddyfile(current);
  return true;
}

/** The config the running Caddy serves (`GET /config/`), or null when the admin API does not answer 200. */
export async function loadedCaddyConfig(timeoutMs = 2000): Promise<null | string> {
  const answer = await fetchAdminConfig(timeoutMs);
  return answer?.status === 200 ? answer.body : null;
}

/**
 * Every repair lt applies to a Caddyfile it writes, in ONE step, so no write ever leaves a stack
 * without one of them: drop the 1.51.x `default_bind`, give every managed block the loopback
 * guard, and carry the owner marker (`ensureOwnerMarker`). Pure and idempotent.
 * @param content - Caddyfile content
 * @returns The repaired content
 */
export function migrateCaddyfile(content: string): string {
  return ensureOwnerMarker(addLoopbackGuards(removeLegacyLoopbackBind(content)));
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
 * Undo what CLI 1.51.0/1.51.1 added to the global options block (see {@link LEGACY_LOOPBACK_BIND}).
 * Removes exactly that `default_bind` line; a different `default_bind` the user set is kept. A
 * global block left empty by the removal is dropped as well. Pure and idempotent.
 * @param content - Caddyfile content
 * @returns Content without lt's `default_bind 127.0.0.1 [::1]`
 */
export function removeLegacyLoopbackBind(content: string): string {
  const lines = content.split('\n');
  const at = lines.findIndex((line) => LEGACY_LOOPBACK_BIND.test(line));
  if (at === -1) {
    return content;
  }
  const next = [...lines.slice(0, at), ...lines.slice(at + 1)];
  // Drop a global block that is now `{` + `}` only, plus one blank line after it.
  const open = next.findIndex((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (open !== -1 && next[open].trim() === '{' && next[open + 1]?.trim() === '}') {
    const removeBlank = next[open + 2]?.trim() === '' ? 1 : 0;
    next.splice(open, 2 + removeBlank);
  }
  return next.join('\n');
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
 *
 * Every upstream is capped at `UPSTREAM_MAX_CONNS` connections. The browser
 * talks HTTP/2 to Caddy and multiplexes a cold `nuxt dev`'s first page load —
 * around 800 raw modules — over one connection; Caddy used to fan that out
 * into one upstream dial per request. The dev server's accept queue
 * (`somaxconn`, 128 on macOS) overflowed, the excess dials got `connect:
 * connection reset by peer`, Caddy answered 502, and a page missing a module
 * never hydrated: the form looked fine and submitted natively. With the cap,
 * Caddy queues the burst instead (Go's `MaxConnsPerHost` blocks the dial).
 * `~/.lenneTech/caddy.err.log` held about 51 000 such resets across projects
 * when this was found (lt-crm DEV-2899).
 */
export function renderProjectBlock(slug: string, routes: CaddyRoute[]): string {
  const lines: string[] = [`# >>> lt-dev:${slug} >>>`];
  for (const route of routes) {
    lines.push(`${route.hostname} {`);
    lines.push(...LOOPBACK_ONLY);
    lines.push(`  reverse_proxy 127.0.0.1:${route.upstreamPort} {`);
    lines.push('    transport http {');
    lines.push(`      max_conns_per_host ${UPSTREAM_MAX_CONNS}`);
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
  }
  lines.push(`# <<< lt-dev:${slug} <<<`);
  return lines.join('\n');
}

/**
 * Compare two Caddy JSON configs by content. Object key order is ignored, because Caddy
 * re-marshals the config it stores and `GET /config/` returns its keys in a different order than
 * `caddy adapt` writes them. Array order counts: routes and handlers run in that order.
 * @param a - A Caddy JSON config
 * @param b - Another Caddy JSON config
 */
export function sameCaddyConfig(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonical);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
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
  // Also removes the `default_bind` of CLI 1.51.0/1.51.1, which kept Caddy from binding on macOS,
  // and adds the owner marker; the reload that follows every upsert then applies the repaired file.
  next = migrateCaddyfile(next);
  if (next.replace(/\s+$/, '') === current.replace(/\s+$/, '')) return false;
  writeCaddyfile(next);
  return true;
}

/** Validate the current Caddyfile syntax. */
export async function validateCaddyfile(): Promise<CaddyResult> {
  return runCaddy(['validate', '--config', CADDYFILE_PATH, '--adapter', 'caddyfile']);
}

/** Write the Caddyfile, ensuring the parent directory exists. Every write goes through {@link migrateCaddyfile}. */
export function writeCaddyfile(content: string): void {
  mkdirSync(dirname(CADDYFILE_PATH), { recursive: true });
  const next = migrateCaddyfile(content.startsWith('#') ? content : `${HEADER}\n\n${content}`);
  writeFileSync(CADDYFILE_PATH, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
}

/**
 * Status and body of `GET /config/` on the admin API, or null when nothing answers. The one
 * request behind both {@link detectCaddyOwner} (which must tell "nothing answers" from "something
 * answers with an error") and {@link loadedCaddyConfig}.
 */
function fetchAdminConfig(timeoutMs = 2000): Promise<HttpAnswer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: HttpAnswer | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const request = httpGet('http://127.0.0.1:2019/config/', { timeout: timeoutMs }, (response) => {
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
    } catch {
      done(null);
    }
  });
}

function hasOwnerMarker(config: unknown): boolean {
  const logs = (config as null | { logging?: { logs?: Record<string, unknown> } })?.logging?.logs;
  return !!logs && Object.prototype.hasOwnProperty.call(logs, OWNER_LOGGER);
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
