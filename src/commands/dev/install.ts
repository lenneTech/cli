import { spawn } from 'child_process';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import {
  caddyAvailable,
  caddyDaemonRunning,
  paths as caddyPaths,
  validateCaddyfile,
  writeCaddyfile,
} from '../../lib/caddy';

/**
 * One-time per-machine setup for `lt dev`.
 *
 * Idempotent — re-running diagnoses the current state and only acts on
 * what is missing.
 *
 * Steps:
 * 1. Ensure `caddy` is on PATH (suggest `brew install caddy` if missing)
 * 2. Ensure `~/.lenneTech/Caddyfile` exists (empty stub if missing)
 * 3. Ensure Caddy is running as a background service (suggest
 *    `brew services start caddy`)
 * 4. Trust the local Caddy CA (`caddy trust` — needs sudo once)
 */
const InstallCommand: GluegunCommand = {
  alias: ['i'],
  description: 'One-time setup: install + start Caddy, trust local CA',
  hidden: false,
  name: 'install',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    info('');
    info(colors.bold('lt dev install — one-time per-machine setup'));
    info(colors.dim('─'.repeat(60)));

    let blocked = false;

    // 1. Caddy on PATH
    const hasCaddy = await caddyAvailable();
    if (hasCaddy) {
      success('caddy is on PATH');
    } else {
      warning('caddy is not installed.');
      info(`  → Install with: ${colors.cyan('brew install caddy')} (macOS)`);
      info(`  → Linux:        ${colors.cyan('https://caddyserver.com/docs/install')}`);
      blocked = true;
    }

    // 2. Caddyfile stub
    writeCaddyfile('# lt dev — managed Caddyfile\n# Add per-project blocks via `lt dev up`.\n');
    success(`Caddyfile present at ${caddyPaths.caddyfile}`);

    if (!hasCaddy) {
      error('Cannot continue setup until Caddy is installed.');
      if (!parameters.options.fromGluegunMenu) process.exit(blocked ? 1 : 0);
      return 'dev install: caddy missing';
    }

    // 3. Caddy daemon
    const daemon = await caddyDaemonRunning();
    if (daemon) {
      success('caddy daemon is running');
    } else {
      warning('caddy daemon is not running.');
      info(`  → Start as a service (macOS):  ${colors.cyan('brew services start caddy')}`);
      info(`  → Start manually:              ${colors.cyan(`caddy run --config ${caddyPaths.caddyfile}`)}`);
      blocked = true;
    }

    // 4. Validate Caddyfile (catches config issues early)
    const validation = await validateCaddyfile();
    if (validation.ok) {
      success('Caddyfile validates');
    } else {
      warning('Caddyfile validation reported issues:');
      info(colors.dim(validation.stderr.split('\n').slice(0, 3).join('\n')));
    }

    // 5. CA trust
    info('');
    info(colors.bold('Local CA'));
    info('  Caddy installs a local CA on first run. To trust it system-wide,');
    info('  execute (one-time, requires sudo):');
    info(`    ${colors.cyan('sudo caddy trust')}`);
    info(`  Browsers will then accept ${colors.cyan('https://*.localhost')} without warnings.`);

    info('');
    if (blocked) {
      warning('Setup incomplete. Address the items above and re-run `lt dev install`.');
    } else {
      success('Setup complete. Use `lt dev migrate` in a project, then `lt dev up`.');
    }

    if (!parameters.options.fromGluegunMenu) process.exit(blocked ? 1 : 0);
    return blocked ? 'dev install: incomplete' : 'dev install: ok';
  },
};

// Helper: spawn a command and wait for it (used by tests / future
// auto-install. Currently unused but exported for symmetry with doctor).
export function runShell(cmd: string, args: string[]): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let errored = false;
    child.stdout?.on('data', (b) => (stdout += String(b)));
    child.stderr?.on('data', (b) => (stderr += String(b)));
    child.on('error', () => (errored = true));
    child.on('close', (code) => resolve({ ok: !errored && code === 0, stderr, stdout }));
  });
}

module.exports = InstallCommand;
