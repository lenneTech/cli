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

    // Angular Universal
    const angularUniversal =
      parameters.second?.toLowerCase().includes('universal') ||
      (!parameters.second && (await confirm(`Add Angular Universal (SSR)?`, true)));

    // Nest-Server
    const nestServer =
      parameters.second?.toLowerCase().includes('nest') ||
      (!parameters.second && (await confirm(`Add API (Nest-Server)?`, true)));

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
    await system.run(`cd ${projectDir} && rm -rf .git`);

    // Set project name
    await filesystem.write(`${projectDir}/lt.json`, JSON.stringify({ name }));
    await patching.update(`${projectDir}/package.json`, (data: Record<string, any>) => {
      data.name = kebabCase(name);
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
    await system.run(`cd ${projectDir}/projects && rm .gitkeep`);

    // Clone ng-base-starter
    await system.run(`cd ${projectDir}/projects && git clone https://github.com/lenneTech/ng-base-starter.git app`);

    if (filesystem.isDirectory(`./${projectDir}/projects/app`)) {
      // Remove git folder after clone
      await system.run(`cd ${projectDir}/projects/app && rm -rf .git`);

      // Remove husky from app project
      await system.run(`rm -rf ${projectDir}/projects/app/.husky`);
      await patching.update(`${projectDir}/projects/app/package.json`, (data: Record<string, any>) => {
        delete data.scripts.prepare;
        delete data.devDependencies.husky;
        return data;
      });

      // Commit changes
      await system.run(`cd ${projectDir} && git add . && git commit -am "feat: Angular example integrated"`);

      // Check if git init is active
      if (gitLink) {
        `cd ${projectDir} && git push`;
      }

      // Angular example integration done
      ngBaseSpinner.succeed('Example for Angular integrated');

      if (angularUniversal) {
        // Include example app
        const ngUniversalSpinner = spin('Integrate example for Angular');

        // Get main version of angular
        let angularVersion = '';
        await patching.update(`${projectDir}/projects/app/package.json`, (data: Record<string, any>) => {
          const version = parseInt(data.dependencies['@angular/core'].split('.')[0]);
          if (version && version > 0) {
            angularVersion = '@' + version;
          }
          data.scripts.build = 'ng build --configuration production && ng run app:server';
          data.scripts['build:test'] = 'ng build --configuration test && ng run app:server';
          return data;
        });

        await system.run(
          `cd ${projectDir}/projects/app && ng add @nguniversal/express-engine${angularVersion} --skip-confirmation`
        );

        // Commit changes
        await system.run(`cd ${projectDir} && git add . && git commit -am "feat: Angular Universal integrated"`);

        // Check if git init is active
        if (gitLink) {
          `cd ${projectDir} && git push`;
        }

        // Angular universal integration done
        ngUniversalSpinner.succeed('Angular Universal integrated');
      } else {
        await patching.update(`${projectDir}/projects/app/package.json`, (data: Record<string, any>) => {
          data.scripts.build = 'ng build --configuration production';
          data.scripts['build:test'] = 'ng build --configuration test';
          return data;
        });
      }

      // Include files from https://github.com/lenneTech/nest-server-starter
      if (nestServer) {
        // Init
        const serverSpinner = spin(`Integrate Nest Server Starter`);

        // Clone api
        await system.run(`cd ${projectDir}/projects && git clone https://github.com/lenneTech/nest-server-starter api`);

        // Integrate files
        if (filesystem.isDirectory(`./${projectDir}/projects/api`)) {
          // Remove git folder from clone
          await system.run(`cd ${projectDir}/projects/api && rm -rf .git`);

          // Remove husky from api project
          await system.run(`rm -rf ${projectDir}/projects/api/.husky`);
          await patching.update(`${projectDir}/projects/api/package.json`, (data: Record<string, any>) => {
            delete data.scripts.prepare;
            delete data.devDependencies.husky;
            return data;
          });

          // Prepare meta.json in api
          filesystem.write(`./${projectDir}/projects/api/src/meta.json`, {
            name: `${name}-api-server`,
            description: `API for ${name} app`,
            version: '0.0.0',
          });

          // Commit changes
          await system.run(`cd ${projectDir} && git add . && git commit -am "feat: Nest Server Starter integrated"`);

          // Check if git init is active
          if (gitLink) {
            `cd ${projectDir} && git push`;
          }

          // Done
          serverSpinner.succeed('Nest Server Starter integrated');
        } else {
          serverSpinner.warn('Nest Server Starter not integrated');
        }
      }

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
      info(``);
      success(`Generated workspace ${projectDir} with ${name} app in ${helper.msToMinutesAndSeconds(timer())}m.`);
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
