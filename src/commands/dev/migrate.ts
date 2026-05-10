import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable } from '../../lib/caddy';
import { runMigrate } from '../../lib/dev-migrate-helper';
import { resolveLayout } from '../../lib/dev-project';

/**
 * Register an existing project with `lt dev` and apply idempotent
 * env-aware patches.
 *
 * Idempotent — re-running with no changes is a no-op. Safe to invoke
 * automatically after `lt fullstack init` or by developers manually.
 *
 * Steps (delegated to `lib/dev-migrate-helper.ts#runMigrate`):
 * 1. Resolve workspace layout (api/app dirs, root)
 * 2. Build identity (slug + subdomains)
 * 3. Patch hardcoded ports → env-aware fallbacks (config.env.ts,
 *    nuxt.config.ts, playwright.config.ts)
 * 4. Inject CLAUDE.md URL block (root + each subproject)
 * 5. Persist project to ~/.lenneTech/projects.json
 * 6. Add `.lt-dev/` to .gitignore
 *
 * Closes with a hint to run `lt dev install` if Caddy is missing.
 */
const MigrateCommand: GluegunCommand = {
  alias: ['m'],
  description: 'Migrate an existing project to lt dev (idempotent)',
  hidden: false,
  name: 'migrate',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (!layout.apiDir && !layout.appDir) {
      error('No API (src/config.env.ts) or App (nuxt.config.ts) project detected at this path.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev migrate: not a project';
    }

    const result = runMigrate({ layout });

    info('');
    info(colors.bold(`Migrating "${result.identity.slug}"`));
    info(colors.dim('─'.repeat(60)));
    if (result.identity.subdomains.app) info(`  App URL: https://${result.identity.subdomains.app.hostname}`);
    if (result.identity.subdomains.api) info(`  API URL: https://${result.identity.subdomains.api.hostname}`);
    info(`  DB:      mongodb://127.0.0.1/${result.dbName}`);
    info('');

    // Code patches
    if (result.codePatches.length > 0) {
      for (const r of result.codePatches) {
        if (r.patched) success(`patched ${r.replacements}× in ${r.file}`);
        else info(colors.dim(`already patched: ${r.file}`));
      }
    } else {
      info(colors.dim('  patches: not needed (already env-aware)'));
    }

    // CLAUDE.md
    result.claudePatches.filter((r) => r.patched).forEach((r) => success(`updated CLAUDE.md URL block: ${r.file}`));

    // Registry
    if (result.registryUpdated) {
      success(`registered in ${process.env.LT_DEV_REGISTRY_PATH || '~/.lenneTech/projects.json'}`);
    }

    // .gitignore
    if (result.addedGitignoreEntry) success('added `.lt-dev/` to .gitignore');

    if (result.alreadyMigrated) {
      info(colors.dim('  Project was already fully migrated — nothing changed.'));
    }

    info('');
    success('Migration complete.');

    // Hint: Caddy installed?
    const caddyOk = await caddyAvailable();
    if (!caddyOk) {
      warning('Caddy is not installed yet. Run `lt dev install` first, then `lt dev up`.');
    } else {
      info('Start the project with `lt dev up`.');
    }

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev migrate: ${result.identity.slug}`;
  },
};

module.exports = MigrateCommand;
