/**
 * The Caddy checks of `lt dev doctor`: whose Caddy holds :2019, whether the
 * Caddyfile validates, whether it still carries the 1.51.0/1.51.1 `default_bind`,
 * and whether OUR Caddy serves the file. Read-only: nothing here reloads, writes
 * or starts anything.
 *
 * Two checks meet here that must not contradict each other. The ownership check
 * (AP-7) says a foreign Caddy is neither used nor changed. The loaded-config
 * check (1.51.4) FAILs when the running Caddy does not serve the file and names
 * `caddy reload`. Run against a foreign Caddy, the second would always fail and
 * recommend exactly the reload the first rules out, so it runs only for ours.
 */
import {
  type CaddyOwner,
  paths as caddyPaths,
  type CaddyResult,
  compareLoadedConfig,
  detectCaddyOwner,
  hasLegacyLoopbackBind,
  type LoadedConfigState,
  readCaddyfile,
  validateCaddyfile,
} from './caddy';
import { caddyLaunchMode } from './dev-service';

/** Result of `diagnoseCaddy`: the lines to print and how many of them are FAILs. */
export interface CaddyDiagnosis {
  fails: number;
  lines: DoctorLine[];
}

/** Injection points, so each branch is testable without Caddy. */
export interface CaddyDiagnosisDeps {
  compareLoaded?: () => Promise<LoadedConfigState>;
  detectOwner?: () => Promise<CaddyOwner>;
  launchMode?: ReturnType<typeof caddyLaunchMode>;
  platform?: NodeJS.Platform;
  readCaddyfile?: () => string;
  validate?: () => Promise<CaddyResult>;
}

/** One doctor line. */
export interface DoctorLine {
  msg: string;
  tag: 'FAIL' | 'INFO' | 'OK' | 'WARN';
}

/**
 * Run the Caddy checks for `lt dev doctor`.
 * @param hasCaddy - Whether `caddy` is on PATH (doctor's check 1); without it only the 1.51.x line is checked
 * @param deps - Probes (default: the real ones)
 */
export async function diagnoseCaddy(hasCaddy: boolean, deps: CaddyDiagnosisDeps = {}): Promise<CaddyDiagnosis> {
  const mode = deps.launchMode ?? caddyLaunchMode();
  const lines: DoctorLine[] = [];
  const add = (tag: DoctorLine['tag'], msg: string): void => {
    lines.push({ msg, tag });
  };
  const legacyBind = hasLegacyLoopbackBind((deps.readCaddyfile ?? readCaddyfile)());

  // Admin endpoint — and whose it is. A foreign Caddy is stated, not acted on: no
  // advice to stop it (see `caddy.ts`). It still counts as a failure, because
  // `lt dev` cannot route through it.
  let owner: CaddyOwner = 'none';
  if (hasCaddy) {
    owner = await (deps.detectOwner ?? (() => detectCaddyOwner()))();
    if (owner === 'ours') add('OK', 'caddy admin (:2019) reachable, started by lt dev');
    else if (owner === 'foreign') {
      add('FAIL', 'caddy on :2019 was not started by lt dev — lt dev neither uses nor changes it');
      // An lt dev Caddy from before the owner marker that kept its old routes through the failed
      // reloads of 1.51.0/1.51.1 looks the same from outside: no marker, and its config no longer
      // matches the file. `lt dev up` repairs the file; the `caddy reload` it then names loads it.
      if (legacyBind) {
        add(
          'INFO',
          '  an lt dev Caddy left on its old routes by the failed reloads of lt 1.51.0/1.51.1 reads like this too — see the default_bind line below',
        );
      }
    } else if (mode === 'on-demand') add('INFO', 'caddy not running — `lt dev up` starts it');
    else add('FAIL', 'caddy admin (:2019) unreachable — run `lt dev install`');
  }

  // Caddyfile validates.
  let valid = false;
  if (hasCaddy) {
    const v = await (deps.validate ?? validateCaddyfile)();
    valid = v.ok;
    if (v.ok) add('OK', `Caddyfile valid (${caddyPaths.caddyfile})`);
    else add('WARN', `Caddyfile validation: ${v.stderr.split('\n')[0]}`);
  }

  // The `default_bind` of CLI 1.51.0/1.51.1. Valid syntax, so the validation passes it, but macOS
  // lets an unprivileged Caddy bind port 443 only on the wildcard address: every reload fails and
  // a restarted Caddy does not come up at all. Any `lt dev` command that writes the Caddyfile
  // removes it; this names the cause while nothing has.
  if (legacyBind) {
    add(
      (deps.platform ?? process.platform) === 'darwin' ? 'FAIL' : 'WARN',
      'Caddyfile has `default_bind 127.0.0.1 [::1]` (lt 1.51.0/1.51.1), which macOS refuses to bind — run `lt dev up` to remove it',
    );
  }

  // Does OUR Caddy serve this Caddyfile? A failed reload (a bind error, say) leaves Caddy on its
  // previous config while the admin, validate and port checks all stay green, because
  // `caddy validate` never binds. For ours this catches a failed reload once the owner marker is
  // loaded; a pre-marker instance counts as ours only by matching the file, so it passes by
  // construction. Never for a foreign Caddy (see the module comment).
  if (owner === 'ours' && valid) {
    const loaded = await (deps.compareLoaded ?? (() => compareLoadedConfig()))();
    if (loaded === 'matches') {
      add('OK', 'caddy serves the current Caddyfile');
    } else if (loaded === 'differs') {
      add('FAIL', 'caddy is not serving the current Caddyfile — the last reload failed or none ran');
      add('FAIL', `  see Caddy's error: caddy reload --config ${caddyPaths.caddyfile} --adapter caddyfile`);
    } else {
      add('WARN', 'could not compare the config caddy serves with the Caddyfile');
    }
  }

  // A continuation line (indented) belongs to the FAIL above it and is not a failure of its own.
  return { fails: lines.filter((l) => l.tag === 'FAIL' && !l.msg.startsWith('  ')).length, lines };
}
