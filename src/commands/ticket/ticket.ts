import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Parallel ticket dev environments (`lt ticket <subcommand>`).
 *
 * Each ticket runs in its OWN git worktree (a fresh branch from `origin/dev`)
 * with its OWN isolated `lt dev` stack — own URLs, ports, Caddy block and empty
 * database — so several tickets can be developed, browser-tested and E2E-tested
 * fully in parallel without ever influencing each other.
 *
 * Subcommands:
 * - `start <name>`  — create the worktree + bring the isolated stack up
 * - `list`          — dashboard of all ticket envs (URLs, branch, status, DB)
 * - `switch <id>`   — show + open a ticket worktree in your editor
 * - `test <id>`     — run the E2E suite in the ticket's isolated stack
 * - `stop <id>`     — tear the env down + remove the worktree (branch kept)
 */
module.exports = {
  alias: ['tk'],
  description: 'Parallel ticket dev environments (worktree + isolated lt dev stack)',
  hidden: false,
  name: 'ticket',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('ticket');
    return 'ticket';
  },
};
