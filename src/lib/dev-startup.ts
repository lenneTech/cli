/**
 * Waiting for freshly started `lt dev` components until they listen (DEV-4130).
 *
 * `lt dev up` used to watch the fresh pids for 3 s and report "Started" otherwise. An API that
 * died later in its start, typically in `migrate:up` after ts-node had compiled, passed that
 * window: the command exited 0 and Caddy answered 502. A component now counts as started only
 * once its internal port is bound, judged by the same rule as `lt dev status`
 * ({@link classifyComponentHealth} with the {@link STARTUP_GRACE_MS} window), so a slow boot is
 * waited for and never reported as a failure, and a component `lt dev status` would call
 * `crashed` fails here too.
 */
import { isPortBound } from './dev-process';
import { classifyComponentHealth, type ComponentHealth, STARTUP_GRACE_MS } from './dev-state';

/**
 * A component `lt dev up` tried to start. Without a pid its start produced no process (`--api-compiled`
 * runs the migration itself and starts nothing when it fails); without a port it is not watched.
 */
export interface StartingComponent {
  name: string;
  pid: number | undefined;
  port: number | undefined;
}

/** How a start failed: the pid died, it never listened in the grace window, or no process came up. */
export type StartupFailure = 'not-started' | Extract<ComponentHealth, 'crashed' | 'dead'>;

/** Result of {@link waitForStartup}, each list in the order the components were given. */
export interface StartupOutcome {
  /** Components whose start failed, with the pid that was watched (none for `not-started`). */
  failed: { name: string; pid: number | undefined; state: StartupFailure }[];
  /** Components whose port is bound. */
  ready: string[];
}

/**
 * Polls each component until it listens on its port, dies, or stays alive without listening past
 * the grace window. Returns as soon as no component is still booting, so a healthy start costs
 * no more than its own boot time.
 */
export async function waitForStartup(
  components: StartingComponent[],
  opts: { graceMs?: number; pollMs?: number } = {},
): Promise<StartupOutcome> {
  const graceMs = opts.graceMs ?? STARTUP_GRACE_MS;
  const pollMs = opts.pollMs ?? 500;
  const startedAt = new Date().toISOString();
  const watchable = components.filter((c) => typeof c.port === 'number');
  const notStarted = watchable.filter((c) => typeof c.pid !== 'number');
  const pending = watchable.filter((c): c is { name: string; pid: number; port: number } => typeof c.pid === 'number');
  const results = new Map<string, 'ready' | Extract<ComponentHealth, 'crashed' | 'dead'>>();

  while (pending.some((c) => !results.has(c.name))) {
    for (const c of pending) {
      if (results.has(c.name)) continue;
      const health = classifyComponentHealth({
        pid: c.pid,
        portBound: await isPortBound(c.port),
        startedAt,
        startupGraceMs: graceMs,
      });
      if (health === 'running') results.set(c.name, 'ready');
      else if (health !== 'starting') results.set(c.name, health);
    }
    if (pending.some((c) => !results.has(c.name))) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return {
    failed: watchable
      .filter((c) => results.get(c.name) !== 'ready')
      .map((c) => ({
        name: c.name,
        pid: c.pid,
        state: notStarted.includes(c) ? 'not-started' : (results.get(c.name) as 'crashed' | 'dead'),
      })),
    ready: pending.filter((c) => results.get(c.name) === 'ready').map((c) => c.name),
  };
}
