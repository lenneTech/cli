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

      // 7.5 check wrapper drift: the root wrapper is canonical (bundled with the
      //     CLI, synced by `lt fullstack update`). A diverged copy silently
      //     misses fixes (idle-watchdog, install hoisting, summed test
      //     metrics) — surface it instead of letting copies drift apart.
      //
      //     Checked over the WHOLE copy set, not just `check.mjs`: the wrapper
      //     imports siblings, so a missing or stale one makes `check` die with
      //     ERR_MODULE_NOT_FOUND (or an import mismatch) before running a single
      //     step. Reporting only on `check.mjs` meant doctor printed a green
      //     "matches the canonical CLI version" for a project whose `check` was
      //     completely broken — and doctor is the tool people reach for exactly
      //     then.
      try {
        const { readFileSync: read } = await import('fs');
        const { join: j } = await import('path');
        const { keptWrapperReason, resolveCopySet } = await import('../../lib/heal-check-wrapper');
        const bundledCheck = j(__dirname, '..', '..', 'templates', 'check', 'check.mjs');
        if (filesystem.exists(bundledCheck)) {
          const missing: string[] = [];
          const drifted: string[] = [];
          for (const { rel, source } of resolveCopySet(bundledCheck)) {
            const target = j(layout.root, rel);
            if (!filesystem.exists(target)) {
              missing.push(rel);
            } else if (read(target, 'utf8') !== read(source, 'utf8')) {
              drifted.push(rel);
            }
          }
          // A missing module only breaks `check` when the project's wrapper is the
          // canonical one that imports it (or the wrapper itself is missing). An
          // older wrapper does not import the newer modules (e.g. `lib/*.mjs`) and
          // still runs — calling that "cannot start" would be a false alarm.
          const wrapperDrifted = drifted.includes('scripts/check.mjs');
          // A project wrapper that heal refuses to replace (newer release, or the same
          // release with other content) is not drift to fix: pointing at
          // `lt fullstack update` there would recommend a no-op or a downgrade.
          const kept = keptWrapperReason(layout.root, bundledCheck);
          if (kept) {
            line('INFO', colors.cyan, `check wrapper: ${kept}`);
          } else if (missing.length > 0 && !wrapperDrifted) {
            line('ERROR', colors.red, `check wrapper incomplete — missing ${missing.join(', ')}`);
            line('ERROR', colors.red, '  `pnpm run check` cannot start; run `lt fullstack update` to install it');
          } else if (drifted.length > 0) {
            const outdated = [...drifted, ...missing.map((rel) => `${rel} (missing)`)];
            const verb = outdated.length === 1 ? 'differs' : 'differ';
            line('WARN', colors.yellow, `${outdated.join(', ')} ${verb} from the canonical CLI version`);
            line('WARN', colors.yellow, '  run `lt fullstack update` to sync it (skips uncommitted local edits)');
          } else if (filesystem.exists(j(layout.root, 'scripts', 'check.mjs'))) {
            line('OK', colors.green, 'check wrapper matches the canonical CLI version');
          }
        }
      } catch {
        /* best-effort diagnostics */
      }

      // 7.6 oxlint config filename: oxlint only auto-discovers `.oxlintrc.json`.
      //     Apps from the template before the rename carry `oxlint.json`, whose
      //     rules then silently never apply — lint passes on code the project's
      //     own rules forbid.
      if (layout.appDir) {
        // Behaviour-changing fix flags delete console calls once rules load.
        try {
          const { findDangerousFixFlagUsage } = await import('../../lib/heal-oxlintrc');
          const workspaceRoot = layout.root !== layout.appDir ? layout.root : undefined;
          const flagged = findDangerousFixFlagUsage(layout.appDir, workspaceRoot);
          if (flagged.length > 0) {
            line('WARN', colors.yellow, `oxlint --fix-suggestions/--fix-dangerously in ${flagged.join(', ')}`);
            line('WARN', colors.yellow, '  they apply behaviour-changing fixes (e.g. delete console calls); run `lt fullstack update`');
          }
        } catch {
          /* best-effort diagnostics */
        }
        const hasLegacy = filesystem.exists(filesystem.path(layout.appDir, 'oxlint.json'));
        const hasCurrent = filesystem.exists(filesystem.path(layout.appDir, '.oxlintrc.json'));
        if (hasLegacy && !hasCurrent) {
          line('WARN', colors.yellow, 'oxlint config not loaded — oxlint only reads .oxlintrc.json, the app has oxlint.json');
          line('WARN', colors.yellow, '  run `lt fullstack update` to rename it');
        } else if (hasLegacy) {
          line('WARN', colors.yellow, 'oxlint.json is ignored next to .oxlintrc.json — merge its rules and delete it');
        }
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
