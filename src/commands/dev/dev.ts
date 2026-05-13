import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Local development orchestration commands (`lt dev <subcommand>`).
 *
 * Subcommands:
 * - `install`   — one-time per-machine setup: caddy + LaunchAgent/systemd unit
 * - `uninstall` — remove the lt-dev service (symmetric to install)
 * - `migrate`   — register an existing project (idempotent ENV patches)
 * - `up`        — start API + App behind Caddy with project-specific URLs
 * - `down`      — stop the detached processes + remove the Caddy block
 * - `status`    — show what is running
 * - `doctor`    — diagnose Caddy/CA/DNS/port issues
 * - `tunnel`    — Cloudflare quick tunnel to expose a running project publicly
 */
module.exports = {
  alias: ['d'],
  description: 'Local dev orchestration (Caddy + per-project URLs)',
  hidden: false,
  name: 'dev',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('dev');
    return 'dev';
  },
};
