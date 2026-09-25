/**
 * The one check every `lt dev` command makes before it relies on Caddy.
 *
 * Answers "may we use the Caddy on :2019?" and, on Windows, starts ours when
 * none runs. Whatever the answer, a caller gets either `ok` or the lines to
 * print; no command formulates its own Caddy advice any more. That used to
 * produce "run `lt dev install`" on Windows, where `install` said "not
 * supported" — advice into the void.
 */
import { caddyAvailable, type CaddyOwner, detectCaddyOwner, ensureCaddyfile, foreignCaddyLines, paths } from './caddy';
import { caddyLaunchMode, startCaddyOnDemand } from './dev-service';

/** Result of `ensureOwnCaddy`. `lines` and `reason` are set when `ok` is false. */
export interface CaddyGate {
  lines: string[];
  ok: boolean;
  reason?: 'down' | 'foreign' | 'missing' | 'start-failed';
  started: boolean;
}

/** Injection points, so each branch is testable without Caddy. */
export interface CaddyGateDeps {
  available?: () => Promise<boolean>;
  detectOwner?: () => Promise<CaddyOwner>;
  launchMode?: ReturnType<typeof caddyLaunchMode>;
  prepareCaddyfile?: () => void;
  start?: () => Promise<{ logFile: string; message: string; ok: boolean }>;
}

/**
 * Establish that the Caddy on :2019 is ours.
 *
 * - `ours` → ok.
 * - `foreign` → refused, with `foreignCaddyLines`. Never started over, never
 *   reloaded, never stopped.
 * - `none` → on Windows (`on-demand`) and with `startIfDown`, ours is started,
 *   and then it must identify as ours; anything else is a failed start, not a
 *   success. With a service (macOS/Linux) the service owns the lifecycle, so the
 *   answer is `lt dev install`.
 */
export async function ensureOwnCaddy(opts: { startIfDown: boolean }, deps: CaddyGateDeps = {}): Promise<CaddyGate> {
  const available = deps.available ?? caddyAvailable;
  const detectOwner = deps.detectOwner ?? (() => detectCaddyOwner());
  const mode = deps.launchMode ?? caddyLaunchMode();

  if (!(await available())) {
    return { lines: ['caddy is not installed. Run `lt dev install` first.'], ok: false, reason: 'missing', started: false };
  }

  const owner = await detectOwner();
  if (owner === 'ours') return { lines: [], ok: true, started: false };
  if (owner === 'foreign') return { lines: foreignCaddyLines(), ok: false, reason: 'foreign', started: false };

  if (mode === 'on-demand' && opts.startIfDown) {
    (deps.prepareCaddyfile ?? ensureCaddyfile)();
    const started = await (deps.start ?? (() => startCaddyOnDemand()))();
    if (!started.ok) {
      return { lines: [started.message, `  Log: ${started.logFile}`], ok: false, reason: 'start-failed', started: false };
    }
    // Something may have taken :2019 between our check and the start.
    const after = await detectOwner();
    if (after === 'ours') return { lines: [], ok: true, started: true };
    if (after === 'foreign') return { lines: foreignCaddyLines(), ok: false, reason: 'foreign', started: false };
    return { lines: [`Caddy did not come up. Log: ${started.logFile}`], ok: false, reason: 'start-failed', started: false };
  }

  return { lines: [downAdvice(mode)], ok: false, reason: 'down', started: false };
}

/** What to do when no Caddy runs, per launch mode. */
function downAdvice(mode: ReturnType<typeof caddyLaunchMode>): string {
  if (mode === 'service') return 'caddy daemon is not running. Run `lt dev install` to start the lt-dev service.';
  if (mode === 'on-demand') return 'caddy is not running. `lt dev up` starts it.';
  return `caddy is not running. Start it with: caddy run --config "${paths.caddyfile}" --adapter caddyfile`;
}
