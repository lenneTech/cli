import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { runStandaloneWorkspaceGate } from '../../lib/workspace-integration';

/**
 * Create a new nuxt workspace
 *
 * Standalone counterpart to `lt fullstack init` / `lt fullstack add-app`
 * for Nuxt: clones nuxt-base-starter (or invokes create-nuxt-base) into
 * a brand-new directory. Mirrors the same surface area as add-app where
 * applicable so behaviour is consistent across the four flows.
 */
const NewCommand: GluegunCommand = {
  alias: ['n'],
  description: 'Creates a new nuxt workspace',
  hidden: false,
  name: 'nuxt',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      frontendHelper,
      helper,
      parameters,
      print: { error, info, spin },
      prompt: { ask, confirm },
      strings: { kebabCase },
      system,
    } = toolbox;

    if (
      toolbox.tools.helpJson({
        aliases: ['n'],
        configuration: 'commands.frontend.nuxt.*',
        description: 'Create a new Nuxt workspace from nuxt-base-starter',
        name: 'nuxt',
        options: [
          { description: 'Workspace name', flag: '--name', required: false, type: 'string' },
          { description: 'Branch of nuxt-base-starter to clone', flag: '--branch', required: false, type: 'string' },
          { description: 'Copy from local template directory', flag: '--copy', required: false, type: 'string' },
          { description: 'Symlink to local template directory', flag: '--link', required: false, type: 'string' },
          {
            description: 'Frontend framework consumption mode',
            flag: '--frontend-framework-mode',
            required: false,
            type: 'string',
            values: ['npm', 'vendor'],
          },
          {
            default: false,
            description:
              'Default branch to nuxt-base-starter#next (auth basePath aligned with experimental --next API)',
            flag: '--next',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Print resolved plan and exit without making any changes',
            flag: '--dry-run',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Override the workspace-detection abort under --noConfirm',
            flag: '--force',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Skip all interactive prompts',
            flag: '--noConfirm',
            required: false,
            type: 'boolean',
          },
        ],
      })
    ) {
      return;
    }

    // Load configuration. Nuxt-specific keys live under
    // `commands.frontend.nuxt.*`; vendoring + experimental fall back to
    // the shared `commands.fullstack.*` block so a project's lt.config
    // does not have to repeat them.
    const ltConfig = config.loadConfig();
    const configBranch = ltConfig?.commands?.frontend?.nuxt?.branch;
    const configCopy = ltConfig?.commands?.frontend?.nuxt?.copy;
    const configLink = ltConfig?.commands?.frontend?.nuxt?.link;
    const configFrontendFrameworkMode = ltConfig?.commands?.fullstack?.frontendFrameworkMode as
      | 'npm'
      | 'vendor'
      | undefined;

    // Parse CLI arguments
    const cliBranch = parameters.options.branch || parameters.options.b;
    const cliCopy = parameters.options.copy || parameters.options.c;
    const cliLink = parameters.options.link;
    const cliName = parameters.options.name as string | undefined;
    const cliFrontendFrameworkMode = parameters.options['frontend-framework-mode'] as 'npm' | 'vendor' | undefined;
    const cliDryRun = parameters.options['dry-run'];
    const cliForce = parameters.options.force;
    const experimental = parameters.options.next === true || parameters.options.next === 'true';
    const dryRun = cliDryRun === true || cliDryRun === 'true';
    const force = cliForce === true || cliForce === 'true';

    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.frontend?.nuxt as undefined | { noConfirm?: boolean },
      config: ltConfig,
    });

    // Workspace-awareness — bundled into runStandaloneWorkspaceGate.
    const proceed = await runStandaloneWorkspaceGate({
      cwd: '.',
      filesystem,
      force,
      fromGluegunMenu: Boolean(toolbox.parameters.options.fromGluegunMenu),
      noConfirmFlag: noConfirm,
      pieceName: 'app',
      print: { confirm, error, info },
      projectKind: 'Nuxt app',
      suggestion: 'lt fullstack add-app --frontend nuxt',
    });
    if (!proceed) return;

    // Resolve branch / copy / link with priority: CLI > config.
    // Under `--next`, default to nuxt-base-starter#next so the cloned
    // template ships an auth basePath aligned with the experimental
    // nest-base API — same default as `lt fullstack init --next` and
    // `lt fullstack add-app --next`.
    const branch = cliBranch || configBranch || (experimental ? 'next' : undefined);
    const copyPath = cliCopy || configCopy;
    const linkPath = cliLink || configLink;

    // Resolve frontend framework mode (npm vs vendored nuxt-extensions).
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

    // Resolve workspace name with priority: --name > positional > interactive.
    let projName: string | undefined = cliName;
    if (!projName) {
      if (noConfirm) {
        // Without an explicit name, refuse rather than guess. Matches
        // the safety stance taken by `fullstack init` under noConfirm.
        error('Missing workspace name. Pass --name <slug> when using --noConfirm.');
        return;
      }
      projName = (
        await ask({
          message: "What is the project's name?",
          name: 'projectName',
          required: true,
          type: 'input',
        })
      ).projectName;
    }

    if (!projName) {
      return;
    }

    const projectDir = kebabCase(projName);

    if (filesystem.exists(projectDir)) {
      info('');
      error(`There's already a folder named "${projectDir}" here.`);
      return;
    }

    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  name:                       ${projName}`);
      info(`  projectDir:                 ${projectDir}`);
      info(`  branch:                     ${branch || '(default — uses create-nuxt-base)'}`);
      info(`  copy:                       ${copyPath || '(none)'}`);
      info(`  link:                       ${linkPath || '(none)'}`);
      info(`  frontendFrameworkMode:      ${frontendFrameworkMode}`);
      info(`  experimental (--next):      ${experimental}`);
      info('');
      info('Would execute:');
      if (linkPath) {
        info(`  1. symlink ${linkPath} → ./${projectDir}`);
      } else if (copyPath) {
        info(`  1. copy ${copyPath} → ./${projectDir}`);
      } else if (branch) {
        info(`  1. clone nuxt-base-starter (branch: ${branch}) → ./${projectDir}`);
      } else {
        info(`  1. exec create-nuxt-base@latest → ./${projectDir}`);
      }
      if (frontendFrameworkMode === 'vendor') {
        info(`  2. clone @lenne.tech/nuxt-extensions → /tmp`);
        info(`  3. vendor app/core/ (module.ts + runtime/)`);
      }
      info('');
      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }
      return `dry-run nuxt workspace (${frontendFrameworkMode})`;
    }

    const timer = system.startTimer();

    const baseSpinner = spin(
      `Creating nuxt-base with name '${projectDir}'${linkPath ? ' (link)' : copyPath ? ' (copy)' : branch ? ` (branch: ${branch})` : ''}`,
    );

    // Use FrontendHelper for setup
    const result = await frontendHelper.setupNuxt(`./${projectDir}`, {
      branch,
      copyPath,
      linkPath,
      skipInstall: true, // Nuxt standalone doesn't need npm install (create-nuxt-base handles it)
    });

    if (!result.success) {
      baseSpinner.fail(`Failed to setup nuxt workspace: ${result.path}`);
      return;
    }

    baseSpinner.succeed(
      `Successfully created nuxt workspace with name '${projectDir}' in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );

    // Vendor the nuxt-extensions module if requested. Skipped for link
    // mode because the linked checkout is shared with the upstream
    // template and must not be mutated. Same guard as in init/add-app.
    if (frontendFrameworkMode === 'vendor' && result.method !== 'link') {
      const vendorSpinner = spin('Converting frontend to vendor mode...');
      try {
        await frontendHelper.convertAppCloneToVendored({
          dest: `./${projectDir}`,
          projectName: projectDir,
        });
        vendorSpinner.succeed('Frontend converted to vendor mode (app/core/)');
      } catch (err) {
        vendorSpinner.fail(`Frontend vendor conversion failed: ${(err as Error).message}`);
      }
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return `created nuxt workspace ${result.method === 'link' ? 'symlink ' : ''}${projectDir}`;
  },
};

export default NewCommand;
