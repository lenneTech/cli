import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { detectFrameworkMode, isVendoredProject } from '../../lib/framework-detection';
import { detectFrontendFrameworkMode, isVendoredAppProject } from '../../lib/frontend-framework-detection';

/**
 * Update a fullstack workspace — mode-aware.
 *
 * lenne.tech fullstack projects currently run in one of two framework
 * consumption modes:
 *
 *   - npm mode:    `@lenne.tech/nest-server` is an npm dependency. Updates
 *                  happen via `pnpm update @lenne.tech/nest-server` plus
 *                  the migration guides, orchestrated by the
 *                  `lt-dev:nest-server-updater` Claude Code agent.
 *
 *   - vendor mode: The framework `core/` tree is vendored into
 *                  `projects/api/src/core/`. Updates happen via the
 *                  `lt-dev:nest-server-core-updater` Claude Code agent,
 *                  which clones the upstream repo, computes a delta,
 *                  applies the approved hunks, and re-runs the flatten-fix.
 *
 * Detection is based on the presence of `src/core/VENDOR.md` in the api
 * project. This command prints the right instructions for the caller's
 * project; actual update orchestration lives in the Claude Code agents,
 * not in the CLI.
 */
const NewCommand: GluegunCommand = {
  alias: ['up', 'upd'],
  description: 'Show the mode-specific update instructions for this fullstack workspace',
  hidden: false,
  name: 'update',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      print: { colors, info, success, warning },
    } = toolbox;

    info('');
    info(colors.bold('Fullstack Update'));
    info(colors.dim('─'.repeat(60)));

    // Walk from cwd DOWN into projects/api if it exists, otherwise assume
    // the caller is already inside an api project. Users can also point at
    // a specific directory via `--api <path>`.
    const cwd = filesystem.cwd();
    const candidates = [
      toolbox.parameters.options.api ? String(toolbox.parameters.options.api) : null,
      join(cwd, 'projects', 'api'),
      join(cwd, 'packages', 'api'),
      cwd,
    ].filter((p): p is string => Boolean(p));

    let apiDir: string | undefined;
    for (const candidate of candidates) {
      if (filesystem.exists(join(candidate, 'package.json'))) {
        apiDir = candidate;
        break;
      }
    }

    if (!apiDir) {
      warning('  Could not locate an api project (no package.json found in cwd or projects/api/).');
      info('');
      info('  Pass --api <path> to point at the api project explicitly.');
      info('');
      return;
    }

    const mode = detectFrameworkMode(apiDir);
    const vendored = isVendoredProject(apiDir);

    info(`  API project: ${apiDir}`);
    info(`  Framework mode: ${mode}${vendored ? ' (src/core/VENDOR.md present)' : ''}`);
    info('');

    if (mode === 'vendor') {
      info(colors.bold('Vendor-mode update flow:'));
      info('');
      info('  The framework core/ tree lives directly in this project at');
      info('    src/core/');
      info('  and is managed as first-class project code. Local patches are');
      info('  allowed and tracked in src/core/VENDOR.md.');
      info('');
      info(colors.bold('  Recommended update commands:'));
      info('');
      info('    1. Refresh the upstream baseline + check for new versions');
      info(`       ${colors.cyan('(run from the api project)')}`);
      info('');
      info('       /lt-dev:backend:update-nest-server-core');
      info('');
      info('    2. After the updater completes, run a freshness check:');
      info('');
      info('       pnpm run check:vendor-freshness');
      info('');
      info('    3. If local changes have become generally useful, propose');
      info('       them as upstream PRs via:');
      info('');
      info('       /lt-dev:backend:contribute-nest-server-core');
      info('');
      success('  All of these operate on src/core/ in-place; no npm dep bump.');
    } else {
      info(colors.bold('npm-mode update flow:'));
      info('');
      info('  The framework lives in node_modules/@lenne.tech/nest-server as');
      info('  a pinned npm dependency.');
      info('');
      info(colors.bold('  Recommended update commands:'));
      info('');
      info('    1. Run the nest-server-updater agent:');
      info('');
      info('       /lt-dev:backend:update-nest-server');
      info('');
      info('       (or manually: pnpm update @lenne.tech/nest-server');
      info('        and walk the migration guides)');
      info('');
      info('    2. After upgrade, run the full check suite:');
      info('');
      info('       pnpm run check');
      info('');
      success('  The nest-server-updater agent auto-detects vendor projects');
      success('  and delegates to nest-server-core-updater when VENDOR.md is present.');
    }

    // ── Frontend mode-aware instructions ──────────────────────────────
    info('');
    info(colors.dim('─'.repeat(60)));
    info('');

    // Detect frontend project
    const appCandidates = [join(cwd, 'projects', 'app'), join(cwd, 'packages', 'app')].filter((p): p is string =>
      Boolean(p),
    );

    let appDir: string | undefined;
    for (const candidate of appCandidates) {
      if (filesystem.exists(join(candidate, 'nuxt.config.ts')) || filesystem.exists(join(candidate, 'package.json'))) {
        appDir = candidate;
        break;
      }
    }

    if (appDir) {
      const frontendMode = detectFrontendFrameworkMode(appDir);
      const frontendVendored = isVendoredAppProject(appDir);

      info(`  App project: ${appDir}`);
      info(`  Frontend framework mode: ${frontendMode}${frontendVendored ? ' (app/core/VENDOR.md present)' : ''}`);
      info('');

      if (frontendMode === 'vendor') {
        info(colors.bold('Frontend vendor-mode update flow:'));
        info('');
        info('  The nuxt-extensions module lives directly in this project at');
        info('    app/core/');
        info('  and is managed as first-class project code.');
        info('');
        info(colors.bold('  Recommended update commands:'));
        info('');
        info('    /lt-dev:frontend:update-nuxt-extensions-core');
        info('');
      } else {
        info(colors.bold('Frontend npm-mode update flow:'));
        info('');
        info('    /lt-dev:fullstack:update --skip-backend');
        info('');
        info('    (or manually: pnpm update @lenne.tech/nuxt-extensions)');
        info('');
      }
    }

    info('');
    info(colors.bold('For a comprehensive update of everything, use:'));
    info('');
    info('    /lt-dev:fullstack:update-all');
    info('');
    info(colors.dim('─'.repeat(60)));
    info('');
    return `fullstack update (backend: ${mode}, frontend: ${appDir ? detectFrontendFrameworkMode(appDir) : 'not found'})`;
  },
};

export default NewCommand;
