import { spawn } from 'child_process';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning, paths as caddyPaths, validateCaddyfile } from '../../lib/caddy';
import { checkPortInUse } from '../../lib/dev-process';
import { loadRegistry, paths as statePaths } from '../../lib/dev-state';

/**
 * Diagnose Caddy / CA / DNS / port issues for `lt dev`.
 *
 * Categorical output (OK / WARN / FAIL) so developers can quickly see
 * what is missing on a fresh machine. Exit code 0 = all green,
 * 1 = at least one FAIL.
 */
const DoctorCommand: GluegunCommand = {
  alias: ['doc'],
  description: 'Diagnose Caddy/CA/DNS/port issues',
  hidden: false,
  name: 'doctor',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
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
      line('FAIL', colors.red, 'caddy not installed — run `brew install caddy`');
      fails++;
    }

    // 2. Caddy daemon
    if (hasCaddy) {
      const daemon = await caddyDaemonRunning();
      if (daemon) line('OK', colors.green, 'caddy daemon running (admin :2019 reachable)');
      else {
        line('FAIL', colors.red, 'caddy daemon not running — `brew services start caddy`');
        fails++;
      }
    }

    // 3. Caddyfile validates
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

/** Probe DNS — RFC 6761 says *.localhost MUST resolve to loopback. */
function dnsResolvesLocalhost(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      'node',
      [
        '-e',
        `require('dns').lookup(${JSON.stringify(host)}, (e, a) => { process.exit(e || a !== '127.0.0.1' ? 1 : 0); })`,
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
