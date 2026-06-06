import { execFileSync } from 'child_process';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { resolveLayout } from '../../lib/dev-project';
import { gitMainRepoRoot, listWorktrees } from '../../lib/dev-ticket';

/**
 * `lt ticket switch <id>` — show a ticket worktree's path and open it in your
 * editor (best-effort). A CLI cannot change the parent shell's directory, so it
 * also prints the `cd` line to copy. `--no-open` only prints.
 */
const SwitchCommand: GluegunCommand = {
  alias: ['sw', 'open'],
  description: 'Show a ticket worktree path + open it in your editor',
  name: 'switch',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success },
    } = toolbox;

    const id = String(parameters.first ?? '').trim();
    if (!id) {
      error('Usage: lt ticket switch <id>');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket switch: missing id';
    }

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    let mainRepoRoot: string;
    try {
      mainRepoRoot = gitMainRepoRoot(layout.root);
    } catch {
      error('Not inside a git repository.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket switch: not a git repo';
    }

    const wt = listWorktrees(mainRepoRoot).find((w) => w.ticket === id);
    if (!wt) {
      error(`No ticket worktree "${id}" found. See \`lt ticket list\`.`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket switch: not found';
    }

    info('');
    info(`Ticket "${id}"  →  ${wt.path}`);
    info(colors.dim(`  cd ${wt.path}`));
    if (parameters.options.open !== false) {
      const editor = process.env.LT_EDITOR || 'code';
      try {
        execFileSync(editor, [wt.path], { stdio: 'ignore' });
        success(`Opened in ${editor}.`);
      } catch {
        info(colors.dim(`  (could not run \`${editor}\` — open the folder manually, or set LT_EDITOR)`));
      }
    }

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `ticket switch: ${id}`;
  },
};

module.exports = SwitchCommand;
