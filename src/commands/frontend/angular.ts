import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { runStandaloneWorkspaceGate } from '../../lib/workspace-integration';

/**
 * Create a new Angular workspace
 *
 * Standalone counterpart to `lt fullstack init` / `lt fullstack add-app`
 * for Angular: clones ng-base-starter into a brand-new directory.
 * Mirrors the same dry-run / workspace-detection surface as the Nuxt
 * sibling so behaviour is consistent across the four flows.
 */
const NewCommand: GluegunCommand = {
  alias: ['a'],
  description: 'Create Angular workspace',
  hidden: false,
  name: 'angular',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      filesystem,
      frontendHelper,
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { confirm },
      strings: { kebabCase },
      system,
    } = toolbox;

    if (
      toolbox.tools.helpJson({
        aliases: ['a'],
        configuration: 'commands.frontend.angular.*',
        description: 'Create a new Angular workspace from ng-base-starter',
        name: 'angular',
        options: [
          { description: 'Workspace name', flag: '--name', required: false, type: 'string' },
          { description: 'Branch of ng-base-starter to clone', flag: '--branch', required: false, type: 'string' },
          { description: 'Copy from local template directory', flag: '--copy', required: false, type: 'string' },
          { description: 'Symlink to local template directory', flag: '--link', required: false, type: 'string' },
          { description: 'Initialize Angular localize', flag: '--localize', required: false, type: 'boolean' },
          {
            description: 'Skip Angular localize initialisation',
            flag: '--noLocalize',
            required: false,
            type: 'boolean',
          },
          {
            description: 'Git remote URL to push initial commit to',
            flag: '--gitLink',
            required: false,
            type: 'string',
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

    // Load configuration
    const ltConfig = config.loadConfig();
    const configLocalize = ltConfig?.commands?.frontend?.angular?.localize;
    const configBranch = ltConfig?.commands?.frontend?.angular?.branch;
    const configCopy = ltConfig?.commands?.frontend?.angular?.copy;
    const configLink = ltConfig?.commands?.frontend?.angular?.link;

    // Parse CLI arguments
    const cliBranch = parameters.options.branch || parameters.options.b;
    const cliCopy = parameters.options.copy || parameters.options.c;
    const cliLink = parameters.options.link;
    const cliName = parameters.options.name as string | undefined;
    const cliDryRun = parameters.options['dry-run'];
    const cliForce = parameters.options.force;
    const dryRun = cliDryRun === true || cliDryRun === 'true';
    const force = cliForce === true || cliForce === 'true';

    // Determine branch and copy/link paths with priority: CLI > config
    const branch = cliBranch || configBranch;
    const copyPath = cliCopy || configCopy;
    const linkPath = cliLink || configLink;

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm || parameters.options.y,
      commandConfig: ltConfig?.commands?.frontend?.angular,
      config: ltConfig,
    });

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new Angular workspace');

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Workspace-awareness — bundled into runStandaloneWorkspaceGate.
    const proceed = await runStandaloneWorkspaceGate({
      cwd: '.',
      filesystem,
      force,
      fromGluegunMenu: Boolean(toolbox.parameters.options.fromGluegunMenu),
      noConfirmFlag: noConfirm,
      pieceName: 'app',
      print: { confirm, error, info },
      projectKind: 'Angular app',
      suggestion: 'lt fullstack add-app --frontend angular',
    });
    if (!proceed) return;

    // Get name of the workspace. Honour `--name` flag before falling
    // back to the first positional or interactive prompt — same fix
    // applied to `server create` in this iteration.
    const name =
      cliName ||
      (await helper.getInput(parameters.first, {
        name: 'workspace name',
        showError: true,
      }));
    if (!name) {
      return;
    }

    // Set project directory
    const projectDir = kebabCase(name);

    // Check if directory already exists
    if (filesystem.exists(projectDir)) {
      info('');
      error(`There's already a folder named "${projectDir}" here.`);
      return;
    }

    // Determine localize with priority: CLI > config > noConfirm > interactive
    let localize: boolean;
    if (parameters.second?.toLowerCase().includes('localize') || parameters.options.localize) {
      localize = true;
    } else if (parameters.options.noLocalize) {
      localize = false;
    } else if (configLocalize !== undefined) {
      localize = configLocalize;
      info(`Using localize from lt.config: ${localize}`);
    } else if (noConfirm) {
      localize = true; // Default to true when noConfirm is set
    } else {
      localize = await confirm('Init localize for Angular?', true);
    }

    // Determine gitLink with priority: CLI > interactive (skip if noConfirm)
    let gitLink = '';
    if (parameters.options.gitLink) {
      gitLink = parameters.options.gitLink.trim();
    } else if (!noConfirm) {
      gitLink = (
        await helper.getInput(null, {
          name: 'Provide the URL of an empty repository (e.g., git@example.com:group/project.git, or leave empty to skip linking)',
          showError: false,
        })
      ).trim();
    }

    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  name:                       ${name}`);
      info(`  projectDir:                 ${projectDir}`);
      info(`  branch:                     ${branch || '(default)'}`);
      info(`  copy:                       ${copyPath || '(none)'}`);
      info(`  link:                       ${linkPath || '(none)'}`);
      info(`  localize:                   ${localize}`);
      info(`  gitLink:                    ${gitLink || '(none)'}`);
      info('');
      info('Would execute:');
      if (linkPath) {
        info(`  1. symlink ${linkPath} → ./${projectDir}`);
      } else if (copyPath) {
        info(`  1. copy ${copyPath} → ./${projectDir}`);
      } else {
        info(`  1. clone ng-base-starter${branch ? ` (branch: ${branch})` : ''} → ./${projectDir}`);
      }
      info(`  2. pnpm install + git init + remove husky`);
      if (gitLink) info(`  3. push initial commit to ${gitLink}`);
      info('');
      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }
      return `dry-run angular workspace ${projectDir}`;
    }

    const workspaceSpinner = spin(
      `Creating angular workspace ${projectDir}${linkPath ? ' (link)' : copyPath ? ' (copy)' : branch ? ` (branch: ${branch})` : ''}...`,
    );

    // Use FrontendHelper for setup
    const result = await frontendHelper.setupAngular(`./${projectDir}`, {
      branch,
      copyPath,
      gitLink,
      linkPath,
      localize,
    });

    if (!result.success) {
      workspaceSpinner.fail(`Failed to set up workspace: ${result.path}`);
      return;
    }

    // Link mode: early return
    if (result.method === 'link') {
      workspaceSpinner.succeed(`Symlinked to: ${result.path}`);
      info('Note: Changes will affect the original template!');

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }
      return `created angular workspace symlink ${projectDir}`;
    }

    workspaceSpinner.succeed(`Workspace ${projectDir} created`);

    // We're done, so show what to do next
    info('');
    success(`Generated Angular workspace ${projectDir} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');
    info('Next:');
    info(`  Test and run ${name}:`);
    info(`  $ cd ${projectDir}`);
    info('  $ npm run test');
    info('  $ npm run start');
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new workspace ${projectDir} with ${name}`;
  },
};

export default NewCommand;
