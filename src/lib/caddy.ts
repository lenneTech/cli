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
 * Global options block that keeps Caddy on the loopback interfaces. Without it every site block
 * listens on `*:443`/`*:80`, so a running stack answers anyone on the same network who sends
 * the right Host header (`curl --resolve`), including the `lt dev test` stack with its seeded
 * admin, whose password is in this public repository (`TEST_INITIAL_ADMIN_ENV`). `*.localhost`
 * does not resolve on other machines anyway, so nothing legitimate is lost.
 */
const LOOPBACK_BIND = 'default_bind 127.0.0.1 [::1]';

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
 * Make sure a Caddyfile binds to loopback only. Pure and idempotent.
 *
 * - No global options block: one is inserted after the leading comments (the global block
 *   must be the first block of a Caddyfile).
 * - A global block without `default_bind`: the option is added inside it, the rest is kept.
 * - A global block that already sets `default_bind`: unchanged, whatever it binds to. That is
 *   a deliberate choice of the user, not something to overwrite.
 * @param content - Caddyfile content
 * @returns Content with a loopback `default_bind`
 */
export function ensureLoopbackBind(content: string): string {
  const lines = content.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '' && !line.trim().startsWith('#'));

  if (first !== -1 && lines[first].trim() === '{') {
    let depth = 0;
    let end = lines.length - 1;
    for (let i = first; i < lines.length; i++) {
      const code = lines[i].replace(/#.*$/, '');
      depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (lines.slice(first + 1, end).some((line) => /^\s*default_bind\b/.test(line))) {
      return content;
    }
    return [...lines.slice(0, first + 1), `\t${LOOPBACK_BIND}`, ...lines.slice(first + 1)].join('\n');
  }

  // Insert before the first site block AND before the first project marker: a block placed
  // between `# >>> lt-dev:<slug> >>>` and its site would be removed with that project.
  const block = ['{', `\t${LOOPBACK_BIND}`, '}'];
  const insertAt = lines.findIndex(
    (line) => line.trim() !== '' && (!line.trim().startsWith('#') || line.trim().startsWith('# >>> lt-dev:')),
  );
  if (insertAt === -1) {
    const body = content.replace(/\n+$/, '');
    return body ? `${body}\n\n${block.join('\n')}\n` : `${block.join('\n')}\n`;
  }
  const head = lines.slice(0, insertAt);
  while (head.length > 0 && head[head.length - 1].trim() === '') head.pop();
  return [...head, ...(head.length > 0 ? [''] : []), ...block, '', ...lines.slice(insertAt)].join('\n');
}

/**
 * Add the loopback bind to an existing Caddyfile that lacks it. For paths that do not upsert a
 * project block, such as `lt dev up` on a stack that is already running: without this, a stack
 * started before the bind existed stays reachable from the LAN until its next restart.
 * @returns true if the Caddyfile was changed (the caller reloads Caddy)
 */
export function healLoopbackBind(): boolean {
  const current = readCaddyfile();
  if (!current || ensureLoopbackBind(current) === current) {
    return false;
  }
  writeCaddyfile(current);
  return true;
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
  // Also heals a Caddyfile written before the loopback bind existed: the reload that follows
  // every upsert then moves the running Caddy off the LAN interfaces.
  next = ensureLoopbackBind(next);
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
  const next = ensureLoopbackBind(content.startsWith('#') ? content : `${HEADER}\n\n${content}`);
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
