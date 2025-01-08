import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new Angular workspace
 */
const NewCommand: GluegunCommand = {
  alias: ['a'],
  description: 'Creates a new Angular workspace',
  hidden: false,
  name: 'angular',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
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
      return undefined;
    }

    // Localize
    const localize
      = parameters.second?.toLowerCase().includes('localize')
      || (!parameters.second && (await confirm('Init localize for Angular?', true)));

    const gitLink = (
      await helper.getInput(null, {
        name: 'Provide the URL of an empty repository (e.g., git@example.com:group/project.git, or leave empty to skip linking)',
        showError: false,
      })
    ).trim();

    const workspaceSpinner = spin(`Creating angular workspace ${projectDir}...`);

    // Clone monorepo
    await system.run(`git clone https://github.com/lenneTech/ng-base-starter ${projectDir}`);

    // Check for directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory '${projectDir}' was not created.`);
      return undefined;
    }

    // Remove git folder after clone
    filesystem.remove(`${projectDir}/.git`);


    // Install packages
    await system.run(`cd ${projectDir} && npm i`);

    // Check if git init is active

    const gitSpinner = spin('Initializing git...');
    await system.run(`cd ${projectDir} && git init --initial-branch=main`);
    gitSpinner.succeed('Successfully initialized Git');
    if (gitLink) {
      await system.run(`cd ${projectDir} && git remote add origin ${gitLink}`);
      await system.run(`cd ${projectDir} && git add .`);
      await system.run(`cd ${projectDir} && git commit -m "Initial commit"`);
      await system.run(`cd ${projectDir} && git push -u origin main`);
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
        await system.run(`cd ${projectDir} && ng add @angular/localize --skip-confirmation`);
        localizeSpinner.succeed('Added localization for Angular');
      }

      // Install all packages
      const installSpinner = spin('Install all packages');
      await system.run(`cd ${projectDir} && npm run init`);
      installSpinner.succeed('Successfully installed all packages');

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
