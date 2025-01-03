import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  alias: ['c'],
  description: 'Creates a new angular workspace',
  hidden: false,
  name: 'create',
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
    info('Create a new Angular (fullstack) workspace');

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
        name: 'link to an empty repository (e.g. git@gitlab.lenne.tech:group/project.git or leave empty for no linking)',
        showError: false,
      })
    ).trim();

    const workspaceSpinner = spin(`Create workspace ${projectDir} with ${name} app`);

    // Clone monorepo
    await system.run(`git clone https://github.com/lenneTech/lt-monorepo.git ${projectDir}`);

    // Check for directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }

    // Remove git folder after clone
    filesystem.remove(`${projectDir}/.git`);

    // Set project name
    filesystem.write(`${projectDir}/lt.json`, JSON.stringify({ name }));
    await patching.update(`${projectDir}/package.json`, (data: Record<string, any>) => {
      data.name = kebabCase(name);
      data.version = '0.0.0';
      return data;
    });

    // Install packages
    await system.run(`cd ${projectDir} && npm i`);

    // Check if git init is active
    await system.run(`cd ${projectDir} && git init --initial-branch=main`);
    if (gitLink) {
      await system.run(`cd ${projectDir} && git remote add origin ${gitLink}`);
      await system.run(`cd ${projectDir} && git add .`);
      await system.run(`cd ${projectDir} && git commit -m "Initial commit"`);
      await system.run(`cd ${projectDir} && git push -u origin main`);
    }

    workspaceSpinner.succeed(`Create workspace ${projectDir} for ${name} created`);

    // Include example app
    const ngBaseSpinner = spin('Integrate example for Angular');

    // Remove gitkeep file
    filesystem.remove(`${projectDir}/projects/.gitkeep`);

    // Clone ng-base-starter
    await system.run(`cd ${projectDir}/projects && git clone https://github.com/lenneTech/ng-base-starter.git app`);

    if (filesystem.isDirectory(`./${projectDir}/projects/app`)) {
      // Remove git folder after clone
      filesystem.remove(`${projectDir}/projects/app/.git`);

      // Remove husky from app project
      filesystem.remove(`${projectDir}/projects/app/.husky`);
      await patching.update(`${projectDir}/projects/app/package.json`, (data: Record<string, any>) => {
        delete data.scripts.prepare;
        delete data.devDependencies.husky;
        return data;
      });

      if (localize) {
        await system.run(`cd ${projectDir}/projects/app && ng add @angular/localize --skip-confirmation`);
      }

      // Commit changes
      await system.run(`cd ${projectDir} && git add . && git commit -am "feat: Angular example integrated"`);

      // Check if git init is active
      if (gitLink) {
        `cd ${projectDir} && git push`;
      }

      // Angular example integration done
      ngBaseSpinner.succeed('Example for Angular integrated');


      // Install all packages
      const installSpinner = spin('Install all packages');
      await system.run(`cd ${projectDir} && npm run init`);

      // Commit changes
      await system.run(`cd ${projectDir} && git add . && git commit -am "feat: Initialization of workspace done"`);

      // Check if git init is active
      if (gitLink) {
        `cd ${projectDir} && git push`;
      }

      installSpinner.succeed('Successfully installed all packages');

      // We're done, so show what to do next
      info('');
      success(`Generated workspace ${projectDir} with ${name} app in ${helper.msToMinutesAndSeconds(timer())}m.`);
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
