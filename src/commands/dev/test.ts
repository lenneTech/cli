import { existsSync, readFileSync } from 'fs';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, caddyDaemonRunning } from '../../lib/caddy';
import { envBridgePath } from '../../lib/dev-env-bridge';
import { pickPackageManager } from '../../lib/dev-package-manager';
import { runChildInherit } from '../../lib/dev-process';
import { appNeedsPortPatch, resolveLayout } from '../../lib/dev-project';
import {
  autoShardCount,
  bringUpTestSession,
  ensurePlaywrightBrowsers,
  runShardedTestSession,
  tearDownAllTestSessions,
  tearDownTestSession,
  TestSessionLogger,
} from '../../lib/dev-test-session';
import { resolveDevIdentity } from '../../lib/dev-ticket';

/**
 * One-shot E2E convenience wrapper.
 *
 * App mode (default) runs the Playwright suite against a fully ISOLATED test
 * stack (own URLs / ports / Caddy block / dedicated `<…>-test` database) that
 * runs parallel to — and never touches — the developer's `lt dev up` session.
 * Playwright's global-setup resets that dedicated DB once before the first test.
 * The stack is torn down automatically when the run finishes (residue-free).
 *
 * API mode (`--api`) runs the standalone API test suite (`pnpm test:e2e` in the
 * API), which already isolates itself on its own DB — no stack is brought up.
 *
 * Usage:
 *   lt dev test                  # isolated Playwright E2E (auto teardown)
 *   lt dev test --keep           # leave the test stack up afterwards (debug)
 *   lt dev test down             # tear the test stack down (residue-free)
 *   lt dev test --api            # run API tests instead (already isolated)
 *   lt dev test --debug          # PWDEBUG=1 + headed
 *   lt dev test --shard          # shard across 2 isolated stacks (default — stable)
 *   lt dev test --shard N        # shard across N isolated stacks (parallel)
 *   lt dev test --shard auto     # size N from this machine's CPU + RAM
 *   lt dev test -- <args>        # forward args to Playwright
 */
