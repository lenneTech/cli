import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { buildIdentity } from '../../lib/dev-identity';
import { resolveLayout } from '../../lib/dev-project';
import { isPidAlive, loadRegistry, loadSession } from '../../lib/dev-state';
import { gitMainRepoRoot, listWorktrees } from '../../lib/dev-ticket';

/**
 * `lt ticket list` — the dashboard of all active ticket worktrees: id, folder,
 * branch, URLs, DB and running state. The one place to re-view every ticket's
 * URLs at any time.
 */
const ListCommand: GluegunCommand = {
  alias: ['ls'],
  description: 'List all ticket worktrees with their URLs + status',
  name: 'list',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    let mainRepoRoot: string;
    try {
      mainRepoRoot = gitMainRepoRoot(layout.root);
    } catch {
      warning('Not inside a git repository.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket list: not a git repo';
    }

    const base = buildIdentity(mainRepoRoot);
    const tickets = listWorktrees(mainRepoRoot).filter((w) => w.ticket);
    const reg = loadRegistry();

    info('');
    info(colors.bold('Ticket environments'));
    info(colors.dim('─'.repeat(64)));
    if (tickets.length === 0) {
      info(colors.dim('  none — start one with `lt ticket start <ticket-or-name>`'));
      info('');
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'ticket list: empty';
    }

    for (const wt of tickets) {
      const session = loadSession(wt.path);
      const apiAlive = session?.pids.api ? isPidAlive(session.pids.api) : false;
      const appAlive = session?.pids.app ? isPidAlive(session.pids.app) : false;
      const running = apiAlive || appAlive;
      const dot = running ? colors.green('●') : colors.dim('○');
      // The dev stack for this ticket is registered under `<base>-<id>`.
      const entry = reg.projects[`${base.slug}-${wt.ticket}`];
      info(`  ${dot} ${colors.bold(String(wt.ticket).padEnd(16))} ${colors.dim(`branch ${wt.branch ?? '-'}`)}`);
      if (entry) {
        for (const [sub, host] of Object.entries(entry.subdomains)) info(`       ${sub.padEnd(4)} https://${host}`);
        if (entry.dbName) info(`       db   mongodb://127.0.0.1/${entry.dbName}`);
      }
      info(colors.dim(`       dir  ${wt.path}`));
      info(colors.dim(`       ${running ? 'running' : 'stopped'}${entry ? '' : ' (not brought up yet)'}`));
    }
    info('');
    info(
      colors.dim(
        'Open: `code <dir>` / `lt ticket switch <id>` · Test: `lt ticket test <id>` · Stop: `lt ticket stop <id>`',
      ),
    );
    info('');

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `ticket list: ${tickets.length}`;
  },
};

module.exports = ListCommand;
