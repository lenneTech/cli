/**
 * The one check every `lt dev` command makes before it relies on Caddy.
 *
 * Answers "may this command use the Caddy on :2019?" and, on Windows, starts lt dev's own Caddy
 * when none runs. A caller gets either `ok` or the lines to print, so no command formulates its
 * own Caddy advice. That used to produce "run `lt dev install`" on Windows, where `install`
 * answered "not supported".
 */
import {
  CADDYFILE_STUB,
  type CaddyOwner,
  detectCaddyOwner,
  ensureCaddyfile,
  foreignCaddyLines,
  paths,
  prepareCaddy,
} from './caddy';
import { caddyLaunchMode, startCaddyOnDemand } from './dev-service';

/** Result of {@link ensureLtDevCaddy}. */
export interface CaddyGate {
  /** Our Caddyfile changed on disk and the running Caddy does not serve that yet: reload. */
  healed: boolean;
  /** What to print when `ok` is false; the first line is the error. */
  lines: string[];
  ok: boolean;
  reason?: 'down' | 'foreign' | 'start-failed';
  /** lt dev started Caddy in this call (Windows). */
  started: boolean;
}

/** Injection points, so every branch is testable without Caddy. */
export interface CaddyGateDeps {
  detectOwner?: () => Promise<CaddyOwner>;
  ensureFile?: () => boolean;
  launchMode?: ReturnType<typeof caddyLaunchMode>;
  prepare?: (timeoutMs?: number) => Promise<{ healed: boolean; running: boolean }>;
  start?: () => Promise<{ logFile: string; message: string; ok: boolean }>;
}

/**
 * The short outcome of a refused gate, for a command's return string.
 * @param gate - The refused gate
 */
export function caddyGateOutcome(gate: CaddyGate): string {
  if (gate.reason === 'foreign') return 'caddy not started by lt dev';
  if (gate.reason === 'start-failed') return 'caddy start failed';
  return 'caddy daemon down';
}

/**
 * Make sure the Caddy on :2019 is lt dev's, starting it where lt dev owns the start (Windows).
 *
 * - The Caddyfile is repaired first (`prepareCaddy`), because a broken file can keep Caddy from
 *   starting at all; a service then restarts it, which `prepareCaddy` waits for.
 * - Nothing runs: on Windows our Caddy is started from our Caddyfile (created first, `caddy run`
 *   fails on a missing file), and it counts only once it answers as ours. With a service
 *   (macOS/Linux) the service owns the lifecycle, so the answer is `lt dev install`.
 * - A foreign Caddy is refused with {@link foreignCaddyLines}: never started over, reloaded or
 *   stopped. A Caddy started by hand with our Caddyfile is ours (see `detectCaddyOwner`).
 * @param deps - Injection points (tests)
 */
export async function ensureLtDevCaddy(deps: CaddyGateDeps = {}): Promise<CaddyGate> {
  const mode = deps.launchMode ?? caddyLaunchMode();
  const created = mode === 'on-demand' ? (deps.ensureFile ?? (() => ensureCaddyfile(CADDYFILE_STUB)))() : false;
  const prepared = await (deps.prepare ?? prepareCaddy)(mode === 'service' ? undefined : 0);
  const healed = created || prepared.healed;

  let started = false;
  if (!prepared.running) {
    if (mode !== 'on-demand') {
      return { healed, lines: [downAdvice(mode)], ok: false, reason: 'down', started };
    }
    const result = await (deps.start ?? (() => startCaddyOnDemand()))();
    if (!result.ok) {
      return { healed, lines: [result.message, `Log: ${result.logFile}`], ok: false, reason: 'start-failed', started };
    }
    started = true;
  }

  const owner = await (deps.detectOwner ?? (() => detectCaddyOwner()))();
  if (owner === 'ours') {
    // A Caddy started in this call loaded the current file already.
    return { healed: healed && !started, lines: [], ok: true, started };
  }
  if (owner === 'foreign') {
    return { healed, lines: foreignCaddyLines(), ok: false, reason: 'foreign', started };
  }
  return started
    ? {
        healed,
        lines: ['Caddy was started but stopped answering on :2019.'],
        ok: false,
        reason: 'start-failed',
        started,
      }
    : { healed, lines: [downAdvice(mode)], ok: false, reason: 'down', started };
}

/**
 * Print a refused {@link CaddyGate}: the first line as the error, the rest as its explanation.
 * @param gate - The refused gate
 * @param print - The toolbox printers
 */
export function printCaddyGate(
  gate: CaddyGate,
  print: { error: (s: string) => void; info: (s: string) => void },
): void {
  const [first, ...rest] = gate.lines;
  print.error(first);
  rest.forEach((line) => print.info(`  ${line}`));
}

/** What to do when no Caddy runs, per launch mode. */
function downAdvice(mode: ReturnType<typeof caddyLaunchMode>): string {
  if (mode === 'service') return 'caddy daemon is not running. Run `lt dev install` to start the lt-dev service.';
  if (mode === 'on-demand') return 'caddy is not running. Run `lt dev install` to start it.';
  return `caddy is not running. Start it with: caddy run --config "${paths.caddyfile}" --adapter caddyfile`;
}
