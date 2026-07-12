import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable } from '../../lib/caddy';
import { isMachinePrepared, shouldRunInstallBeforeInit } from '../../lib/dev-bootstrap';
import { runInstall } from '../../lib/dev-install-helper';
import { printMigrateResult, runMigrate } from '../../lib/dev-migrate-helper';
import { resolveLayout } from '../../lib/dev-project';
import { platformSupported } from '../../lib/dev-service';

/**
 * Initialize an existing project for `lt dev` and apply idempotent
 * env-aware patches. (Formerly `lt dev migrate`; `migrate` stays as an
 * alias for backwards compatibility.)
 *
 * Idempotent — re-running with no changes is a no-op. Safe to invoke
 * automatically after `lt fullstack init` or by developers manually.
 *
 * Auto-chaining: if the machine has not been prepared yet (`lt dev
 * install` never ran), it runs install FIRST, then initializes the
 * project. The chain is one hop deep and cannot recurse, because this
 * command calls the `runInstall` *helper* — never the install command
 * (see `dev-bootstrap.ts`). Pass `--skip-install` to opt out.
 *
 * Steps (delegated to `lib/dev-migrate-helper.ts#runMigrate`):
 * 1. Resolve workspace layout (api/app dirs, root)
 * 2. Build identity (slug + subdomains)
 * 3. Patch hardcoded ports → env-aware fallbacks (config.env.ts,
 *    nuxt.config.ts, playwright.config.ts)
 * 4. Inject CLAUDE.md URL block (root + each subproject)
 * 5. Persist project to ~/.lenneTech/projects.json
 * 6. Add `.lt-dev/` to .gitignore
 */
const InitCommand: GluegunCommand = {
  alias: ['migrate', 'm'],
  description: 'Init project for lt dev (idempotent)',
  hidden: false,
  name: 'init',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (!layout.apiDir && !layout.appDir) {
      error(
        'No lt project detected at this path. Expected an API (src/config.env.ts or nest-cli.json), ' +
          'an App (nuxt.config.ts), or a monorepo with projects/api and/or projects/app.',
      );
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev init: not a project';
    }

    // Auto-chain: prepare the machine first if `lt dev install` never ran.
    // `--skip-install` opts out. Calling the runInstall HELPER (not the
    // install command) makes infinite recursion structurally impossible.
    const runInstallFirst = shouldRunInstallBeforeInit({
      machinePrepared: isMachinePrepared(),
      platformSupported: platformSupported() !== 'unsupported',
      skipInstall: parameters.options.skipInstall === true,
    });
    if (runInstallFirst) {
      info(colors.dim('Machine not prepared for lt dev yet — running `lt dev install` first ...'));
      await runInstall(toolbox, { auto: true });
    }

    const result = runMigrate({ layout });
    printMigrateResult(toolbox, result);

    info('');
    success('Project initialized for lt dev.');

    // Closing hint based on Caddy availability.
    const caddyOk = await caddyAvailable();
    if (!caddyOk) {
      warning('Caddy is not installed yet. Run `lt dev install` (installs caddy first), then `lt dev up`.');
    } else {
      info('Start the project with `lt dev up`.');
    }

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev init: ${result.identity.slug}`;
  },
};

module.exports = InitCommand;
