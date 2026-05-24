import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning } from '../../lib/caddy';
import { buildIdentity } from '../../lib/dev-identity';
import { listenSnapshot } from '../../lib/dev-process';
import { apiNeedsPortPatch, appNeedsPortPatch, resolveLayout } from '../../lib/dev-project';
import { isPidAlive, loadRegistry, loadSession } from '../../lib/dev-state';

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
        for (const slug of slugs) {
          const e = reg.projects[slug];
          const session = loadSession(e.path);
          const apiAlive = session?.pids.api ? isPidAlive(session.pids.api) : false;
          const appAlive = session?.pids.app ? isPidAlive(session.pids.app) : false;
          const status = apiAlive || appAlive ? colors.green('●') : colors.dim('○');
          info(`  ${status} ${slug.padEnd(30)} ${colors.dim(e.path)}`);
          for (const [sub, host] of Object.entries(e.subdomains)) info(`     ${sub.padEnd(6)} https://${host}`);
        }
      }
      info('');
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev status: all';
    }

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    const identity = buildIdentity(layout.root);
    const entry = reg.projects[identity.slug];

    info('');
    info(colors.bold(`lt dev status: ${identity.slug}`));
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
      const apiAlive = session.pids.api ? isPidAlive(session.pids.api) : false;
      const appAlive = session.pids.app ? isPidAlive(session.pids.app) : false;
      info(`  api: ${apiAlive ? colors.green('running') : colors.red('dead')} (pid ${session.pids.api ?? '-'})`);
      info(`  app: ${appAlive ? colors.green('running') : colors.red('dead')} (pid ${session.pids.app ?? '-'})`);
      info(colors.dim(`  started: ${session.startedAt}`));

      // Live port snapshot
      const ports = [entry.internalPorts.api, entry.internalPorts.app].filter(
        (p): p is number => typeof p === 'number',
      );
      if (ports.length > 0) {
        info('');
        info(colors.bold('  Live upstream state'));
        const snap = await listenSnapshot(ports);
        for (const p of ports) {
          const r = snap.get(p);
          info(`    ${p}: ${r ? colors.green(`bound to ${r.command} (pid ${r.pid})`) : colors.dim('free')}`);
        }
      }
    }

    info('');
    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev status: ${identity.slug}`;
  },
};

module.exports = StatusCommand;
