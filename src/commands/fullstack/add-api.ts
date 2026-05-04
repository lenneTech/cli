import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { hoistWorkspacePnpmConfig } from '../../lib/hoist-workspace-pnpm-config';
import {
  detectWorkspaceLayout,
  findWorkspaceRoot,
  runExperimentalNestBaseRename,
  writeApiConfig,
} from '../../lib/workspace-integration';

/**
 * Add an API (`projects/api/`) to a fullstack workspace that currently
 * only ships a frontend (`projects/app/`). Mirrors every API-related
 * flag from `lt fullstack init` so the surface area stays in lockstep.
 *
 * Refuses to run if `projects/api/` already exists — use a regular
 * `lt fullstack init` workflow on a fresh directory instead, or remove
 * the existing API first.
 */
const NewCommand: GluegunCommand = {
  alias: ['add-api'],
  description: 'Add API to fullstack workspace',
  hidden: false,
  name: 'add-api',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      git,
      parameters,
      patching,
      print: { error, info, spin, success, warning },
      prompt: { ask },
      server,
      system,
    } = toolbox;

    // Help-JSON support so AI agents can introspect the flags.
    if (
      toolbox.tools.helpJson({
        aliases: ['add-api'],
        configuration: 'commands.fullstack.*',
        description: 'Add a NestJS API to an existing fullstack workspace',
        name: 'add-api',
        options: [
          { description: 'API mode', flag: '--api-mode', type: 'string', values: ['Rest', 'GraphQL', 'Both'] },
          {
            description: 'Framework consumption mode',
            flag: '--framework-mode',
            type: 'string',
            values: ['npm', 'vendor'],
          },
          {
            description: 'Branch/tag/commit of upstream nest-server (vendor mode)',
            flag: '--framework-upstream-branch',
            type: 'string',
          },
          { description: 'Branch of nest-server-starter to clone', flag: '--api-branch', type: 'string' },
          { description: 'Path to local API template to copy from', flag: '--api-copy', type: 'string' },
          { description: 'Path to local API template to symlink', flag: '--api-link', type: 'string' },
          {
            description: 'Use experimental nest-base template (Bun + Prisma + Postgres + Better-Auth)',
            flag: '--next',
            type: 'boolean',
          },
          { description: 'Workspace root (defaults to cwd)', flag: '--workspace-dir', type: 'string' },
          { description: 'Skip install / format after API integration', flag: '--skip-install', type: 'boolean' },
          { description: 'Print resolved plan and exit without disk changes', flag: '--dry-run', type: 'boolean' },
          { description: 'Skip all interactive prompts', flag: '--noConfirm', type: 'boolean' },
        ],
      })
    ) {
      return;
    }

    const timer = system.startTimer();
    info('Add API to fullstack workspace');
    toolbox.tools.nonInteractiveHint(
      'lt fullstack add-api --api-mode <Rest|GraphQL|Both> --framework-mode <npm|vendor> [--api-branch <ref>] [--next] [--dry-run] --noConfirm',
    );

    if (!(await git.gitInstalled())) {
      return;
    }

    const ltConfig = config.loadConfig();

    // Parse CLI options
    const cliApiMode = parameters.options['api-mode'] || parameters.options.apiMode;
    const cliFrameworkMode = parameters.options['framework-mode'] as 'npm' | 'vendor' | undefined;
    const cliFrameworkUpstreamBranch = parameters.options['framework-upstream-branch'] as string | undefined;
    const cliApiBranch = parameters.options['api-branch'] as string | undefined;
    const cliApiCopy = parameters.options['api-copy'] as string | undefined;
    const cliApiLink = parameters.options['api-link'] as string | undefined;
    const cliWorkspaceDir = parameters.options['workspace-dir'] as string | undefined;
    const cliDryRun = parameters.options['dry-run'];
    const cliSkipInstall = parameters.options['skip-install'];
    const experimental = parameters.options.next === true || parameters.options.next === 'true';
    const dryRun = cliDryRun === true || cliDryRun === 'true';
    const skipInstall = cliSkipInstall === true || cliSkipInstall === 'true';

    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.fullstack,
      config: ltConfig,
    });

    // Pull the same defaults from lt.config that init does, so commands
    // share configuration without users having to maintain two blocks.
    const configApiMode = ltConfig?.commands?.fullstack?.apiMode;
    const configFrameworkMode = ltConfig?.commands?.fullstack?.frameworkMode as 'npm' | 'vendor' | undefined;
    const configApiBranch = ltConfig?.commands?.fullstack?.apiBranch;
    const configApiCopy = ltConfig?.commands?.fullstack?.apiCopy;
    const configApiLink = ltConfig?.commands?.fullstack?.apiLink;
    const globalApiMode = config.getGlobalDefault<'Both' | 'GraphQL' | 'Rest'>(ltConfig, 'apiMode');

    // Workspace detection. Priority:
    //   1. explicit `--workspace-dir <path>` always wins
    //   2. cwd if it itself is a workspace
    //   3. nearest workspace found by walking up from cwd (catches the
    //      "user is inside projects/app/src/" case so they don't need
    //      to manually pass `--workspace-dir ../..`)
    let workspaceDir: string;
    if (cliWorkspaceDir) {
      workspaceDir = cliWorkspaceDir;
    } else {
      const cwdLayout = detectWorkspaceLayout('.', filesystem);
      if (cwdLayout.hasWorkspace) {
        workspaceDir = '.';
      } else {
        const upRoot = findWorkspaceRoot('.', filesystem);
        if (upRoot) {
          workspaceDir = upRoot;
          info(`Detected fullstack workspace at ${upRoot} (walked up from cwd).`);
        } else {
          workspaceDir = '.';
        }
      }
    }
    const layout = detectWorkspaceLayout(workspaceDir, filesystem);

    if (!layout.hasWorkspace) {
      error(
        `No fullstack workspace detected at "${workspaceDir}". Expected pnpm-workspace.yaml, package.json#workspaces, or a projects/ directory. Use \`lt fullstack init\` for a fresh workspace.`,
      );
      return;
    }
    if (layout.hasApi) {
      error(
        `An API already exists at "${workspaceDir}/projects/api". Remove it first or use \`lt fullstack init\` in a fresh directory.`,
      );
      return;
    }

    // Resolve api mode (CLI > experimental override > config > global > interactive/default).
    let apiMode: 'Both' | 'GraphQL' | 'Rest';
    if (experimental) {
      apiMode = 'Rest';
      info('Using experimental nest-base template (Bun + Prisma + Postgres + Better-Auth)');
    } else if (cliApiMode) {
      apiMode = cliApiMode as 'Both' | 'GraphQL' | 'Rest';
    } else if (configApiMode) {
      apiMode = configApiMode;
      info(`Using API mode from lt.config: ${apiMode}`);
    } else if (globalApiMode) {
      apiMode = globalApiMode;
      info(`Using API mode from lt.config defaults: ${apiMode}`);
    } else if (noConfirm) {
      apiMode = 'Rest';
      info('Using default API mode: REST/RPC (noConfirm mode)');
    } else {
      const apiModeChoice = await ask({
        choices: [
          'Rest - REST/RPC API with Swagger documentation (recommended)',
          'GraphQL - GraphQL API with subscriptions',
          'Both - REST and GraphQL in parallel (hybrid)',
        ],
        initial: 0,
        message: 'API mode?',
        name: 'apiMode',
        type: 'select',
      });
      apiMode = apiModeChoice.apiMode.split(' - ')[0] as 'Both' | 'GraphQL' | 'Rest';
    }

    // Resolve framework mode.
    let frameworkMode: 'npm' | 'vendor';
    if (experimental) {
      frameworkMode = 'npm';
    } else if (cliFrameworkMode === 'npm' || cliFrameworkMode === 'vendor') {
      frameworkMode = cliFrameworkMode;
    } else if (cliFrameworkMode) {
      error(`Invalid --framework-mode value "${cliFrameworkMode}". Use "npm" or "vendor".`);
      return;
    } else if (configFrameworkMode === 'npm' || configFrameworkMode === 'vendor') {
      frameworkMode = configFrameworkMode;
      info(`Using framework mode from lt.config: ${frameworkMode}`);
    } else if (noConfirm) {
      frameworkMode = 'npm';
    } else {
      const frameworkModeChoice = await ask({
        choices: [
          'npm    - @lenne.tech/nest-server as npm dependency (classic, stable)',
          'vendor - framework core vendored into projects/api/src/core/ (pilot, allows local patches)',
        ],
        initial: 0,
        message: 'Framework consumption mode?',
        name: 'frameworkMode',
        type: 'select',
      });
      frameworkMode = frameworkModeChoice.frameworkMode.startsWith('vendor') ? 'vendor' : 'npm';
    }

    const frameworkUpstreamBranch =
      typeof cliFrameworkUpstreamBranch === 'string' && cliFrameworkUpstreamBranch.length > 0
        ? cliFrameworkUpstreamBranch
        : undefined;

    const apiBranch = cliApiBranch || configApiBranch;
    const apiCopy = cliApiCopy || configApiCopy;
    const apiLink = cliApiLink || configApiLink;

    // Derive a project name. We use the workspace directory's basename
    // as a reasonable default; the user can override via --name. This
    // matches the project slug `init.ts` would have written into
    // package.json during the original workspace creation.
    const cliName = (parameters.options.name as string | undefined) || (parameters.first as string | undefined);
    let name = cliName;
    if (!name) {
      // Try to read from existing projects/app/package.json
      const appPkgPath = filesystem.path(workspaceDir, 'projects', 'app', 'package.json');
      if (filesystem.exists(appPkgPath)) {
        const appPkg = filesystem.read(appPkgPath, 'json') as null | Record<string, unknown>;
        if (appPkg && typeof appPkg.name === 'string' && appPkg.name && appPkg.name !== 'app') {
          name = appPkg.name;
        }
      }
    }
    if (!name) {
      // Fall back to the directory basename so we never block on this.
      const segments = filesystem.path(workspaceDir).split(/[\\/]/).filter(Boolean);
      name = segments[segments.length - 1] || 'fullstack-app';
    }

    const projectDir = workspaceDir === '.' ? filesystem.cwd().split(/[\\/]/).filter(Boolean).pop() || name : name;

    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  workspaceDir:               ${workspaceDir}`);
      info(`  name:                       ${name}`);
      info(`  apiMode:                    ${apiMode}`);
      info(`  frameworkMode:              ${frameworkMode}`);
      if (frameworkUpstreamBranch) {
        info(`  frameworkUpstreamBranch:    ${frameworkUpstreamBranch}`);
      }
      info(`  apiBranch:                  ${apiBranch || '(default)'}`);
      info(`  apiCopy:                    ${apiCopy || '(none)'}`);
      info(`  apiLink:                    ${apiLink || '(none)'}`);
      info(`  experimental (--next):      ${experimental}`);
      info('');
      info('Would execute:');
      if (experimental) {
        info(`  1. clone nest-base → ${workspaceDir}/projects/api`);
        info(`  2. patch package.json + bun run rename ${projectDir}`);
      } else if (frameworkMode === 'vendor') {
        info(`  1. clone nest-server-starter → ${workspaceDir}/projects/api`);
        info(
          `  2. clone @lenne.tech/nest-server${frameworkUpstreamBranch ? ` (${frameworkUpstreamBranch})` : ''} → /tmp`,
        );
        info(`  3. vendor core/ + flatten-fix + codemod consumer imports`);
        info(`  4. merge upstream deps`);
        info(`  5. run processApiMode(${apiMode})`);
        if (apiMode === 'Rest') info(`  6. restore vendored core essentials (graphql-*)`);
      } else {
        info(`  1. clone nest-server-starter → ${workspaceDir}/projects/api`);
        info(`  2. run processApiMode(${apiMode})`);
      }
      info(`  N. write projects/api/lt.config.json + hoist pnpm overrides`);
      if (!skipInstall) info(`  M. pnpm install + format projects/api`);
      info('');
      return `fullstack add-api dry-run (${frameworkMode} / ${apiMode})`;
    }

    // Actually integrate the API.
    const apiDest = `${workspaceDir}/projects/api`;
    const apiSpinner = spin(
      `Integrate API${apiLink ? ' (link)' : apiCopy ? ' (copy)' : apiBranch ? ` (branch: ${apiBranch})` : ''}`,
    );

    const apiResult = await server.setupServerForFullstack(apiDest, {
      apiMode,
      branch: apiBranch,
      copyPath: apiCopy,
      experimental,
      frameworkMode,
      frameworkUpstreamBranch,
      linkPath: apiLink,
      name,
      projectDir,
    });

    if (!apiResult.success) {
      apiSpinner.fail(`Failed to set up API: ${apiResult.path}`);
      return;
    }
    apiSpinner.succeed(`API integrated (${apiResult.method})`);

    // For the experimental nest-base template, run the rename script so
    // the four files that reference `nest-base` are aligned with the
    // workspace name. Non-fatal on failure.
    if (experimental && apiResult.method !== 'link') {
      const renameSpinner = spin(`Rename nest-base → ${projectDir}`);
      const renameResult = await runExperimentalNestBaseRename({
        apiDir: apiDest,
        patching,
        projectDir,
        system,
      });
      if (renameResult.error) {
        renameSpinner.warn(
          `Auto-rename failed (${renameResult.error.message}). Run \`bun run rename ${projectDir}\` manually inside projects/api.`,
        );
      } else {
        renameSpinner.succeed(`Renamed nest-base → ${projectDir} in projects/api`);
      }
    }

    // Persist apiMode + frameworkMode for downstream generators.
    if (apiResult.method !== 'link') {
      writeApiConfig({ apiDir: apiDest, apiMode, filesystem, frameworkMode });
    }

    // Hoist pnpm config — `setupServerForFullstack` may have produced a
    // sub-project package.json with `pnpm.overrides` etc. that pnpm
    // ignores at non-root level.
    hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: workspaceDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    // Run install + format unless explicitly skipped (CI/agents may
    // want to chain multiple add-* calls before installing once).
    if (!skipInstall && !experimental) {
      const installSpinner = spin('Install workspace packages');
      try {
        const detectedPm = toolbox.pm.detect(workspaceDir);
        await system.run(`cd ${workspaceDir} && ${toolbox.pm.install(detectedPm)}`);
        installSpinner.succeed('Successfully installed workspace packages');
      } catch (err) {
        installSpinner.fail(`Failed to install packages: ${(err as Error).message}`);
        warning('Run install manually after fixing the issue.');
      }

      // processApiMode rewrites source files, leaving whitespace
      // artifacts that oxfmt flags in `pnpm run format:check`. Format
      // here so the sub-project lands in a clean state.
      if (filesystem.isDirectory(apiDest)) {
        await toolbox.apiMode.formatProject(apiDest);
      }
    } else if (experimental) {
      info('Skipping workspace install — run `bun install` inside projects/api manually.');
    }

    info('');
    success(`API integrated into ${workspaceDir} in ${toolbox.helper.msToMinutesAndSeconds(timer())}m.`);
    info('');
    info('Next:');
    if (experimental) {
      info(`  $ cd ${workspaceDir}/projects/api && bun install`);
      info(`  Configure projects/api/.env (see .env.example)`);
      info(`  Start Postgres + run prisma generate / migrate`);
    } else {
      info(`  $ cd ${workspaceDir}`);
      info(`  $ ${toolbox.pm.run('start')}`);
    }
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `added api to workspace ${workspaceDir}`;
  },
};

export default NewCommand;
