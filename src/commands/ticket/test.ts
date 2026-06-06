import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { runChildInherit } from '../../lib/dev-process';
import { resolveLayout } from '../../lib/dev-project';
import { gitMainRepoRoot, listWorktrees } from '../../lib/dev-ticket';

/**
 * `lt ticket test <id> [--shard N] [-- <args>]` — run the E2E suite for a ticket
 * in ITS isolated stack + DB, by delegating to `lt dev test` inside the ticket
 * worktree (which is ticket-aware via the marker → test DB `<base>-<id>-test`).
 */
const TestCommand: GluegunCommand = {
  alias: ['t'],
  description: 'Run the E2E suite for a ticket in its isolated stack',
  name: 'test',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info },
    } = toolbox;

    const id = String(parameters.first ?? '').trim();
    if (!id) {
      error('Usage: lt ticket test <id> [--shard N] [--keep] [-- <playwright args>]');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket test: missing id';
    }

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    let mainRepoRoot: string;
    try {
      mainRepoRoot = gitMainRepoRoot(layout.root);
    } catch {
      error('Not inside a git repository.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket test: not a git repo';
    }

    const wt = listWorktrees(mainRepoRoot).find((w) => w.ticket === id);
    if (!wt) {
      error(`No ticket worktree "${id}" found. See \`lt ticket list\`.`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'ticket test: not found';
    }

    // Reconstruct `lt dev test` args: forward the common flags + the `--` array.
    const devArgs = ['dev', 'test'];
    if (parameters.options.shard !== undefined) {
      const s = parameters.options.shard;
      devArgs.push(s === true ? '--shard' : `--shard=${s}`);
    }
    if (parameters.options.keep === true) devArgs.push('--keep');
    if (parameters.options.debug === true) devArgs.push('--debug');
    // Playwright args after `--` (e.g. a spec path / `--grep`): read them from
    // the RAW argv. gluegun's parsed `parameters.array` does not reliably carry
    // post-`--` tokens through the `ticket <id>` positional, which silently ran
    // the WHOLE suite instead of the requested spec.
    const dashIdx = process.argv.indexOf('--');
    const forwarded = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : [];
    if (forwarded.length > 0) devArgs.push('--', ...forwarded);

    info(colors.dim(`(cd ${wt.path} && lt ${devArgs.join(' ')})`));
    const code = await runChildInherit(process.execPath, [process.argv[1], ...devArgs], {
      cwd: wt.path,
      env: process.env,
    });

    if (!parameters.options.fromGluegunMenu) process.exit(code ?? 1);
    return `ticket test: ${id} exit=${code}`;
  },
};

module.exports = TestCommand;
