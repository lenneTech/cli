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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
/** Upstream connection cap per route — well below the 128 of macOS `somaxconn` (see `renderProjectBlock`). */
const UPSTREAM_MAX_CONNS = 32;
const HEADER = '# Managed by `lt dev`. Per-project blocks are bounded by `# >>> lt-dev:<slug> >>>` markers.';
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

/** Outcome of a Caddy command. */
export interface CaddyResult {
  exitCode: null | number;
  ok: boolean;
  stderr: string;
  stdout: string;
}

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
 * Apply {@link migrateCaddyfile} to the file on disk and write it back if that changed anything.
 * For paths that write no project block, such as `lt dev up` on a stack that is already running
 * when its ports are unknown.
 * @returns true if the Caddyfile was changed (the caller reloads Caddy)
 */
export function healCaddyfile(): boolean {
  const current = readCaddyfile();
  if (!current || migrateCaddyfile(current) === current) {
    return false;
  }
  writeCaddyfile(current);
  return true;
}

/**
 * Every repair lt applies to a Caddyfile it writes: drop the 1.51.x `default_bind` and give every
 * managed block the loopback guard, in ONE step, so no write ever leaves a stack without either.
 * @param content - Caddyfile content
 * @returns The repaired content
 */
export function migrateCaddyfile(content: string): string {
  return addLoopbackGuards(removeLegacyLoopbackBind(content));
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
  // Also removes the `default_bind` of CLI 1.51.0/1.51.1, which kept Caddy from binding on macOS;
  // the reload that follows every upsert then applies the repaired file.
  next = migrateCaddyfile(next);
  if (next.replace(/\s+$/, '') === current.replace(/\s+$/, '')) return false;
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
  const next = migrateCaddyfile(content.startsWith('#') ? content : `${HEADER}\n\n${content}`);
  writeFileSync(CADDYFILE_PATH, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
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
