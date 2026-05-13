import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning } from '../../lib/caddy';
import { envBridgePath } from '../../lib/dev-env-bridge';
import { buildIdentity } from '../../lib/dev-identity';
import { resolveLayout } from '../../lib/dev-project';
import { isPidAlive, loadRegistry, loadSession } from '../../lib/dev-state';

/**
 * One-shot E2E convenience wrapper.
 *
 * Ensures the project is up under `lt dev`, then runs the test command
 * with the ENV bridge loaded, and optionally tears the session down at
 * the end. Useful for TDD loops, CI reproduction, and "just test it"
 * workflows where the developer doesn't want to remember three commands.
 *
 * Behaviour:
 *   1. If no `lt dev up` session is alive: run `lt dev up` first.
 *   2. Wait for the App URL to respond (best-effort, ~30s timeout).
 *   3. Inherit the env from `<root>/.lt-dev/.env` (so VS Code IDE-style
 *      runners get the same setup) and spawn the test command in the
 *      App project.
 *   4. With `--teardown` (default false): run `lt dev down` after.
 *
 * Usage:
 *   lt dev test                       # ensure up + run pnpm test:e2e in app
 *   lt dev test --api                 # run API tests instead (pnpm test in api)
 *   lt dev test --teardown            # plus stop session after
 *   lt dev test --debug               # PWDEBUG=1 + headed mode
 *   lt dev test -- <args>             # forward args to the test runner
 *   lt dev test -- --ui crm-login.spec.ts
 */
const TestCommand: GluegunCommand = {
  alias: ['t'],
  description: 'Ensure up + run E2E tests with lt dev env',
  hidden: false,
  name: 'test',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (!layout.apiDir && !layout.appDir) {
      error('No API or App project detected at this path.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev test: not a project';
    }

    const apiMode = Boolean(parameters.options.api);
    const teardown = Boolean(parameters.options.teardown);
    const debug = Boolean(parameters.options.debug);
    // Forwarded args after `--` (gluegun puts them in parameters.array).
    const forwarded = parameters.array || [];

    const targetDir = apiMode ? layout.apiDir : layout.appDir;
    if (!targetDir) {
      error(`Cannot run ${apiMode ? 'API' : 'App'} tests — no ${apiMode ? 'apiDir' : 'appDir'} in layout.`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev test: target missing';
    }

    const identity = buildIdentity(layout.root);

    // Pre-flight: Caddy + ensure up.
    if (!apiMode) {
      if (!(await caddyAvailable())) {
        error('caddy is not installed. Run `lt dev install` first.');
        if (!parameters.options.fromGluegunMenu) process.exit(1);
        return 'dev test: caddy missing';
      }
      if (!(await caddyDaemonRunning())) {
        error('caddy daemon not running. Run `lt dev install` first.');
        if (!parameters.options.fromGluegunMenu) process.exit(1);
        return 'dev test: caddy daemon down';
      }

      const reg = loadRegistry();
      const entry = reg.projects[identity.slug];
      const session = loadSession(layout.root);
      const sessionAlive =
        session !== null &&
        ((session.pids.api && isPidAlive(session.pids.api)) || (session.pids.app && isPidAlive(session.pids.app)));

      if (!entry || !sessionAlive) {
        info(colors.dim('Project not running — invoking `lt dev up` first ...'));
        const upResult = await runChild('lt', ['dev', 'up'], { cwd: layout.root, env: process.env, inherit: true });
        if (upResult !== 0) {
          error(`lt dev up failed (exit ${upResult}).`);
          if (!parameters.options.fromGluegunMenu) process.exit(upResult ?? 1);
          return 'dev test: up failed';
        }
        // Wait for App URL to respond (best-effort).
        const appHost = identity.subdomains.app?.hostname;
        if (appHost) {
          info(colors.dim(`Waiting for https://${appHost} to respond ...`));
          await waitForUrl(`https://${appHost}`, 30_000);
        }
      }
    }

    // Build env: process.env + bridge file (bridge wins for keys it defines).
    const env = { ...process.env, ...readBridgeEnv(layout.root) };
    if (debug) {
      env.PWDEBUG = '1';
      env.HEADED = '1';
    }

    // Pick the runner.
    const pnpmBin = process.env.LT_PNPM_BIN || 'pnpm';
    const args = apiMode ? ['run', 'test:e2e', ...forwarded] : ['run', 'test:e2e', ...forwarded];

    info('');
    info(colors.bold(`Running ${apiMode ? 'API' : 'App'} E2E tests for "${identity.slug}"`));
    info(colors.dim(`  ${pnpmBin} ${args.join(' ')}`));
    info(colors.dim(`  cwd: ${targetDir}`));
    info('');

    const exitCode = await runChild(pnpmBin, args, { cwd: targetDir, env, inherit: true });

    if (teardown) {
      info('');
      info(colors.dim('Tearing down lt dev session ...'));
      await runChild('lt', ['dev', 'down'], { cwd: layout.root, env: process.env, inherit: true });
    }

    if (exitCode === 0) success('Tests passed.');
    else error(`Tests failed (exit ${exitCode}).`);

    if (!parameters.options.fromGluegunMenu) process.exit(exitCode ?? 1);
    return `dev test: exit=${exitCode}`;
  },
};

interface ChildOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
  inherit: boolean;
}

/**
 * Read the .lt-dev/.env bridge file as a key/value map.
 * Returns an empty object if the file is missing.
 */
function readBridgeEnv(root: string): NodeJS.ProcessEnv {
  const file = envBridgePath(root);
  if (!existsSync(file)) return {};
  const out: NodeJS.ProcessEnv = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Spawn a child synchronously (waits for exit), inheriting stdio when requested. */
function runChild(cmd: string, args: string[], opts: ChildOpts): Promise<null | number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: opts.inherit ? 'inherit' : 'pipe',
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code));
  });
}

/** Poll a URL until it responds or timeout elapses. */
function waitForUrl(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const child = spawn('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', url], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let status = '';
      child.stdout?.on('data', (b) => (status += String(b)));
      child.on('close', () => {
        if (/^[1-5]\d\d$/.test(status.trim())) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 500);
      });
      child.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

module.exports = TestCommand;
