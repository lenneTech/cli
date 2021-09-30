import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  name: 'create',
  alias: ['c'],
  description: 'Creates a new angular (fullstack) workspace',
  hidden: false,
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

    // Check ng
    if (!system.which('nx') && (await confirm(`Install nx global?`))) {
      const nxSpinner = spin('Install nx global');
      await system.run(`npm i -g @nrwl/cli`);
      nxSpinner.succeed('nx global installed');
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

    // Get name of the app
    let appName = await helper.getInput(parameters.second, {
      name: 'app name',
      showError: true,
    });
    if (!appName) {
      appName = 'app';
    }

    // Set preset
    // See https://github.com/nrwl/nx/blob/4bcd25ec01d793ca59e0ebaf1578bae275b6821d/packages/create-nx-workspace/bin/create-nx-workspace.ts#L32
    const preset =
      parameters.third === 'true' || (!parameters.third && (await confirm(`Add API (Nest server)?`)))
        ? 'angular-nest'
        : 'angular';

    // Init Workspace
    // See https://github.com/nrwl/nx/blob/4bcd25ec01d793ca59e0ebaf1578bae275b6821d/packages/create-nx-workspace/bin/create-nx-workspace.ts#L163
    const workspaceSpinner = spin(`Create ${preset} workspace ${projectDir} with ${appName} app`);
    await system.run(
      `npx create-nx-workspace ${projectDir} --preset='${preset}' --appName='${appName}' --style='scss' --linter='eslint' --packageManager='npm' --nxCloud=false --cli="nx"`
    );
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }
    workspaceSpinner.succeed(`Create ${preset} workspace ${projectDir} for ${appName} created`);

    // Include example app
    const ngBaseSpinner = spin('Integrate example for Angular');

    // Install packages
    await system.run(`cd ${projectDir} && npm i @lenne.tech/ng-base`);

    // Extend ts config
    await patching.update(`./${projectDir}/tsconfig.base.json`, (config) => {
      config.compilerOptions.resolveJsonModule = true;
      config.compilerOptions.strictNullChecks = false;
      return config;
    });

    // Get src files
    await system.run(`cd ${projectDir} && git clone https://github.com/lenneTech/angular-example temp`);

    let dependencies = '';

    // Integrate files
    if (filesystem.isDirectory(`./${projectDir}/temp`)) {
      dependencies = filesystem.read(`./${projectDir}/temp/package.json`, 'json')?.dependencies;
      filesystem.remove(`./${projectDir}/apps/${appName}/src`);
      filesystem.copy(`./${projectDir}/temp/apps/example/src`, `./${projectDir}/apps/${appName}/src`, {
        overwrite: true,
      });

      // Remove temp files
      filesystem.remove(`./${projectDir}/temp`);

      // Commit changes
      await system.run(`cd ${projectDir} && git add . && git commit -am "Angular example integrated"`);

      // Angular example integration done
      ngBaseSpinner.succeed('Example for Angular integrated');

      // Include files from https://github.com/lenneTech/nest-server-starter
      if (preset === 'angular-nest') {
        // Init
        const serverSpinner = spin(`Integrate Nest Server Starter`);
        await system.run(`cd ${projectDir} && npm i @lenne.tech/nest-server`);
        await system.run(`cd ${projectDir} && git clone https://github.com/lenneTech/nest-server-starter temp`);

        // Integrate files
        if (filesystem.isDirectory(`./${projectDir}/temp`)) {
          filesystem.remove(`./${projectDir}/apps/api/src`);
          filesystem.copy(`./${projectDir}/temp/src`, `./${projectDir}/apps/api/src`, { overwrite: true });
          filesystem.write(`./${projectDir}/apps/api/src/meta.json`, {
            name: `${appName}-api-server`,
            description: `API for ${appName} app`,
            version: '0.0.0',
          });

          // Update proxy
          await patching.update(`./${projectDir}/apps/${appName}/proxy.conf.json`, (config) => {
            config['/api']['target'] = 'http://localhost:3000';
            return config;
          });

          // Extend ts config
          await patching.update(`./${projectDir}/apps/api/tsconfig.app.json`, (config) => {
            config.compilerOptions.resolveJsonModule = true;
            return config;
          });

          // Remove temp files
          filesystem.remove(`./${projectDir}/temp`);

          // Add scripts
          await patching.update(`./${projectDir}/package.json`, (config) => {
            config.scripts['start:app'] = 'npm start';
            config.scripts['start:server'] = 'nx serve api';
            config.scripts['e2e'] = `nx e2e ${appName}-e2e`;
            config.scripts['dependencies'] = dependencies;
            return config;
          });

          // Commit changes
          await system.run(`cd ${projectDir} && git add . && git commit -am "Nest Server Starter integrated"`);

          // Done
          serverSpinner.succeed('Nest Server Starter integrated');
        } else {
          serverSpinner.warn('Nest Server Starter not integrated');
        }
      }

      // We're done, so show what to do next
      info(``);
      success(
        `Generated ${preset} workspace ${projectDir} with ${appName} app in ${helper.msToMinutesAndSeconds(timer())}m.`
      );
      info(``);
      info(`Next:`);
      info(`  Run ${appName}`);
      info(`  $ cd ${projectDir}`);
      if (preset === 'angular-nest') {
        info(`  $ npm run start:server`);
        info(`  $ npm run start:app`);
      } else {
        info(`  $ npm start`);
      }
      info(``);
      info(`More infos about Nx and Angular: https://nx.dev/angular`);
      info(``);

      // For tests
      return `new workspace ${projectDir} with ${appName}`;
    }
  },
};

export default NewCommand;
