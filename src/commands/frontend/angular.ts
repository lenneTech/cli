import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new Angular workspace
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

    // Get name of the workspace
    const name = await helper.getInput(parameters.first, {
      name: 'workspace name',
      showError: true,
    });
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

    const workspaceSpinner = spin(`Creating angular workspace ${projectDir}${linkPath ? ' (link)' : copyPath ? ' (copy)' : branch ? ` (branch: ${branch})` : ''}...`);

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
