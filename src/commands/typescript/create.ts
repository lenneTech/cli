import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new TypeScript project
 */
const NewCommand: GluegunCommand = {
  alias: ['c', 'new', 'n'],
  description: 'Creates a new Typescript project',
  hidden: false,
  name: 'create',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
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
      return undefined;
    }

    // Clone git repository
    const cloneSpinner = spin('Clone https://github.com/lenneTech/typescript-starter.git');
    await system.run(`git clone https://github.com/lenneTech/typescript-starter.git ${projectDir}`);
    if (filesystem.isDirectory(`./${projectDir}`)) {
      filesystem.remove(`./${projectDir}/.git`);
      cloneSpinner.succeed('Repository cloned from https://github.com/lenneTech/typescript-starter.git');
    }

    // Check directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }

    // Get author
    const author = await helper.getInput(parameters.second, {
      name: 'Author',
      showError: false,
    });

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

    // Install packages
    const update = await confirm('Do you want to install the latest versions of the included packages?', true);
    if (update) {
      // Update
      await npm.update({ cwd: join(filesystem.cwd(), projectDir), install: true, showError: true });
    } else {
      // Init npm
      const installSpinner = spin('Install npm packages');
      await system.run(`cd ${projectDir} && npm i`);
      installSpinner.succeed('NPM packages installed');
    }

    // Init git
    const initGitSpinner = spin('Initialize git');
    await system.run(
      `cd ${projectDir} && git init && git add . && git commit -am "Init via lenne.Tech CLI ${meta.version()}"`,
    );
    initGitSpinner.succeed('Git initialized');

    // We're done, so show what to do next
    info('');
    success(`Generated ${name} with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return `project ${name} created`;
  },
};

export default NewCommand;
