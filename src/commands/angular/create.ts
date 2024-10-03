import * as crypto from 'crypto';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  alias: ['c'],
  description: 'Creates a new angular (fullstack) workspace',
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
      strings: { camelCase, kebabCase, pascalCase },
      system,
      template,
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

    // Nest-Server
    const nestServer
      = parameters.second?.toLowerCase().includes('nest')
      || (!parameters.second && (await confirm('Add API (Nest-Server)?', true)));

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
      data.version = '0.0.0';
      return data;
    });

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(name);
    const nameKebab = kebabCase(name);
    const namePascal = pascalCase(name);

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

      // Include files from https://github.com/lenneTech/nest-server-starter
      if (nestServer) {
        // Init
        const serverSpinner = spin('Integrate Nest Server Starter');

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
            description: `API for ${name} app`,
            name: `${name}-api-server`,
            version: '0.0.0',
          });

          // Set configuration
          for (const env of ['LOCAL', 'DEV', 'TEST', 'PREV', 'PROD']) {
            await patching.replace(
              `./${projectDir}/projects/api/src/config.env.ts`,
              `SECRET_OR_PRIVATE_KEY_${env}`,
              crypto.randomBytes(512).toString('base64'),
            );
            await patching.replace(
              `./${projectDir}/projects/api/src/config.env.ts`,
              `SECRET_OR_PRIVATE_KEY_${env}_REFRESH`,
              crypto.randomBytes(512).toString('base64'),
            );
          }
          await patching.update(`./${projectDir}/projects/api/src/config.env.ts`, data =>
            data.replace(/nest-server-/g, `${projectDir}-`),
          );

          // Set readme
          await template.generate({
            props: { name, nameCamel, nameKebab, namePascal, repository: gitLink || 'REPOSITORY' },
            target: `./${projectDir}/README.md`,
            template: 'monorepro/README.md.ejs',
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
