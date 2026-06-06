import { existsSync } from 'fs';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { buildIdentity, buildTicketIdentity } from '../../lib/dev-identity';
import { runChildInherit } from '../../lib/dev-process';
import { deriveDbName, deriveTicketDbName, resolveLayout } from '../../lib/dev-project';
import { loadRegistry } from '../../lib/dev-state';
import {
  defaultTicketBranch,
  deriveTicketId,
  gitFetch,
  gitMainRepoRoot,
  pnpmInstall,
  worktreeAdd,
  worktreePathFor,
  writeTicketMarker,
} from '../../lib/dev-ticket';

/**
 * `lt ticket start <name>` — spin up a fully-isolated parallel dev environment
 * for a ticket or feature, in seconds:
 *
 *   1. `git fetch` + create a git WORKTREE on a fresh branch from `origin/dev`
 *      (so every ticket starts independent from the latest dev) at a sibling
 *      folder `<parent>/<slug>-<id>`,
 *   2. tag it with a `.lt-dev/ticket` marker (makes every `lt dev *` in it
 *      ticket-aware),
 *   3. `pnpm install` (hard-links from the shared store → fast),
 *   4. `lt dev up` → own URLs (`<slug>-<id>.localhost` / `api.<slug>-<id>…`),
 *      own ports, own Caddy block, own EMPTY DB (`<base>-<id>`).
 *
 *   lt ticket start DEV-2200            → svl-2200.localhost      (branch feat/DEV-2200)
 *   lt ticket start checkout-refactor   → svl-checkout-refactor.localhost
 *   lt ticket start DEV-2200 --as cof   → svl-cof.localhost
 */
const StartCommand: GluegunCommand = {
  description: 'Start an isolated parallel dev env for a ticket/feature (worktree + lt dev up)',
  name: 'start',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    // `String(...)` — a purely-numeric arg (e.g. a ticket "9991") is parsed as a
    // JS number by the option parser, on which `.trim()` would throw.
    const name = String(parameters.first ?? '').trim();
    if (!name) {
      error('Usage: lt ticket start <ticket-or-name> [--as <id>] [--branch <branch>] [--base <ref>]');
      info(colors.dim('  e.g. lt ticket start DEV-2200    |    lt ticket start checkout-refactor'));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket start: missing name';
    }

    // Anchor to the MAIN repo (works even when invoked from inside a worktree).
    const layout = resolveLayout(filesystem.cwd(), filesystem);
    let mainRepoRoot: string;
    try {
      mainRepoRoot = gitMainRepoRoot(layout.root);
    } catch {
      error('Not inside a git repository — `lt ticket` needs a git project.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket start: not a git repo';
    }

    const base = buildIdentity(mainRepoRoot);
    const id = deriveTicketId(name, parameters.options.as != null ? String(parameters.options.as) : undefined);
    const branch =
      typeof parameters.options.branch === 'string' ? parameters.options.branch : defaultTicketBranch(name);
    const baseRef = typeof parameters.options.base === 'string' ? parameters.options.base : 'origin/dev';
    const ticketIdentity = buildTicketIdentity(base, id);
    const dbName = deriveTicketDbName(deriveDbName(layout.apiDir, base.slug), id);
    const worktreePath = worktreePathFor(mainRepoRoot, base.slug, id);

    // Pre-flight: nothing already there + slug free.
    if (existsSync(worktreePath)) {
      error(`Target folder already exists: ${worktreePath}`);
      info(colors.dim('  Use a different id (`--as <id>`) or remove it with `lt ticket stop`.'));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket start: path exists';
    }
    if (loadRegistry().projects[ticketIdentity.slug]) {
      warning(`An env named "${ticketIdentity.slug}" is already registered — choose another id with --as.`);
    }

    info('');
    info(colors.bold(`Starting ticket "${id}"  →  ${ticketIdentity.slug}`));
    info(colors.dim(`  branch:   ${branch}  (from ${baseRef})`));
    info(colors.dim(`  worktree: ${worktreePath}`));
    info('');

    // 1. fetch + worktree (fresh branch from origin/dev → independent).
    try {
      info(colors.dim(`Fetching + creating worktree from ${baseRef} …`));
      gitFetch(mainRepoRoot);
      worktreeAdd(mainRepoRoot, worktreePath, branch, baseRef);
    } catch (e) {
      error(`git worktree setup failed: ${(e as Error).message}`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket start: worktree failed';
    }

    // 2. tag the worktree with its ticket id (makes lt dev * ticket-aware).
    writeTicketMarker(worktreePath, id);

    // 3. install deps (pnpm hard-links from the shared store → fast).
    if (parameters.options.install !== false) {
      info(colors.dim('Installing dependencies (pnpm) …'));
      try {
        pnpmInstall(worktreePath);
      } catch (e) {
        warning(`pnpm install failed (${(e as Error).message}) — continuing; run it manually in the worktree.`);
      }
    }

    // 4. bring the isolated stack up (re-invokes THIS lt build so the marker is
    //    honoured even before a global recompile). `--no-up` just scaffolds.
    if (parameters.options.up !== false) {
      info('');
      info(colors.dim('Bringing up the isolated stack (lt dev up) …'));
      const code = await runChildInherit(process.execPath, [process.argv[1], 'dev', 'up'], {
        cwd: worktreePath,
        env: process.env,
      });
      if (code !== 0) warning(`lt dev up exited ${code} — inspect with \`cd ${worktreePath} && lt dev status\`.`);
    }

    // Summary — the URLs the user works with (always re-viewable via `lt ticket list`).
    info('');
    success(`Ticket "${id}" ready.`);
    if (ticketIdentity.subdomains.app) info(`  app: https://${ticketIdentity.subdomains.app.hostname}`);
    if (ticketIdentity.subdomains.api) info(`  api: https://${ticketIdentity.subdomains.api.hostname}`);
    info(`  db:  mongodb://127.0.0.1/${dbName}  (empty)`);
    info(`  dir: ${worktreePath}`);
    info('');
    info(colors.dim(`Open it:   code ${worktreePath}    (or: lt ticket switch ${id})`));
    info(colors.dim(`Test it:   cd ${worktreePath} && lt dev test    (or: lt ticket test ${id})`));
    info(colors.dim('All envs:  lt ticket list'));
    info(colors.dim(`Stop it:   lt ticket stop ${id}`));

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `ticket start: ${id}`;
  },
};

module.exports = StartCommand;
