import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { hoistWorkspacePnpmConfig } from '../../lib/hoist-workspace-pnpm-config';
import { detectWorkspaceLayout, findWorkspaceRoot } from '../../lib/workspace-integration';

/**
 * Add a frontend app (`projects/app/`) to a fullstack workspace that
 * currently only ships an API (`projects/api/`). Mirrors every
 * frontend-related flag from `lt fullstack init` so the surface area
 * stays in lockstep.
 *
 * Refuses to run if `projects/app/` already exists.
 */
const NewCommand: GluegunCommand = {
  alias: ['add-app'],
  description: 'Add app to fullstack workspace',
  hidden: false,
  name: 'add-app',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      frontendHelper,
      git,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { ask },
      system,
    } = toolbox;

    if (
      toolbox.tools.helpJson({
        aliases: ['add-app'],
        configuration: 'commands.fullstack.*',
        description: 'Add a frontend app to an existing fullstack workspace',
        name: 'add-app',
        options: [
          { description: 'Frontend framework', flag: '--frontend', type: 'string', values: ['nuxt', 'angular'] },
          {
            description: 'Frontend framework consumption mode',
            flag: '--frontend-framework-mode',
            type: 'string',
            values: ['npm', 'vendor'],
          },
          { description: 'Branch of the frontend starter to clone', flag: '--frontend-branch', type: 'string' },
          { description: 'Path to local frontend template to copy from', flag: '--frontend-copy', type: 'string' },
          { description: 'Path to local frontend template to symlink', flag: '--frontend-link', type: 'string' },
          { description: 'Use experimental nuxt-base-starter `next` branch', flag: '--next', type: 'boolean' },
          { description: 'Workspace root (defaults to cwd)', flag: '--workspace-dir', type: 'string' },
          { description: 'Skip install / format after app integration', flag: '--skip-install', type: 'boolean' },
          { description: 'Print resolved plan and exit without disk changes', flag: '--dry-run', type: 'boolean' },
          { description: 'Skip all interactive prompts', flag: '--noConfirm', type: 'boolean' },
        ],
      })
    ) {
      return;
    }

    const timer = system.startTimer();
    info('Add app to fullstack workspace');
    toolbox.tools.nonInteractiveHint(
      'lt fullstack add-app --frontend <nuxt|angular> [--frontend-branch <ref>] [--next] [--dry-run] --noConfirm',
    );

    if (!(await git.gitInstalled())) {
      return;
    }

    const ltConfig = config.loadConfig();

    const cliFrontend = parameters.options.frontend;
    const cliFrontendFrameworkMode = parameters.options['frontend-framework-mode'] as 'npm' | 'vendor' | undefined;
    const cliFrontendBranch = parameters.options['frontend-branch'] as string | undefined;
    const cliFrontendCopy = parameters.options['frontend-copy'] as string | undefined;
    const cliFrontendLink = parameters.options['frontend-link'] as string | undefined;
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

    const configFrontend = ltConfig?.commands?.fullstack?.frontend;
    const configFrontendFrameworkMode = ltConfig?.commands?.fullstack?.frontendFrameworkMode as
      | 'npm'
      | 'vendor'
      | undefined;
    const configFrontendBranch = ltConfig?.commands?.fullstack?.frontendBranch;
    const configFrontendCopy = ltConfig?.commands?.fullstack?.frontendCopy;
    const configFrontendLink = ltConfig?.commands?.fullstack?.frontendLink;

    // Workspace detection — same priority as `add-api`:
    //   1. explicit `--workspace-dir <path>` always wins
    //   2. cwd if it itself is a workspace
    //   3. nearest workspace by walking up from cwd (so users running
    //      from inside `projects/api/src/` don't have to pass
    //      `--workspace-dir ../..`)
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
    if (layout.hasApp) {
      error(
        `An app already exists at "${workspaceDir}/projects/app". Remove it first or use \`lt fullstack init\` in a fresh directory.`,
      );
      return;
    }

    // Resolve frontend.
    let frontend: 'angular' | 'nuxt' | undefined;
    if (cliFrontend === 'angular' || cliFrontend === 'nuxt') {
      frontend = cliFrontend;
    } else if (cliFrontend) {
      error('Invalid --frontend option. Use "angular" or "nuxt".');
      return;
    } else if (configFrontend === 'angular' || configFrontend === 'nuxt') {
      frontend = configFrontend;
      info(`Using frontend from lt.config: ${frontend}`);
    } else if (noConfirm) {
      frontend = 'nuxt';
      info('Using default frontend: nuxt (noConfirm mode)');
    } else {
      const choice = await ask({
        choices: ['angular', 'nuxt'],
        initial: 1,
        message: 'Which frontend framework?',
        name: 'frontend',
        type: 'select',
      });
      frontend = (choice.frontend === 'angular' ? 'angular' : 'nuxt') as 'angular' | 'nuxt';
    }

    // Resolve frontend framework mode.
    let frontendFrameworkMode: 'npm' | 'vendor';
    if (cliFrontendFrameworkMode === 'npm' || cliFrontendFrameworkMode === 'vendor') {
      frontendFrameworkMode = cliFrontendFrameworkMode;
    } else if (cliFrontendFrameworkMode) {
      error(`Invalid --frontend-framework-mode value "${cliFrontendFrameworkMode}". Use "npm" or "vendor".`);
      return;
    } else if (configFrontendFrameworkMode === 'npm' || configFrontendFrameworkMode === 'vendor') {
      frontendFrameworkMode = configFrontendFrameworkMode;
      info(`Using frontend framework mode from lt.config: ${frontendFrameworkMode}`);
    } else {
      frontendFrameworkMode = 'npm';
    }

    // Branch / copy / link with the same `--next` default that init.ts
    // applies: under `--next`, default the nuxt-base-starter ref to the
    // `next` branch (auth basePath aligned with the experimental API).
    const frontendBranch =
      cliFrontendBranch || configFrontendBranch || (experimental && frontend === 'nuxt' ? 'next' : undefined);
    const frontendCopy = cliFrontendCopy || configFrontendCopy;
    const frontendLink = cliFrontendLink || configFrontendLink;

    // Derive a project name (kebab-case workspace slug) for env patching.
    let projectName = parameters.options.name as string | undefined;
    if (!projectName) {
      const apiPkgPath = filesystem.path(workspaceDir, 'projects', 'api', 'package.json');
      if (filesystem.exists(apiPkgPath)) {
        const apiPkg = filesystem.read(apiPkgPath, 'json') as null | Record<string, unknown>;
        if (apiPkg && typeof apiPkg.name === 'string' && apiPkg.name) {
          projectName = apiPkg.name;
        }
      }
    }
    if (!projectName) {
      const segments = filesystem.path(workspaceDir).split(/[\\/]/).filter(Boolean);
      projectName = segments[segments.length - 1] || 'fullstack-app';
    }

    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  workspaceDir:               ${workspaceDir}`);
      info(`  projectName:                ${projectName}`);
      info(`  frontend:                   ${frontend}`);
      info(`  frontendFrameworkMode:      ${frontendFrameworkMode}`);
      info(`  frontendBranch:             ${frontendBranch || '(default)'}`);
      info(`  frontendCopy:               ${frontendCopy || '(none)'}`);
      info(`  frontendLink:               ${frontendLink || '(none)'}`);
      info(`  experimental (--next):      ${experimental}`);
      info('');
      info('Would execute:');
      info(`  1. setup ${frontend} → ${workspaceDir}/projects/app`);
      if (frontend === 'nuxt' && frontendFrameworkMode === 'vendor') {
        info(`  2. clone @lenne.tech/nuxt-extensions → /tmp`);
        info(`  3. vendor app/core/ (module.ts + runtime/)`);
        info(`  4. rewrite nuxt.config.ts module entry`);
      }
      info(`  N. patch projects/app/.env with NUXT_PUBLIC_STORAGE_PREFIX`);
      if (!skipInstall) info(`  M. pnpm install + format projects/app`);
      info('');
      return `fullstack add-app dry-run (${frontend} / ${frontendFrameworkMode})`;
    }

    const appDest = `${workspaceDir}/projects/app`;
    const appSpinner = spin(
      `Integrate ${frontend}${frontendLink ? ' (link)' : frontendCopy ? ' (copy)' : frontendBranch ? ` (branch: ${frontendBranch})` : ''}`,
    );

    const isNuxt = frontend === 'nuxt';
    const result = isNuxt
      ? await frontendHelper.setupNuxt(appDest, {
          branch: frontendBranch,
          copyPath: frontendCopy,
          linkPath: frontendLink,
          skipInstall: true,
        })
      : await frontendHelper.setupAngular(appDest, {
          branch: frontendBranch,
          copyPath: frontendCopy,
          linkPath: frontendLink,
          skipGitInit: true,
          skipHuskyRemoval: true,
          skipInstall: true,
        });

    if (!result.success) {
      appSpinner.fail(`Failed to set up ${frontend} frontend: ${result.path}`);
      return;
    }
    appSpinner.succeed(`${frontend} integrated (${result.method})`);

    // Patch frontend .env (skip on link mode — points at user's checkout).
    if (result.method !== 'link') {
      frontendHelper.patchFrontendEnv(appDest, projectName);
    }

    // Vendor frontend if requested. Skipped on link mode for the same
    // reason as `init.ts`.
    if (isNuxt && frontendFrameworkMode === 'vendor' && result.method !== 'link') {
      const vendorSpinner = spin('Converting frontend to vendor mode...');
      try {
        await frontendHelper.convertAppCloneToVendored({
          dest: appDest,
          projectName,
        });
        vendorSpinner.succeed('Frontend converted to vendor mode (app/core/)');
      } catch (err) {
        vendorSpinner.fail(`Frontend vendor conversion failed: ${(err as Error).message}`);
        warning('Continuing with npm mode for frontend.');
      }
    }

    // Hoist pnpm config (frontend templates may carry pnpm.overrides too).
    hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: workspaceDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    if (!skipInstall) {
      const installSpinner = spin('Install workspace packages');
      try {
        const detectedPm = toolbox.pm.detect(workspaceDir);
        await system.run(`cd ${workspaceDir} && ${toolbox.pm.install(detectedPm)}`);
        installSpinner.succeed('Successfully installed workspace packages');
      } catch (err) {
        installSpinner.fail(`Failed to install packages: ${(err as Error).message}`);
        warning('Run install manually after fixing the issue.');
      }

      if (isNuxt && filesystem.isDirectory(appDest)) {
        await toolbox.apiMode.formatProject(appDest);
      }
    }

    info('');
    success(`App integrated into ${workspaceDir} in ${toolbox.helper.msToMinutesAndSeconds(timer())}m.`);
    info('');
    info('Next:');
    info(`  $ cd ${workspaceDir}`);
    info(`  $ ${toolbox.pm.run('start')}`);
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `added app to workspace ${workspaceDir}`;
  },
};

export default NewCommand;
