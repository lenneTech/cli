import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  name: 'create',
  alias: ['c'],
  description: 'Creates a new angular workspace',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
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

    // Init Workspace
    const workspaceSpinner = spin(`Create workspace ${projectDir} with ${appName}`);
    await system.run(
      `npx create-nx-workspace ${projectDir} --preset='angular' --appName='${appName}' --style='scss' --linter='eslint' --packageManager='npm' --nxCloud=false --cli="nx"`
    );
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }
    workspaceSpinner.succeed(`Create workspace ${projectDir} for ${appName} created`);

    // Include @lenne.tech/ng-base
    const ngBaseSpinner = spin('Include ng-base');
    await system.run(
      `cd ${projectDir} && npm i @lenne.tech/ng-base && git add . && npm commit -am "@lenne.tech/ng-base integrated"`
    );
    ngBaseSpinner.succeed('ng-base included');

    // We're done, so show what to do next
    info(``);
    success(`Generated workspace ${projectDir} with ${appName} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info(``);
    info(`Next:`);
    info(`  Run ${appName}`);
    info(`  $ cd ${projectDir}`);
    info(`  $ npm start`);
    info(``);
    info(`More infos about Nx and Angular: https://nx.dev/angular`);
    info(``);

    // For tests
    return `new workspace ${projectDir} with ${appName}`;
  },
};

export default NewCommand;
