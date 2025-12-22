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
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { kebabCase },
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configGit = ltConfig?.commands?.server?.create?.git;
    const configAuthor = ltConfig?.commands?.server?.create?.author;
    const configDescription = ltConfig?.commands?.server?.create?.description;
    const configBranch = ltConfig?.commands?.server?.create?.branch;
    const configCopy = ltConfig?.commands?.server?.create?.copy;
    const configLink = ltConfig?.commands?.server?.create?.link;

    // Load global defaults
    const globalAuthor = config.getGlobalDefault<string>(ltConfig, 'author');

    // Parse CLI arguments
    const cliGit = parameters.options.git;
    const cliAuthor = parameters.options.author;
    const cliDescription = parameters.options.description;
    const cliNoConfirm = parameters.options.noConfirm;
    const cliBranch = parameters.options.branch || parameters.options.b;
    const cliCopy = parameters.options.copy || parameters.options.c;
    const cliLink = parameters.options.link;

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: cliNoConfirm,
      commandConfig: ltConfig?.commands?.server?.create,
      config: ltConfig,
    });

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
      return;
    }

    // Determine copy/link paths with priority: CLI > config
    const copyPath = cliCopy || configCopy;
    const linkPath = cliLink || configLink;

    // Determine branch with priority: CLI > config
    const branch = cliBranch || configBranch;

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

    // Setup server using Server extension
    const setupSpinner = spin(`Setting up server${linkPath ? ' (link)' : copyPath ? ' (copy)' : branch ? ` (branch: ${branch})` : ''}`);

    const result = await server.setupServer(`./${projectDir}`, {
      author,
      branch,
      copyPath,
      description,
      linkPath,
      name,
      projectDir,
    });

    if (!result.success) {
      setupSpinner.fail(`Failed to set up server: ${result.path}`);
      return;
    }

    setupSpinner.succeed(`Server template set up (${result.method})`);

    // For symlinks, skip all post-setup steps
    if (result.method === 'link') {
      info('');
      success(`Created symlink ${projectDir} -> ${result.path}`);
      info('');
      info('Note: This is a symlink - changes will affect the original template!');
      info('');
      info('Next:');
      info(`  Go to project directory: cd ${projectDir}`);
      info('  Start server: npm start');
      info('');

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }
      return `created server symlink ${name}`;
    }

    // Git initialization (after npm install which is done in setupServer)
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
        } else if (noConfirm) {
          initializeGit = false; // Default to false when noConfirm (avoid unexpected side effects)
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
    info('Project Configuration');
    info('');
    info('To streamline module creation, you can set a default controller type.');
    info('This will be used for all new modules unless explicitly overridden.');
    info('');

    const configureDefaults = noConfirm ? true : await confirm('Would you like to configure default settings?', true);

    if (configureDefaults) {
      // Determine controller type - use default when noConfirm, otherwise ask
      let controllerType: 'auto' | 'Both' | 'GraphQL' | 'Rest';
      if (noConfirm) {
        controllerType = 'Both'; // Default to Both when noConfirm
        info('Using default controller type: Both');
      } else {
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
        controllerType = controllerChoice.controller.split(' - ')[0] as 'auto' | 'Both' | 'GraphQL' | 'Rest';
      }

      // Create lt.config.json
      const projectConfig = {
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
      filesystem.write(configPath, projectConfig, { jsonIndent: 2 });

      info('');
      success(`Configuration saved to ${projectDir}/lt.config.json`);
      info(`   Default controller type: ${controllerType}`);
      info('');
      info('You can change this anytime by:');
      info(`   - Editing ${projectDir}/lt.config.json directly`);
      info(`   - Running 'lt config init' in the project directory`);
    } else {
      info('');
      info('Skipped configuration. You can set it up later with:');
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
    return `created server ${name}`;
  },
};

export default NewCommand;
