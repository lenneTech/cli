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
      git,
      helper,
      parameters,
      patching,
      print: { error, info, spin, success },
      prompt: { confirm },
      strings: { kebabCase },
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configLocalize = ltConfig?.commands?.frontend?.angular?.localize;

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

    const workspaceSpinner = spin(`Creating angular workspace ${projectDir}...`);

    // Clone monorepo
    try {
      await system.run(`git clone https://github.com/lenneTech/ng-base-starter ${projectDir}`);
    } catch (err) {
      workspaceSpinner.fail(`Failed to clone repository: ${err.message}`);
      return;
    }

    // Check for directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      workspaceSpinner.fail(`The directory '${projectDir}' was not created.`);
      return;
    }

    // Remove git folder after clone
    filesystem.remove(`${projectDir}/.git`);

    // Install packages
    try {
      await system.run(`cd ${projectDir} && npm i`);
    } catch (err) {
      workspaceSpinner.fail(`Failed to install npm packages: ${err.message}`);
      return;
    }

    // Check if git init is active
    const gitSpinner = spin('Initializing git...');
    try {
      await system.run(`cd ${projectDir} && git init --initial-branch=main`);
      gitSpinner.succeed('Successfully initialized Git');
      if (gitLink) {
        await system.run(`cd ${projectDir} && git remote add origin ${gitLink}`);
        await system.run(`cd ${projectDir} && git add .`);
        await system.run(`cd ${projectDir} && git commit -m "Initial commit"`);
        await system.run(`cd ${projectDir} && git push -u origin main`);
      }
    } catch (err) {
      gitSpinner.fail(`Failed to initialize git: ${err.message}`);
      return;
    }

    workspaceSpinner.succeed(`Workspace ${projectDir} created`);

    if (filesystem.isDirectory(`./${projectDir}`)) {

      // Remove husky from app project
      filesystem.remove(`${projectDir}/.husky`);
      await patching.update(`${projectDir}/package.json`, (data: Record<string, any>) => {
        delete data.scripts.prepare;
        delete data.devDependencies.husky;
        return data;
      });

      if (localize) {
        const localizeSpinner = spin('Adding localization for Angular...');
        try {
          await system.run(`cd ${projectDir} && ng add @angular/localize --skip-confirmation`);
          localizeSpinner.succeed('Added localization for Angular');
        } catch (err) {
          localizeSpinner.fail(`Failed to add localization: ${err.message}`);
        }
      }

      // Install all packages
      const installSpinner = spin('Install all packages');
      try {
        await system.run(`cd ${projectDir} && npm run init`);
        installSpinner.succeed('Successfully installed all packages');
      } catch (err) {
        installSpinner.fail(`Failed to install packages: ${err.message}`);
        return;
      }

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
    }
  },
};

export default NewCommand;
