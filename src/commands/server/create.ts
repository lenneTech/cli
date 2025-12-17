import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  alias: ['c'],
  description: 'Create new server',
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
      patching,
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { kebabCase },
      system,
      template,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configGit = ltConfig?.commands?.server?.create?.git;
    const configAuthor = ltConfig?.commands?.server?.create?.author;
    const configDescription = ltConfig?.commands?.server?.create?.description;

    // Load global defaults
    const globalAuthor = config.getGlobalDefault<string>(ltConfig, 'author');

    // Parse CLI arguments
    const cliGit = parameters.options.git;
    const cliAuthor = parameters.options.author;
    const cliDescription = parameters.options.description;

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new server');

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'server name',
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
    const cloneSpinner = spin('Clone https://github.com/lenneTech/nest-server-starter.git');
    await system.run(`git clone https://github.com/lenneTech/nest-server-starter.git ${projectDir}`);
    if (filesystem.isDirectory(`./${projectDir}`)) {
      filesystem.remove(`./${projectDir}/.git`);
      cloneSpinner.succeed('Repository cloned from https://github.com/lenneTech/nest-server-starter.git');
    }

    // Check directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }

    // Determine description with priority: CLI > config > interactive
    let description: string;
    if (cliDescription) {
      description = cliDescription;
    } else if (configDescription) {
      description = configDescription.replace('{name}', name);
      info(`Using description from lt.config: ${description}`);
    } else {
      description = await helper.getInput(parameters.second, {
        name: 'Description',
        showError: false,
      });
    }

    // Determine author with priority: CLI > config > global > interactive
    let author: string;
    if (cliAuthor) {
      author = cliAuthor;
    } else if (configAuthor) {
      author = configAuthor;
      info(`Using author from lt.config commands.server.create: ${author}`);
    } else if (globalAuthor) {
      author = globalAuthor;
      info(`Using author from lt.config defaults: ${author}`);
    } else {
      author = await helper.getInput('', {
        name: 'Author',
        showError: false,
      });
    }

    const prepareSpinner = spin('Prepare files');

    // Set readme
    await template.generate({
      props: { description, name },
      target: `./${projectDir}/README.md`,
      template: 'nest-server-starter/README.md.ejs',
    });

    // Replace secret or private keys and update database names
    await patching.update(`./${projectDir}/src/config.env.ts`, content => {
      let updated = server.replaceSecretOrPrivateKeys(content);

      // Replace database names in mongoose URIs (nest-server-ci -> projectName-ci, etc.)
      updated = updated.replace(/nest-server-(ci|develop|local|prod|production|test)/g, `${projectDir}-$1`);

      // Also replace any remaining nest-server references (without environment suffix)
      updated = updated.replace(/nest-server/g, projectDir);

      return updated;
    });

    // Update Swagger configuration in main.ts
    await patching.update(`./${projectDir}/src/main.ts`, content =>
      content
        .replace(/\.setTitle\('.*?'\)/, `.setTitle('${name}')`)
        .replace(/\.setDescription\('.*?'\)/, `.setDescription('${description || name}')`)
    );

    // Set package.json
    await patching.update(`./${projectDir}/package.json`, (config) => {
      config.author = author;
      config.bugs = {
        url: '',
      };
      config.description = description || name;
      config.homepage = '';
      config.name = projectDir;
      config.repository = {
        type: 'git',
        url: '',
      };
      config.version = '0.0.1';
      return config;
    });

    // Set package.json
    if (filesystem.exists(`./${projectDir}/src/meta`)) {
      await patching.update(`./${projectDir}/src/meta`, (config) => {
        config.name = name;
        config.description = description;
        return config;
      });
    }

    prepareSpinner.succeed('Files prepared');

    // Init
    const installSpinner = spin('Install npm packages');
    await system.run(`cd ${projectDir} && npm i`);
    installSpinner.succeed('NPM packages installed');
    if (git) {
      const inGit = (await system.run('git rev-parse --is-inside-work-tree'))?.trim();
      if (inGit !== 'true') {
        // Determine initGit with priority: CLI > config > interactive
        let initializeGit: boolean;
        if (cliGit !== undefined) {
          initializeGit = cliGit === true || cliGit === 'true';
        } else if (configGit !== undefined) {
          initializeGit = configGit;
          if (initializeGit) {
            info('Using git initialization setting from lt.config: enabled');
          }
        } else {
          initializeGit = await confirm('Initialize git?', true);
        }
        if (initializeGit) {
          const initGitSpinner = spin('Initialize git');
          await system.run(
            `cd ${projectDir} && git init && git add . && git commit -am "Init via lenne.Tech CLI ${meta.version()}"`,
          );
          initGitSpinner.succeed('Git initialized');
        }
      }
    }

    // Configure default controller type for modules
    info('');
    info('📋 Project Configuration');
    info('');
    info('To streamline module creation, you can set a default controller type.');
    info('This will be used for all new modules unless explicitly overridden.');
    info('');

    const configureDefaults = await confirm('Would you like to configure default settings?', true);

    if (configureDefaults) {
      const controllerChoice = await ask([{
        choices: [
          'Rest - REST controllers only (no GraphQL)',
          'GraphQL - GraphQL resolvers only (includes subscriptions)',
          'Both - Both REST and GraphQL (hybrid approach)',
          'auto - Auto-detect from existing modules',
        ],
        initial: 2, // Default to "Both"
        message: 'Default controller type for new modules?',
        name: 'controller',
        type: 'select',
      }]);

      // Extract the controller type from the choice
      const controllerType = controllerChoice.controller.split(' - ')[0] as 'auto' | 'Both' | 'GraphQL' | 'Rest';

      // Create lt.config.json
      const ltConfig = {
        commands: {
          server: {
            module: {
              controller: controllerType,
            },
          },
        },
        meta: {
          version: '1.0.0',
        },
      };

      const configPath = filesystem.path(projectDir, 'lt.config.json');
      filesystem.write(configPath, ltConfig, { jsonIndent: 2 });

      info('');
      success(`✅ Configuration saved to ${projectDir}/lt.config.json`);
      info(`   Default controller type: ${controllerType}`);
      info('');
      info('💡 You can change this anytime by:');
      info(`   - Editing ${projectDir}/lt.config.json directly`);
      info(`   - Running 'lt config init' in the project directory`);
    } else {
      info('');
      info('⏭️  Skipped configuration. You can set it up later with:');
      info(`   cd ${projectDir} && lt config init`);
    }

    // We're done, so show what to do next
    info('');
    success(
      `Generated ${name} server with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );
    info('');
    info('Next:');
    info('  Start database server (e.g. MongoDB)');
    info(`  Check config: ${projectDir}/src/config.env.ts`);
    info(`  Go to project directory: cd ${projectDir}`);
    info('  Run tests: npm run test:e2e');
    info('  Start server: npm start');
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new server ${name}`;
  },
};

export default NewCommand;