const TestCommand: GluegunCommand = {
  alias: ['t'],
  description: 'Run E2E tests in an isolated, parallel test stack (auto teardown)',
  hidden: false,
  name: 'test',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (!layout.apiDir && !layout.appDir) {
      error('No API or App project detected at this path.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev test: not a project';
    }

    // Ticket-aware: a ticket worktree tests its OWN isolated stack + DB
    // (`<slug>-<id>-test`), so resolve the ticket identity + pass the ticket dev
    // DB so the test DB is derived per ticket (never shared between tickets).
    const { dbName: devDbName, identity } = resolveDevIdentity(layout, { ticket: parameters.options.ticket });
    const log: TestSessionLogger = { dim: colors.dim, info, warn: warning };

    // Sub-command: `lt dev test down` — tear the test stack(s) down + exit.
    // Reclaims both the unsharded stack and any leftover sharded stacks.
    if (parameters.first === 'down') {
      const { stopped } = await tearDownAllTestSessions(layout, identity, log);
      if (stopped.length > 0) success(`Test stack down: ${stopped.join(', ')}`);
      else info(colors.dim('No test stack was running.'));
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev test: down';
    }

    const apiMode = Boolean(parameters.options.api);
    const keep = Boolean(parameters.options.keep) || parameters.options.teardown === false;
    const debug = Boolean(parameters.options.debug);
    const forwarded = parameters.array || [];
    // `--shard N` → run the suite split across N fully-isolated stacks in
    // parallel. A bare `--shard` defaults to 2 — the stable sweet spot for a
    // heavy built-SSR suite (N>=3 over-subscribes the perf cores → flaky; see
    // autoShardCount). `--shard auto` instead sizes N from this machine's CPU+RAM.
    const SHARD_DEFAULT = 2;
    const shardRaw = parameters.options.shard ?? parameters.options.shards;
    let shardTotal: number | undefined;
    if (shardRaw !== undefined) {
      if (shardRaw === true) shardTotal = SHARD_DEFAULT;
      else if (String(shardRaw).toLowerCase() === 'auto') shardTotal = autoShardCount();
      else shardTotal = Math.floor(Number(shardRaw));
    }

    // -------------------------------------------------------------------------
    // API mode — standalone, already isolated on its own DB. No stack needed.
    // -------------------------------------------------------------------------
    if (apiMode) {
      if (!layout.apiDir) {
        error('No API project in this layout.');
        if (!parameters.options.fromGluegunMenu) process.exit(1);
        return 'dev test: no api';
      }
      info(colors.bold(`Running API tests for "${identity.slug}" (isolated DB)`));
      const apiPm = pickPackageManager(layout.apiDir);
      const code = await runChildInherit(apiPm.bin, apiPm.runScript('test:e2e', forwarded), {
        cwd: layout.apiDir,
        env: process.env,
      });
      if (code === 0) success('API tests passed.');
      else error(`API tests failed (exit ${code}).`);
      if (!parameters.options.fromGluegunMenu) process.exit(code ?? 1);
      return `dev test: api exit=${code}`;
    }

    // -------------------------------------------------------------------------
    // App mode — isolated Playwright stack.
    // -------------------------------------------------------------------------
    if (!layout.appDir) {
      error('No App project in this layout.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev test: no app';
    }
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

    // Pre-flight (#3): if the project's playwright.config is not env-aware
    // (hardcoded baseURL or an unguarded `webServer`), the suite would IGNORE
    // the isolated stack we are about to build and hit localhost:3001 instead —
    // wasting a full build on a stack nothing uses. Abort early with the fix,
    // unless `--force`.
    const unpatched = appNeedsPortPatch(layout.appDir).some((f) => f.endsWith('playwright.config.ts'));
    if (unpatched && !parameters.options.force) {
      error("This project's playwright.config.ts is not env-aware (hardcoded baseURL or unguarded webServer).");
      error('`lt dev test` would build an isolated stack the suite then IGNORES (tests would hit localhost:3001).');
      info(colors.dim('Fix: run `lt dev init` to make baseURL env-aware + guard the webServer — or pass --force.'));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev test: playwright.config not env-aware (run lt dev init or --force)';
    }

    // -------------------------------------------------------------------------
    // Sharded mode (`--shard N`) — N fully-isolated stacks + parallel
    // `--shard=i/N`, the local CI-parity matrix. Each shard has its own DB so
    // there is no cross-shard contention. Auto-teardown of ALL shards (or
    // `--keep` them for `lt dev test down`).
    // -------------------------------------------------------------------------
    if (shardTotal !== undefined && shardTotal > 1) {
      let allTornDown = false;
      const teardownAll = async (): Promise<void> => {
        if (allTornDown || keep) return;
        allTornDown = true;
        await tearDownAllTestSessions(layout, identity, log, { silent: true });
      };
      const onShardSignal = () => {
        teardownAll()
          .catch(() => undefined)
          .finally(() => process.exit(130));
      };
      process.on('SIGINT', onShardSignal);
      process.on('SIGTERM', onShardSignal);

      let shardExit: null | number = 1;
      try {
        info('');
        info(colors.bold(`Running isolated Playwright E2E for "${identity.slug}" sharded across ${shardTotal} stacks`));
        const shardPm = pickPackageManager(layout.appDir);
        shardExit = await runShardedTestSession(layout, identity, log, {
          devDbName,
          forwarded,
          pm: shardPm,
          total: shardTotal,
        });
      } catch (e) {
        error(`Failed to run sharded E2E: ${(e as Error).message}`);
        shardExit = 1;
      } finally {
        process.off('SIGINT', onShardSignal);
        process.off('SIGTERM', onShardSignal);
        if (keep) {
          info('');
          info(colors.dim('Test stacks left running (--keep). Stop them with: `lt dev test down`.'));
        } else {
          await teardownAll();
        }
      }

      if (shardExit === 0) success('Tests passed (all shards).');
      else error(`Tests failed (exit ${shardExit}).`);
      if (!parameters.options.fromGluegunMenu) process.exit(shardExit ?? 1);
      return `dev test: sharded exit=${shardExit}`;
    }

    let tornDown = false;
    const teardown = async (): Promise<void> => {
      if (tornDown || keep) return;
      tornDown = true;
      await tearDownTestSession(layout, identity, log);
    };
    // Residue-free teardown even on Ctrl-C / kill.
    const onSignal = () => {
      teardown()
        .catch(() => undefined)
        .finally(() => process.exit(130));
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    let exitCode: null | number = 1;
    try {
      const ctx = await bringUpTestSession(layout, identity, log, { devDbName });

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...readBridgeEnv(layout.root),
        // Playwright global-setup resets THIS db (allow-listed) before the suite.
        MONGO_URI: `mongodb://127.0.0.1/${ctx.dbName}`,
        // Point the auth E2E specs directly at the isolated test API log so they
        // read the email-verification token without relying on the spec's upward
        // filesystem search (the CI already documents `lt dev test` as doing this).
        ...(ctx.apiLogPath ? { NEST_SERVER_LOG: ctx.apiLogPath } : {}),
      };
      if (debug) {
        env.PWDEBUG = '1';
        env.HEADED = '1';
      }

      info('');
      info(colors.bold(`Running isolated Playwright E2E for "${identity.slug}"`));
      info(colors.dim(`  app: ${ctx.appUrl}   db: ${ctx.dbName}`));
      info('');

      const appPm = pickPackageManager(layout.appDir);
      // Self-heal: install the app's Playwright browser build if missing —
      // idempotent (~1s when cached); a fresh project otherwise fails every spec.
      ensurePlaywrightBrowsers(layout.appDir, appPm, (m) => info(colors.dim(m)));
      exitCode = await runChildInherit(appPm.bin, appPm.runScript('test:e2e', forwarded), {
        cwd: layout.appDir,
        env,
      });
    } catch (e) {
      error(`Failed to run isolated E2E: ${(e as Error).message}`);
      exitCode = 1;
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      if (keep) {
        info('');
        info(colors.dim('Test stack left running (--keep). Stop it with: `lt dev test down`.'));
      } else {
        await teardown();
      }
    }

    if (exitCode === 0) success('Tests passed.');
    else error(`Tests failed (exit ${exitCode}).`);
    if (!parameters.options.fromGluegunMenu) process.exit(exitCode ?? 1);
    return `dev test: exit=${exitCode}`;
  },
};

/**
 * Read the test ENV bridge (`.lt-dev/.env.test`) as a key/value map.
 * Returns an empty object if missing.
 */
function readBridgeEnv(root: string): NodeJS.ProcessEnv {
  const file = envBridgePath(root, '.env.test');
  if (!existsSync(file)) return {};
  const out: NodeJS.ProcessEnv = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

module.exports = TestCommand;
