import { spawn } from 'child_process';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning, paths as caddyPaths, validateCaddyfile } from '../../lib/caddy';
import { checkPortInUse } from '../../lib/dev-process';
import { resolveLayout } from '../../lib/dev-project';
import { getServicePaths, getServiceStatus, platformSupported } from '../../lib/dev-service';
import { detectSlugConflict, loadRegistry, paths as statePaths } from '../../lib/dev-state';
import { checkGlobalSetupTicketSafe, resolveDevIdentity } from '../../lib/dev-ticket';

/**
 * Diagnose Caddy / CA / DNS / port issues for `lt dev`.
 *
 * Categorical output (OK / WARN / FAIL) so developers can quickly see
 * what is missing on a fresh machine. Exit code 0 = all green,
 * 1 = at least one FAIL.
 *
 * Checks our OWN LaunchAgent / systemd-user unit — not
 * `brew services caddy`. The latter cannot host our Caddyfile.
 */
const DoctorCommand: GluegunCommand = {
  alias: ['doc'],
  description: 'Diagnose Caddy/CA/DNS/port issues',
  hidden: false,
  name: 'doctor',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info },
    } = toolbox;

    info('');
    info(colors.bold('lt dev doctor'));
    info(colors.dim('─'.repeat(60)));

    let fails = 0;

    // 1. Caddy installed
    const hasCaddy = await caddyAvailable();
    if (hasCaddy) line('OK', colors.green, 'caddy on PATH');
    else {
      line('FAIL', colors.red, 'caddy not installed — run `brew install caddy` then `lt dev install`');
      fails++;
    }

    // 2. Service installed (LaunchAgent / systemd-user)
    const plat = platformSupported();
    if (plat === 'unsupported') {
      line('WARN', colors.yellow, `service management not supported on ${process.platform} — run caddy manually`);
    } else {
      const svc = await getServiceStatus();
      const servicePaths = getServicePaths();
      if (svc.installed && svc.loaded) {
        line('OK', colors.green, `lt-dev service loaded (${servicePaths.unitFile})`);
      } else if (svc.installed && !svc.loaded) {
        line('FAIL', colors.red, `service file exists but is not loaded — run \`lt dev install\``);
        fails++;
      } else {
        line('FAIL', colors.red, `lt-dev service not installed — run \`lt dev install\``);
        fails++;
      }
    }

    // 3. Caddy daemon admin endpoint
    if (hasCaddy) {
      const daemon = await caddyDaemonRunning();
      if (daemon) line('OK', colors.green, 'caddy admin (:2019) reachable');
      else {
        line('FAIL', colors.red, 'caddy admin (:2019) unreachable — run `lt dev install`');
        fails++;
      }
    }

    // 4. Caddyfile validates
    if (hasCaddy) {
      const v = await validateCaddyfile();
      if (v.ok) line('OK', colors.green, `Caddyfile valid (${caddyPaths.caddyfile})`);
      else line('WARN', colors.yellow, `Caddyfile validation: ${v.stderr.split('\n')[0]}`);
    }

    // 4. Port 80 / 443 free or held by Caddy
    for (const port of [80, 443]) {
      const r = await checkPortInUse(port);
      if (r === null) line('WARN', colors.yellow, `lsof unavailable — cannot probe port ${port}`);
      else if (!r.inUse) line('OK', colors.green, `port ${port} free`);
      else if (r.command === 'caddy') line('OK', colors.green, `port ${port} held by caddy (pid ${r.pid})`);
      else {
        line('FAIL', colors.red, `port ${port} held by ${r.command} (pid ${r.pid}) — Caddy cannot bind`);
        fails++;
      }
    }

    // 5. *.localhost resolves to 127.0.0.1
    const dnsOk = await dnsResolvesLocalhost('lt-dev-doctor.localhost');
    if (dnsOk) line('OK', colors.green, '*.localhost resolves to 127.0.0.1 (RFC 6761)');
    else line('WARN', colors.yellow, '*.localhost may not resolve — check /etc/hosts or system resolver');

    // 6. Registry
    const reg = loadRegistry();
    const count = Object.keys(reg.projects).length;
    line('OK', colors.green, `registry: ${count} project(s) at ${statePaths.registry}`);

    // 7. Project-level (only when run inside a project): is a DB-wiping
    //    Playwright global-setup ticket/shard-safe? WARN (never auto-edit) if a
    //    bespoke allow-list would reject the per-ticket/shard `<base>-<id>-test`
    //    DBs that `lt ticket` / `lt dev test --shard` create.
    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (layout.apiDir || layout.appDir) {
      const gs = checkGlobalSetupTicketSafe(layout);
      if (gs.file && gs.hasDbReset && !gs.ticketSafe) {
        line(
          'WARN',
          colors.yellow,
          'global-setup allow-list rejects per-ticket/shard test DBs — `lt ticket` / `--shard` E2E cannot reset its DB',
        );
        line(
          'WARN',
          colors.yellow,
          `  ${gs.file}: widen isAllowedDb → /^<base>-(?:[a-z0-9-]+-)?test(?:-\\d+)?$/  (svl is the reference)`,
        );
      } else if (gs.file && gs.hasDbReset) {
        line('OK', colors.green, 'global-setup allow-list is ticket + shard safe');
      }

      // 8. Slug ↔ path: is this project's slug registered to a DIFFERENT checkout?
      //    Two clones of the same project (same package.json "name") share the
      //    slug → Caddy block / ports / DB and collide. Surface it proactively.
      const { identity } = resolveDevIdentity(layout);
      const conflict = detectSlugConflict(identity.slug, layout.root);
      if (conflict) {
        line(
          'WARN',
          colors.yellow,
          `slug "${identity.slug}" is also registered to another checkout${conflict.otherSessionAlive ? ' (currently RUNNING)' : ''}: ${conflict.otherPath}`,
        );
        line(
          'WARN',
          colors.yellow,
          '  two clones of the same project collide on URLs/ports/DB — rename one package.json "name", or run only one.',
        );
      }
    }

    info('');
    if (fails > 0) info(colors.red(`✗ ${fails} fail(s) — see above`));
    else info(colors.green('✓ all checks passed'));

    if (!parameters.options.fromGluegunMenu) process.exit(fails > 0 ? 1 : 0);
    return fails > 0 ? `dev doctor: ${fails} fails` : 'dev doctor: ok';

    function line(tag: string, color: (s: string) => string, msg: string): void {
      info(`  ${color(`[${tag.padEnd(4)}]`)} ${msg}`);
    }
  },
};

/**
 * Probe DNS — RFC 6761 mandates *.localhost MUST resolve to loopback.
 *
 * On macOS the resolver returns `::1` first (IPv6 loopback); on Linux
 * `127.0.0.1` (IPv4) is more common. Both are valid loopback addresses
 * and Caddy listens on both, so we accept either.
 */
function dnsResolvesLocalhost(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      'node',
      [
        '-e',
        `require('dns').lookup(${JSON.stringify(host)}, { all: true }, (e, addrs) => {
           if (e) process.exit(1);
           const loopback = (addrs || []).some(a => a.address === '127.0.0.1' || a.address === '::1');
           process.exit(loopback ? 0 : 1);
         });`,
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

module.exports = DoctorCommand;
