import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new TypeScript project
 */
const NewCommand: GluegunCommand = {
  alias: ['c', 'new', 'n'],
  description: 'Create TypeScript project',
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
      npm,
      parameters,
      patching,
      print: { error, info, spin, success },
      prompt: { confirm },
      strings: { camelCase, kebabCase, pascalCase },
      system,
      template,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configUpdatePackages = ltConfig?.commands?.typescript?.create?.updatePackages;
    const configAuthor = ltConfig?.commands?.typescript?.create?.author;

    // Load global defaults
    const globalAuthor = config.getGlobalDefault<string>(ltConfig, 'author');

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm || parameters.options.y,
      commandConfig: ltConfig?.commands?.typescript?.create,
      config: ltConfig,
    });

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new TypeScript project');

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'Project name',
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
      return;
    }

    // Clone git repository
    const cloneSpinner = spin('Clone https://github.com/lenneTech/typescript-starter.git');
    try {
      await system.run(`git clone https://github.com/lenneTech/typescript-starter.git ${projectDir}`);
      if (filesystem.isDirectory(`./${projectDir}`)) {
        filesystem.remove(`./${projectDir}/.git`);
        cloneSpinner.succeed('Repository cloned from https://github.com/lenneTech/typescript-starter.git');
      }
    } catch (err) {
      cloneSpinner.fail(`Failed to clone repository: ${err.message}`);
      return;
    }

    // Check directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return;
    }

    // Determine author with priority: CLI > config > global > interactive
    const cliAuthor = parameters.second || parameters.options.author;
    let author: string;
    if (cliAuthor) {
      author = cliAuthor;
    } else if (configAuthor) {
      author = configAuthor;
      info(`Using author from lt.config commands.typescript.create: ${configAuthor}`);
    } else if (globalAuthor) {
      author = globalAuthor;
      info(`Using author from lt.config defaults: ${globalAuthor}`);
    } else {
      author = await helper.getInput(null, {
        name: 'Author',
        showError: false,
      });
    }

    const prepareSpinner = spin('Prepare files');

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(name);
    const nameKebab = kebabCase(name);
    const namePascal = pascalCase(name);

    // Set readme
    await template.generate({
      props: { author, name, nameCamel, nameKebab, namePascal },
      target: `./${projectDir}/README.md`,
      template: 'typescript-starter/README.md.ejs',
    });

    // Set package.json
    await patching.update(`./${projectDir}/package.json`, (config) => {
      config.author = author;
      config.bugs = {
        url: '',
      };
      config.description = name;
      config.homepage = '';
      config.name = nameKebab;
      config.repository = {
        type: 'git',
        url: '',
      };
      config.version = '0.0.1';
      return config;
    });

    // Set package.json
    await patching.update(`./${projectDir}/package-lock.json`, (config) => {
      config.name = nameKebab;
      config.version = '0.0.1';
      return config;
    });

    prepareSpinner.succeed('Files prepared');

    // Determine updatePackages with priority: CLI > config > noConfirm > interactive
    let update: boolean;
    if (parameters.options.update !== undefined) {
      update = parameters.options.update;
    } else if (configUpdatePackages !== undefined) {
      update = configUpdatePackages;
      info(`Using updatePackages from lt.config: ${update}`);
    } else if (noConfirm) {
      update = true; // Default to true when noConfirm is set
    } else {
      update = await confirm('Do you want to install the latest versions of the included packages?', true);
    }
    if (update) {
      // Update
      await npm.update({ cwd: join(filesystem.cwd(), projectDir), install: true, showError: true });
    } else {
      // Install packages
      const installSpinner = spin('Install packages');
      try {
        await system.run(`cd ${projectDir} && ${toolbox.pm.install(toolbox.pm.detect(projectDir))}`);
        installSpinner.succeed('Packages installed');
      } catch (err) {
        installSpinner.fail(`Failed to install packages: ${err.message}`);
        return;
      }
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
    success(`Generated ${name} with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `created project ${name}`;
  },
};

export default NewCommand;
