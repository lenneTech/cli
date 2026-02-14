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
    const configLink = ltConfig?.commands?.cli?.create?.link;

    // Load global defaults
    const globalAuthor = config.getGlobalDefault<string>(ltConfig, 'author');

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm || parameters.options.y,
      commandConfig: ltConfig?.commands?.cli?.create,
      config: ltConfig,
    });

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

    // Determine link with priority: CLI > config > interactive
    let link: boolean;
    if (parameters.options.link) {
      link = true;
    } else if (parameters.options.nolink) {
      link = false;
    } else if (configLink !== undefined) {
      link = configLink;
      info(`Using link from lt.config commands.cli.create: ${link}`);
    } else if (noConfirm) {
      link = false; // Default to false when noConfirm is set
    } else {
      link = !!(
        await ask({
          message: 'Link when finished?',
          name: 'link',
          type: 'confirm',
        })
      ).link;
    }

    // Start timer
    const timer = system.startTimer();

    // Set project directory
    const projectDir = kebabCase(name); // kebab-case

    // Check if directory already exists
    if (filesystem.exists(projectDir)) {
      info('');
      error(`There's already a folder named "${projectDir}" here.`);
      return;
    }

    // Clone git repository
    const cloneSpinner = spin('Clone https://github.com/lenneTech/cli-starter.git');
    try {
      await system.run(`git clone https://github.com/lenneTech/cli-starter.git ${projectDir}`);
      if (filesystem.isDirectory(`./${projectDir}`)) {
        filesystem.remove(`./${projectDir}/.git`);
        cloneSpinner.succeed('Repository cloned from https://github.com/lenneTech/cli-starter.git');
      } else {
        cloneSpinner.fail(`The directory "${projectDir}" could not be created.`);
        return;
      }
    } catch (err) {
      cloneSpinner.fail(`Failed to clone repository: ${err.message}`);
      return;
    }

    // Install packages
    const detectedPm = toolbox.pm.detect(projectDir);
    const installSpinner = spin('Install packages');
    try {
      await system.run(`cd ${projectDir} && ${toolbox.pm.install(detectedPm)}`);
      installSpinner.succeed('Packages installed');
    } catch (err) {
      installSpinner.fail(`Failed to install packages: ${err.message}`);
      return;
    }

    // Rename files and data
    const renameSpinner = spin(`Rename files & data ${link ? ' and link' : ''}`);
    try {
      await system.run(
        `cd ${projectDir} && ${toolbox.pm.run('rename', detectedPm)} -- "${name}" --author "${author}" --${link ? 'link' : 'nolink'}`,
      );
      renameSpinner.succeed(`Files & data renamed${link ? ' and linked' : ''}`);
    } catch (err) {
      renameSpinner.fail(`Failed to rename files: ${err.message}`);
      return;
    }

    // Init git
    const initGitSpinner = spin('Initialize git');
    try {
      await system.run(
        `cd ${projectDir} && git init && git add . && git commit -am "Init via lenne.Tech CLI ${meta.version()}"`,
      );
      initGitSpinner.succeed('Git initialized');
    } catch (err) {
      initGitSpinner.fail(`Failed to initialize git: ${err.message}`);
      return;
    }

    // We're done, so show what to do next
    info('');
    success(
      `Generated ${name} CLI with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `created cli ${name}`;
  },
};

export default NewCommand;
