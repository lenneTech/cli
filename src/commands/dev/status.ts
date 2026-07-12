import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning } from '../../lib/caddy';
import { listenSnapshot } from '../../lib/dev-process';
import { apiNeedsPortPatch, appNeedsPortPatch, resolveLayout } from '../../lib/dev-project';
import {
  classifyComponentHealth,
  type ComponentHealth,
  isPidAlive,
  loadRegistry,
  loadSession,
  TEST_SESSION_FILE,
} from '../../lib/dev-state';
import { resolveDevIdentity } from '../../lib/dev-ticket';

/**
 * Show what is running.
 *
 * Default: status for the current project (PIDs + URLs + DB).
 * `--all`: list every project in the central registry with health checks.
 */
const StatusCommand: GluegunCommand = {
  alias: ['s'],
  description: 'Show lt dev status',
  hidden: false,
  name: 'status',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, warning },
    } = toolbox;

    const all = Boolean(parameters.options.all);
    const reg = loadRegistry();

    if (all) {
      info('');
      info(colors.bold('All registered lt dev projects'));
      info(colors.dim('─'.repeat(60)));
      const slugs = Object.keys(reg.projects).sort();
      if (slugs.length === 0) {
        warning('No projects registered. Run `lt dev init` in a project.');
      } else {
        // One lsof over EVERY registered internal port, so liveness reflects
        // what is actually bound — not just whether a supervisor PID survives a
        // crashed ts-node. (See classifyComponentHealth.)
        const allPorts: number[] = [];
        for (const slug of slugs) {
          const e = reg.projects[slug];
          if (e.internalPorts.api) allPorts.push(e.internalPorts.api);
          if (e.internalPorts.app) allPorts.push(e.internalPorts.app);
        }
        const snap = await listenSnapshot(allPorts);
        for (const slug of slugs) {
          const e = reg.projects[slug];
          const session = loadSession(e.path);
          // Only components the project actually has (a registered internal
          // port) count toward the health summary.
          const comps: ComponentHealth[] = [];
          if (e.internalPorts.api) {
            comps.push(classifyComponentHealth({ pid: session?.pids.api, portBound: snap.has(e.internalPorts.api) }));
          }
          if (e.internalPorts.app) {
            comps.push(classifyComponentHealth({ pid: session?.pids.app, portBound: snap.has(e.internalPorts.app) }));
          }
          const allRunning = comps.length > 0 && comps.every((h) => h === 'running');
          const anyRunning = comps.some((h) => h === 'running');
          const anyCrashed = comps.some((h) => h === 'crashed');
          let status: string;
          let note = '';
          if (allRunning) {
            status = colors.green('●');
          } else if (anyRunning) {
            // Some up, some down — honest "partially up" rather than green.
            status = colors.yellow('◐');
            note = colors.yellow('  degraded — `lt dev up` to restart the down half');
          } else if (anyCrashed) {
            status = colors.yellow('◐');
            note = colors.yellow('  crashed — `lt dev up` to restart');
          } else {
            status = colors.dim('○');
          }
          info(`  ${status} ${slug.padEnd(30)} ${colors.dim(e.path)}${note}`);
          for (const [sub, host] of Object.entries(e.subdomains)) info(`     ${sub.padEnd(6)} https://${host}`);
        }
      }
      info('');
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev status: all';
    }

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    // Ticket-aware: a ticket worktree reports its OWN suffixed stack.
    const { identity, ticket } = resolveDevIdentity(layout, { ticket: parameters.options.ticket });
    const entry = reg.projects[identity.slug];

    info('');
    info(colors.bold(`lt dev status: ${identity.slug}`) + (ticket ? colors.dim(` (ticket ${ticket})`) : ''));
    info(colors.dim('─'.repeat(60)));

    if (!entry) {
      warning('Not registered. Run `lt dev init` first.');
      // Show what migrate would do (legacy code present?) so the user
      // can judge urgency before running it.
      const legacyFiles: string[] = [];
      if (layout.apiDir) {
        const f = apiNeedsPortPatch(layout.apiDir);
        if (f) legacyFiles.push(f);
      }
      if (layout.appDir) legacyFiles.push(...appNeedsPortPatch(layout.appDir));
      if (legacyFiles.length > 0) {
        info(colors.dim('  Legacy hardcoded ports detected — `lt dev init` will patch:'));
        legacyFiles.forEach((f) => info(colors.dim(`    - ${f}`)));
      } else {
        info(colors.dim('  Code is already env-aware; `lt dev init` will only register + patch CLAUDE.md.'));
      }
      info('');
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev status: not registered';
    }

    for (const [sub, host] of Object.entries(entry.subdomains)) {
      const port = sub === 'api' ? entry.internalPorts.api : entry.internalPorts.app;
      info(`  ${sub.padEnd(6)} https://${host}${port ? colors.dim(`  →  127.0.0.1:${port}`) : ''}`);
    }
    // `loadRegistry` strips dbName from API-less (App-only) entries, so its
    // presence alone means there is a database to advertise.
    if (entry.dbName) info(`  db     mongodb://127.0.0.1/${entry.dbName}`);

    // Patch status — quick view whether legacy ports are still in source.
    const legacyFiles: string[] = [];
    if (layout.apiDir) {
      const f = apiNeedsPortPatch(layout.apiDir);
      if (f) legacyFiles.push(f);
    }
    if (layout.appDir) legacyFiles.push(...appNeedsPortPatch(layout.appDir));
    if (legacyFiles.length > 0) {
      info('');
      warning('  Legacy hardcoded ports still present:');
      legacyFiles.forEach((f) => info(colors.dim(`    - ${f}`)));
      info(colors.dim('  Run `lt dev init` to patch them; otherwise Caddy may proxy into the void.'));
    }

    // Caddy status — quick view whether the daemon is reachable.
    {
      const caddyOk = await caddyAvailable();
      const daemonOk = caddyOk ? await caddyDaemonRunning() : false;
      info('');
      if (!caddyOk) {
        warning('  Caddy not installed — run `lt dev install` first.');
      } else if (!daemonOk) {
        warning('  Caddy daemon not running — run `lt dev install` to (re)start the lt-dev service.');
      } else {
        info(colors.dim('  Caddy: ready'));
      }
    }

    info('');
    const session = loadSession(layout.root);
    if (!session) {
      info(colors.dim('  no `lt dev up` session active'));
    } else {
      // Probe the actual ports FIRST: a component is only truly "running" when
      // its supervisor PID is alive AND its internal port is bound. A crashed
      // ts-node leaves nodemon alive ("waiting for file changes"), so the
      // wrapper PID alone reads as "running" while nothing serves the port.
      const ports = [entry.internalPorts.api, entry.internalPorts.app].filter(
        (p): p is number => typeof p === 'number',
      );
      const snap = await listenSnapshot(ports);

      const apiHealth = classifyComponentHealth({
        pid: session.pids.api,
        portBound: entry.internalPorts.api ? snap.has(entry.internalPorts.api) : false,
      });
      const appHealth = classifyComponentHealth({
        pid: session.pids.app,
        portBound: entry.internalPorts.app ? snap.has(entry.internalPorts.app) : false,
      });
      const label = (health: ComponentHealth): string =>
        health === 'running'
          ? colors.green('running')
          : health === 'crashed'
            ? colors.yellow('crashed (supervisor up, port not listening)')
            : colors.red('dead');

      if (session.pids.api !== undefined || entry.internalPorts.api) {
        info(`  api: ${label(apiHealth)} (pid ${session.pids.api ?? '-'})`);
      }
      if (session.pids.app !== undefined || entry.internalPorts.app) {
        info(`  app: ${label(appHealth)} (pid ${session.pids.app ?? '-'})`);
      }
      info(colors.dim(`  started: ${session.startedAt}`));

      // Live port snapshot — the authoritative "what is actually bound" view.
      if (ports.length > 0) {
        info('');
        info(colors.bold('  Live upstream state'));
        for (const p of ports) {
          const r = snap.get(p);
          info(`    ${p}: ${r ? colors.green(`bound to ${r.command} (pid ${r.pid})`) : colors.dim('free')}`);
        }
      }

      // Surface any present-but-not-serving component (crashed OR dead) and
      // point at the now-selective `lt dev up`, which restarts just the down
      // half and leaves the healthy one running.
      const apiPresent = session.pids.api !== undefined || !!entry.internalPorts.api;
      const appPresent = session.pids.app !== undefined || !!entry.internalPorts.app;
      const down = [
        apiPresent && apiHealth !== 'running' ? 'api' : null,
        appPresent && appHealth !== 'running' ? 'app' : null,
      ].filter((c): c is string => c !== null);
      if (down.length > 0) {
        const crashed = (apiPresent && apiHealth === 'crashed') || (appPresent && appHealth === 'crashed');
        info('');
        warning(
          `  ${down.join(' + ')} not serving${crashed ? ' (supervisor still up — crashed)' : ''}. ` +
            `Run \`lt dev up\` to restart ${down.length === 1 ? 'it' : 'them'}.`,
        );
      }
    }

    // Isolated test stack (`lt dev test`), if one is up / left with --keep.
    const testSession = loadSession(layout.root, TEST_SESSION_FILE);
    if (testSession) {
      const testEntry = reg.projects[`${identity.slug}-test`];
      info('');
      info(colors.bold('  Isolated test stack (lt dev test)'));
      if (testEntry) {
        for (const [sub, host] of Object.entries(testEntry.subdomains)) info(`    ${sub.padEnd(6)} https://${host}`);
        if (testEntry.dbName) info(`    db     mongodb://127.0.0.1/${testEntry.dbName}`);
      }
      const apiAlive = testSession.pids.api ? isPidAlive(testSession.pids.api) : false;
      const appAlive = testSession.pids.app ? isPidAlive(testSession.pids.app) : false;
      info(`    api: ${apiAlive ? colors.green('running') : colors.red('dead')} (pid ${testSession.pids.api ?? '-'})`);
      info(`    app: ${appAlive ? colors.green('running') : colors.red('dead')} (pid ${testSession.pids.app ?? '-'})`);
      info(colors.dim('    stop: lt dev test down'));
    }

    info('');
    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev status: ${identity.slug}`;
  },
};

module.exports = StatusCommand;
