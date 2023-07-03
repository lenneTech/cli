import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  name: 'init',
  alias: ['init'],
  description: 'Creates a new fullstack workspace',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { confirm, ask },
      strings: { kebabCase },
      system,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new fullstack workspace');

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
      info(``);
      error(`There's already a folder named "${projectDir}" here.`);
      return undefined;
    }

    let frontend = (
      await ask({
        type: 'input',
        name: 'frontend',
        message: 'Angular (a) or Nuxt 3 (n)',
      })
    ).frontend;

    if (frontend === 'a') {
      frontend = 'angular';
    } else if (frontend === 'n') {
      frontend = 'nuxt';
    } else {
      process.exit();
    }

    let addToGit = false;
    let gitLink;
    if (parameters.third !== 'false') {
      addToGit = parameters.third === 'true' || (await confirm(`Add workspace to a new git repository?`));

      // Check if git init is active
      if (addToGit) {
        // Get name of the app
        gitLink = await helper.getInput(null, {
          name: 'git repository link',
          showError: true,
        });
        if (!gitLink) {
          addToGit = false;
        }
      }
    }

    const workspaceSpinner = spin(`Create fullstack workspace with ${frontend} in ${projectDir} with ${name} app`);

    // Clone monorepo
    await system.run(`git clone https://github.com/lenneTech/lt-monorepo.git ${projectDir}`);

    // Check for directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }

    workspaceSpinner.succeed(`Create fullstack workspace with ${frontend} in ${projectDir} for ${name} created`);

    // Include example app
    const ngBaseSpinner = spin(`Integrate example for ${frontend}`);

    // Remove git folder after clone
    await system.run(`cd ${projectDir} && rm -rf .git`);

    // Check if git init is active
    if (addToGit) {
      await system.run(`cd ${projectDir} && git init --initial-branch=dev`);
      await system.run(`cd ${projectDir} && git remote add origin ${gitLink}`);
      await system.run(`cd ${projectDir} && git add .`);
      await system.run(`cd ${projectDir} && git commit -m "Initial commit"`);
      await system.run(`cd ${projectDir} && git push -u origin dev`);
    }

    if (frontend === 'angular') {
      // Clone ng-base-starter
      await system.run(`cd ${projectDir}/projects && git clone https://github.com/lenneTech/ng-base-starter.git app`);
    } else {
      await system.run(`cd ${projectDir}/projects && npx create-nuxt-base app`);
    }

    // Remove gitkeep file
    await system.run(`cd ${projectDir}/projects && rm .gitkeep`);

    // Remove git folder after clone
    await system.run(`cd ${projectDir}/projects/app && rm -rf .git`);

    // Integrate files
    if (filesystem.isDirectory(`./${projectDir}/projects/app`)) {
      // Check if git init is active
      if (addToGit) {
        // Commit changes
        await system.run(
          `cd ${projectDir} && git add . && git commit -am "feat: ${frontend} example integrated" && git push`
        );
      }

      // Angular example integration done
      ngBaseSpinner.succeed(`Example for ${frontend} integrated`);

      // Include files from https://github.com/lenneTech/nest-server-starter

      // Init
      const serverSpinner = spin(`Integrate Nest Server Starter`);

      // Clone api
      await system.run(`cd ${projectDir}/projects && git clone https://github.com/lenneTech/nest-server-starter api`);

      // Integrate files
      if (filesystem.isDirectory(`./${projectDir}/projects/api`)) {
        // Remove git folder from clone
        await system.run(`cd ${projectDir}/projects/api && rm -rf .git`);

        // Prepare meta.json in api
        filesystem.write(`./${projectDir}/projects/api/src/meta.json`, {
          name: `${name}-api-server`,
          description: `API for ${name} app`,
          version: '0.0.0',
        });

        // Check if git init is active
        if (addToGit) {
          // Commit changes
          await system.run(
            `cd ${projectDir} && git add . && git commit -am "feat: Nest Server Starter integrated" && git push`
          );
        }

        // Done
        serverSpinner.succeed('Nest Server Starter integrated');
      } else {
        serverSpinner.warn('Nest Server Starter not integrated');
      }

      // Install all packages
      const installSpinner = spin('Install all packages');
      await system.run(`cd ${projectDir} && npm i && npm run init`);
      installSpinner.succeed('Successfull installed all packages');

      // We're done, so show what to do next
      info(``);
      success(
        `Generated fullstack workspace with ${frontend} in ${projectDir} with ${name} app in ${helper.msToMinutesAndSeconds(
          timer()
        )}m.`
      );
      info(``);
      info(`Next:`);
      info(`  Run ${name}`);
      info(`  $ cd ${projectDir}`);
      info(`  $ npm run start`);
      info(``);

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }

      // For tests
      return `new workspace ${projectDir} with ${name}`;
    }
  },
};

export default NewCommand;
