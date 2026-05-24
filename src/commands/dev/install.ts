import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { isLtDevProject, isProjectInitialized, shouldRunInitAfterInstall } from '../../lib/dev-bootstrap';
import { runInstall } from '../../lib/dev-install-helper';
import { printMigrateResult, runMigrate } from '../../lib/dev-migrate-helper';
import { resolveLayout } from '../../lib/dev-project';

/**
 * One-time per-machine setup for `lt dev`.
 *
 * Owns the full Caddy lifecycle through a dedicated LaunchAgent
 * (macOS) / systemd-user unit (Linux), bypassing `brew services caddy`
 * (whose plist hardcodes a different Caddyfile path and crash-loops).
 * The actual steps live in `lib/dev-install-helper.ts#runInstall` so
 * `lt dev init` can reuse them without a cross-command call.
 *
 * Auto-chaining: when run from inside an lt-dev-capable project that is
 * not yet registered, it initializes that project afterwards (the same
 * work `lt dev init` does). The chain is one hop deep and cannot recurse
 * because it calls the `runMigrate` *helper* — never the init command
 * (see `dev-bootstrap.ts`). Pass `--skip-init` to opt out.
 */
const InstallCommand: GluegunCommand = {
  alias: ['i'],
  description: 'Setup Caddy service for lt dev',
  hidden: false,
  name: 'install',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, success, warning },
    } = toolbox;

    const result = await runInstall(toolbox);

    // Fatal preconditions — nothing more to do, and an auto-init would be
    // premature (the user must install caddy / use a supported OS first).
    if (result.unsupported) {
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev install: unsupported platform';
    }
    if (result.caddyMissing) {
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev install: caddy missing';
    }

    // Auto-chain: if we're inside an un-initialized lt-dev project, run the
    // project init now. Calling the runMigrate HELPER (not the init command)
    // makes infinite recursion structurally impossible. `--skip-init` opts out.
    const layout = resolveLayout(filesystem.cwd(), filesystem);
    const runInitAfter = shouldRunInitAfterInstall({
      isProject: isLtDevProject(layout),
      projectInitialized: isProjectInitialized(layout),
      skipInit: parameters.options.skipInit === true,
    });
    if (runInitAfter) {
      info('');
      info(colors.dim('Un-initialized lt dev project detected here — running `lt dev init` ...'));
      printMigrateResult(toolbox, runMigrate({ layout }));
    }

    info('');
    if (result.blocked) {
      warning('Setup incomplete. Address the items above and re-run `lt dev install`.');
    } else {
      success('Setup complete. Use `lt dev init` in a project, then `lt dev up`.');
    }

    if (!parameters.options.fromGluegunMenu) process.exit(result.blocked ? 1 : 0);
    return result.blocked ? 'dev install: incomplete' : 'dev install: ok';
  },
};

module.exports = InstallCommand;
