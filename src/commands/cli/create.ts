import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new CLI
 */
const NewCommand: GluegunCommand = {
  alias: ['c'],
  description: 'Create new CLI project',
  hidden: false,
  name: 'create',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      filesystem,
      git,
      helper,
      meta,
      parameters,
      print: { error, info, spin, success },
      prompt: { ask },
      strings: { kebabCase },
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configAuthor = ltConfig?.commands?.cli?.create?.author;

    // Load global defaults
    const globalAuthor = config.getGlobalDefault<string>(ltConfig, 'author');

    // Info
    info('Create a new CLI');

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'CLI name',
      showError: true,
    });
    if (!name) {
      return;
    }

    // Determine author with priority: CLI > config > global > interactive
    const cliAuthor = parameters.options.author;
    let author: string;
    if (cliAuthor) {
      author = cliAuthor;
    } else if (configAuthor) {
      author = configAuthor;
      info(`Using author from lt.config commands.cli.create: ${configAuthor}`);
    } else if (globalAuthor) {
      author = globalAuthor;
      info(`Using author from lt.config defaults: ${globalAuthor}`);
    } else {
      author = await helper.getInput(null, {
        name: 'Author',
        showError: true,
      });
    }
    if (!author) {
      return;
    }

    // Link
    let link = parameters.options.link && !parameters.options.nolink;
    if (!parameters.options.link && !parameters.options.nolink) {
      link = !!(await ask({
        message: 'Link when finished?',
        name: 'link',
        type: 'confirm',
      })).link;
    }

    // Start timer
    const timer = system.startTimer();

    // Set project directory
    const projectDir = kebabCase(name); // kebab-case

    // Check if directory already exists
    if (filesystem.exists(projectDir)) {
      info('');
      error(`There's already a folder named "${projectDir}" here.`);
      return undefined;
    }

    // Clone git repository
    const cloneSpinner = spin('Clone https://github.com/lenneTech/cli-starter.git');
    await system.run(`git clone https://github.com/lenneTech/cli-starter.git ${projectDir}`);
    if (filesystem.isDirectory(`./${projectDir}`)) {
      filesystem.remove(`./${projectDir}/.git`);
      cloneSpinner.succeed('Repository cloned from https://github.com/lenneTech/cli-starter.git');
    } else {
      cloneSpinner.fail(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }

    // Install packages
    const installSpinner = spin('Install npm packages');
    await system.run(`cd ${projectDir} && npm i`);
    installSpinner.succeed('NPM packages installed');

    // Rename files and data
    const renameSpinner = spin(`Rename files & data ${link ? ' and link' : ''}`);
    await system.run(
      `cd ${projectDir} && npm run rename -- "${name}" --author "${author}" --${link ? 'link' : 'nolink'}`,
    );
    renameSpinner.succeed(`Files & data renamed${link ? ' and linked' : ''}`);

    // Init git
    const initGitSpinner = spin('Initialize git');
    await system.run(
      `cd ${projectDir} && git init && git add . && git commit -am "Init via lenne.Tech CLI ${meta.version()}"`,
    );
    initGitSpinner.succeed('Git initialized');

    // We're done, so show what to do next
    info('');
    success(
      `Generated ${name} server with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );

    // For tests
    return `new cli ${name}`;
  },
};

export default NewCommand;
