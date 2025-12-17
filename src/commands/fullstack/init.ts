import { GluegunCommand, patching } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';


/**
 * Create a new fullstack workspace
 */
const NewCommand: GluegunCommand = {
  alias: ['init'],
  description: 'Create fullstack workspace',
  hidden: false,
  name: 'init',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      filesystem,
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      server,
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

    // Load configuration
    const ltConfig = config.loadConfig();
    const configFrontend = ltConfig?.commands?.fullstack?.frontend;
    const configGit = ltConfig?.commands?.fullstack?.git;
    const configGitLink = ltConfig?.commands?.fullstack?.gitLink;

    // Parse CLI arguments
    const { frontend: cliFrontend, git: cliGit, 'git-link': cliGitLink, name: cliName } = parameters.options;

    // Get name of the workspace
    const name = cliName || await helper.getInput(parameters.first, {
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

    // Determine frontend with priority: CLI > config > interactive
    let frontend: string | undefined;
    if (cliFrontend) {
      frontend = cliFrontend === 'angular' ? 'angular' : cliFrontend === 'nuxt' ? 'nuxt' : null;
      if (!frontend) {
        error('Invalid frontend option. Use "angular" or "nuxt".');
        return;
      }
    } else if (configFrontend) {
      frontend = configFrontend;
      info(`Using frontend from lt.config: ${frontend}`);
    } else {
      // Interactive mode with sensible default
      const choices = ['angular', 'nuxt'];
      frontend = (
        await ask({
          choices,
          initial: 1, // Default to nuxt
          message: 'Which frontend framework?',
          name: 'frontend',
          type: 'select',
        })
      ).frontend;

      if (!frontend) {
        return;
      }
    }

    // Determine git settings with priority: CLI > config > interactive
    let addToGit = false;
    let gitLink: string | undefined;

    if (cliGit !== undefined) {
      // CLI parameter provided
      addToGit = cliGit === 'true' || cliGit === true;
      if (addToGit) {
        gitLink = cliGitLink || configGitLink;
        if (!gitLink) {
          error('--git-link is required when --git is true (or configure gitLink in lt.config)');
          return;
        }
      }
    } else if (configGit !== undefined) {
      // Config value provided
      addToGit = configGit;
      if (addToGit) {
        gitLink = cliGitLink || configGitLink;
        if (!gitLink) {
          // Ask for git link interactively
          gitLink = await helper.getInput(null, {
            name: 'git repository link',
            showError: true,
          });
          if (!gitLink) {
            addToGit = false;
          }
        } else {
          info(`Using git configuration from lt.config`);
        }
      }
    } else if (parameters.third !== 'false') {
      // Interactive mode
      addToGit = parameters.third === 'true' || (await confirm('Add workspace to a new git repository?'));

      if (addToGit) {
        gitLink = configGitLink || await helper.getInput(null, {
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
    filesystem.remove(`${projectDir}/.git`);

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
      await system.run('npm i -g create-nuxt-base');
      await system.run(`cd ${projectDir}/projects && create-nuxt-base app`);
    }

    // Remove gitkeep file
    filesystem.remove(`${projectDir}/projects/.gitkeep`);

    // Remove git folder after clone
    filesystem.remove(`${projectDir}/projects/app/.git`);

    // Integrate files
    if (filesystem.isDirectory(`./${projectDir}/projects/app`)) {
      // Check if git init is active
      if (addToGit) {
        // Commit changes
        await system.run(
          `cd ${projectDir} && git add . && git commit -am "feat: ${frontend} example integrated" && git push`,
        );
      }

      // Angular example integration done
      ngBaseSpinner.succeed(`Example for ${frontend} integrated`);

      // Include files from https://github.com/lenneTech/nest-server-starter

      // Init
      const serverSpinner = spin('Integrate Nest Server Starter');

      // Clone api
      await system.run(`cd ${projectDir}/projects && git clone https://github.com/lenneTech/nest-server-starter api`);

      // Integrate files
      if (filesystem.isDirectory(`./${projectDir}/projects/api`)) {
        // Remove git folder from clone
        filesystem.remove(`${projectDir}/projects/api/.git`);

        // Prepare meta.json in api
        filesystem.write(`./${projectDir}/projects/api/src/meta.json`, {
          description: `API for ${name} app`,
          name: `${name}-api-server`,
          version: '0.0.0',
        });

        // Replace secret or private keys and remove `nest-server`
        await patching.update(`./${projectDir}/projects/api/src/config.env.ts`, content => server.replaceSecretOrPrivateKeys(content).replace(/nest-server-/g, `${projectDir
        }-`));

        // Check if git init is active
        if (addToGit) {
          // Commit changes
          await system.run(
            `cd ${projectDir} && git add . && git commit -am "feat: Nest Server Starter integrated" && git push`,
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
      info('');
      success(
        `Generated fullstack workspace with ${frontend} in ${projectDir} with ${name} app in ${helper.msToMinutesAndSeconds(
          timer(),
        )}m.`,
      );
      info('');
      info('Next:');
      info(`  Run ${name}`);
      info(`  $ cd ${projectDir}`);
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
