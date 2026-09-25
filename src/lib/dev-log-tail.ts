/**
 * What a component's log can tell someone whose component just died.
 *
 * Two silent failures made this necessary, both seen on a Windows laptop:
 * `lt dev up` reported success for an API that was dead seconds later, and its
 * log file existed, was even rotated, but stayed at 0 bytes, so nobody looked in
 * the extra console window that held the actual error. A diagnosis therefore has
 * to tell "the log says X" apart from "the log is empty", and say the latter out
 * loud instead of printing nothing.
 */
import { existsSync, readFileSync, statSync } from 'fs';

/** What was found in a log file. */
export interface LogDiagnosis {
  /** Absolute path, for the message. */
  file: string;
  /** Size in bytes; -1 when the file does not exist. */
  size: number;
  /** `missing` / `empty` / `ok` (has content). */
  state: 'empty' | 'missing' | 'ok';
  /** Last non-empty lines, oldest first; empty unless `state === 'ok'`. */
  tail: string[];
}

/**
 * The lines to print under "<name> is not running". Never an empty list: an
 * empty or missing log is itself the finding.
 */
export function describeLog(d: LogDiagnosis): string[] {
  if (d.state === 'missing') return [`No log at ${d.file}.`];
  if (d.state === 'empty') {
    return [`${d.file} is EMPTY — the output was not captured, so the reason is not in the log.`];
  }
  return [`Last lines of ${d.file}:`, ...d.tail.map((l) => `  ${l}`)];
}

/** Read `file` and keep its last `lines` non-empty lines. */
export function diagnoseLog(file: string, lines = 20): LogDiagnosis {
  if (!existsSync(file)) return { file, size: -1, state: 'missing', tail: [] };
  const size = statSync(file).size;
  if (size === 0) return { file, size, state: 'empty', tail: [] };
  return { file, size, state: 'ok', tail: tailLines(readFileSync(file, 'utf8'), lines) };
}

/**
 * Components whose pid is gone within `budgetMs` of their start.
 *
 * Catches what dies at once: a missing script, a package manager that cannot
 * start, a crash before any watcher takes over. A crash under nodemon keeps the
 * supervisor alive and is `lt dev status`'s job (`crashed` after the grace window).
 */
export async function findEarlyExits(
  components: { name: string; pid: number | undefined }[],
  opts: { budgetMs: number; isAlive: (pid: number) => boolean; sleep?: (ms: number) => Promise<void> },
): Promise<string[]> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const watched = components.filter((c): c is { name: string; pid: number } => typeof c.pid === 'number');
  const dead = new Set<string>();
  const deadline = Date.now() + opts.budgetMs;
  do {
    for (const c of watched) if (!dead.has(c.name) && !opts.isAlive(c.pid)) dead.add(c.name);
    if (dead.size === watched.length) break;
    await sleep(250);
  } while (Date.now() < deadline);
  return watched.filter((c) => dead.has(c.name)).map((c) => c.name);
}

/**
 * True when a component has been up for `minAgeMs` and its log is still empty.
 * A booting app writes within seconds (nuxt/nest print a banner), so an empty
 * log after that means output is going somewhere else, not that nothing happened.
 */
export function isSilentLog(d: LogDiagnosis, startedAt: string | undefined, now: number, minAgeMs = 15_000): boolean {
  if (d.state !== 'empty' || !startedAt) return false;
  const age = now - new Date(startedAt).getTime();
  return Number.isFinite(age) && age >= minAgeMs;
}

/** Last `n` non-empty lines of `content`, oldest first. */
export function tailLines(content: string, n: number): string[] {
  return content
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(-n);
}
