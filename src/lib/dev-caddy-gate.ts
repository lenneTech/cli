/**
 * The one check every `lt dev` command makes before it relies on Caddy.
 *
 * Answers "may we use the Caddy on :2019?", repairs our Caddyfile on the way and,
 * on Windows, starts ours when none runs. Whatever the answer, a caller gets
 * either `ok` or the lines to print; no command formulates its own Caddy advice
 * any more. That used to produce "run `lt dev install`" on Windows, where
 * `install` said "not supported" — advice into the void.
 */
import {
  caddyAvailable,
  type CaddyOwner,
  type CaddyResult,
  detectCaddyOwner,
  ensureCaddyfile,
  foreignCaddyLines,
  healCaddyfile,
  paths,
  reloadCaddy,
} from './caddy';
import { caddyLaunchMode, startCaddyOnDemand, waitForServiceReady } from './dev-service';

/** Result of `ensureOwnCaddy`. `lines` and `reason` are set when `ok` is false. */
export interface CaddyGate {
  lines: string[];
  ok: boolean;
  reason?: 'down' | 'foreign' | 'missing' | 'reload-failed' | 'start-failed';
  started: boolean;
}

/** Injection points, so each branch is testable without Caddy. */
export interface CaddyGateDeps {
  available?: () => Promise<boolean>;
  detectOwner?: () => Promise<CaddyOwner>;
  /** Repairs an existing Caddyfile (`healCaddyfile`); true when it changed the file. */
  heal?: () => boolean;
  launchMode?: ReturnType<typeof caddyLaunchMode>;
  /** Makes sure the Caddyfile exists before an on-demand start (`ensureCaddyfile`). */
  prepareCaddyfile?: () => void;
  reload?: () => Promise<CaddyResult>;
  start?: () => Promise<{ logFile: string; message: string; ok: boolean }>;
  /** Waits for the admin API after a repair, so a service manager can restart Caddy. */
  waitReady?: (timeoutMs: number) => Promise<boolean>;
}

/**
 * Establish that the Caddy on :2019 is ours, with our repaired Caddyfile loaded.
 *
 * Order, and why:
 * 1. Ownership first. A Caddy started before the owner marker existed is
 *    recognised by its config matching the Caddyfile, so nothing may have
 *    rewritten the file yet — the repair in step 2 included.
 * 2. Then repair the Caddyfile (`healCaddyfile`: drop the 1.51.0/1.51.1
 *    `default_bind`, guard every block, add the owner marker). It writes our
 *    file only, never the running Caddy, so it runs for a foreign Caddy too: the
 *    `caddy reload` that `foreignCaddyLines` names then loads a file that binds.
 * 3. By owner:
 *    - `ours` → ok. A repaired file is reloaded right away; otherwise a
 *      pre-marker instance would no longer match the file, and the next check
 *      would take our own Caddy for a foreign one.
 *    - `foreign` → refused, with `foreignCaddyLines`. Never started over, never
 *      reloaded, never stopped.
 *    - `none` → on Windows (`on-demand`) with `startIfDown`, ours is started
 *      (`startOwnCaddy`). With a service (macOS/Linux) the service owns the
 *      lifecycle: after a repair, wait for it to restart Caddy (the 1.51.x
 *      `default_bind` keeps Caddy from starting on macOS at all, and the
 *      LaunchAgent's `KeepAlive` / systemd's `Restart=on-failure` bring it back
 *      once the file binds); otherwise the answer is `lt dev install`.
 */
export async function ensureOwnCaddy(opts: { startIfDown: boolean }, deps: CaddyGateDeps = {}): Promise<CaddyGate> {
  const available = deps.available ?? caddyAvailable;
  const detectOwner = deps.detectOwner ?? (() => detectCaddyOwner());
  const mode = deps.launchMode ?? caddyLaunchMode();

  if (!(await available())) {
    return {
      lines: ['caddy is not installed. Run `lt dev install` first.'],
      ok: false,
      reason: 'missing',
      started: false,
    };
  }

  const owner = await detectOwner();
  const healed = (deps.heal ?? healCaddyfile)();

  if (owner === 'foreign') return { lines: foreignCaddyLines(), ok: false, reason: 'foreign', started: false };
  if (owner === 'ours') {
    if (!healed) return { lines: [], ok: true, started: false };
    const reload = await (deps.reload ?? reloadCaddy)();
    if (reload.ok) return { lines: [], ok: true, started: false };
    return {
      lines: [`caddy reload failed: ${reload.stderr.split('\n')[0]}`, `  Caddyfile: ${paths.caddyfile}`],
      ok: false,
      reason: 'reload-failed',
      started: false,
    };
  }

  if (mode === 'on-demand' && opts.startIfDown) return startOwnCaddy(deps);
  if (mode === 'service' && healed && (await (deps.waitReady ?? waitForServiceReady)(20_000))) {
    return identify(detectOwner, false, downAdvice(mode));
  }
  return { lines: [downAdvice(mode)], ok: false, reason: 'down', started: false };
}

/**
 * Start our Caddy (Windows, `on-demand`) and accept it only once it identifies
 * as ours. For callers that have seen `detectCaddyOwner() === 'none'`; this
 * starts a Caddy, it never replaces one. `lt dev install` uses it directly.
 */
export async function startOwnCaddy(deps: CaddyGateDeps = {}): Promise<CaddyGate> {
  const detectOwner = deps.detectOwner ?? (() => detectCaddyOwner());
  (deps.prepareCaddyfile ?? (() => ensureCaddyfile()))();
  const started = await (deps.start ?? (() => startCaddyOnDemand()))();
  if (!started.ok) {
    return { lines: [started.message, `  Log: ${started.logFile}`], ok: false, reason: 'start-failed', started: false };
  }
  return identify(detectOwner, true, `Caddy did not come up. Log: ${started.logFile}`);
}

/** What to do when no Caddy runs, per launch mode. */
function downAdvice(mode: ReturnType<typeof caddyLaunchMode>): string {
  if (mode === 'service') return 'caddy daemon is not running. Run `lt dev install` to start the lt-dev service.';
  if (mode === 'on-demand') return 'caddy is not running. `lt dev up` starts it.';
  return `caddy is not running. Start it with: caddy run --config "${paths.caddyfile}" --adapter caddyfile`;
}

/** After a (re)start: the Caddy on :2019 counts only once it identifies as ours. */
async function identify(detectOwner: () => Promise<CaddyOwner>, started: boolean, failure: string): Promise<CaddyGate> {
  // Something may have taken :2019 between our check and the start.
  const after = await detectOwner();
  if (after === 'ours') return { lines: [], ok: true, started };
  if (after === 'foreign') return { lines: foreignCaddyLines(), ok: false, reason: 'foreign', started: false };
  return { lines: [failure], ok: false, reason: started ? 'start-failed' : 'down', started: false };
}
