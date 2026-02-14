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
    const configApiMode = ltConfig?.commands?.server?.create?.apiMode;

    // Load global defaults
    const globalAuthor = config.getGlobalDefault<string>(ltConfig, 'author');
    const globalApiMode = config.getGlobalDefault<'Both' | 'GraphQL' | 'Rest'>(ltConfig, 'apiMode');

    // Parse CLI arguments
    const cliGit = parameters.options.git;
    const cliAuthor = parameters.options.author;
    const cliDescription = parameters.options.description;
    const cliNoConfirm = parameters.options.noConfirm;
    const cliBranch = parameters.options.branch || parameters.options.b;
    const cliCopy = parameters.options.copy || parameters.options.c;
    const cliLink = parameters.options.link;
    const cliApiMode = parameters.options['api-mode'] || parameters.options.apiMode;

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

    // Hint for non-interactive callers (e.g. Claude Code)
    toolbox.tools.nonInteractiveHint('lt server create --name <name> --api-mode <Rest|GraphQL|Both> --noConfirm');

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

    // Determine API mode with priority: CLI > config > global > interactive (default: Rest)
    let apiMode: 'Both' | 'GraphQL' | 'Rest';
    if (cliApiMode) {
      apiMode = cliApiMode as 'Both' | 'GraphQL' | 'Rest';
    } else if (configApiMode) {
      apiMode = configApiMode;
      info(`Using API mode from lt.config commands.server.create: ${apiMode}`);
    } else if (globalApiMode) {
      apiMode = globalApiMode;
      info(`Using API mode from lt.config defaults: ${apiMode}`);
    } else if (noConfirm) {
      apiMode = 'Rest';
      info('Using default API mode: REST/RPC');
    } else {
      const apiModeChoice = await ask([
        {
          choices: [
            'Rest - REST/RPC API with Swagger documentation (recommended)',
            'GraphQL - GraphQL API with subscriptions',
            'Both - REST/RPC and GraphQL in parallel (hybrid)',
          ],
          initial: 0,
          message: 'API mode?',
          name: 'apiMode',
          type: 'select',
        },
      ]);
      apiMode = apiModeChoice.apiMode.split(' - ')[0] as 'Both' | 'GraphQL' | 'Rest';
    }

    // Setup server using Server extension
    const setupSpinner = spin(
      `Setting up server${linkPath ? ' (link)' : copyPath ? ' (copy)' : branch ? ` (branch: ${branch})` : ''}`,
    );

    const result = await server.setupServer(`./${projectDir}`, {
      apiMode,
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
      info(`  Start server: ${toolbox.pm.run('start')}`);
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

    // Derive controller type from API mode and save project config
    const controllerType: 'Both' | 'GraphQL' | 'Rest' = apiMode;

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
        apiMode,
        version: '1.0.0',
      },
    };

    const configPath = filesystem.path(projectDir, 'lt.config.json');
    filesystem.write(configPath, projectConfig, { jsonIndent: 2 });

    info('');
    success(`Configuration saved to ${projectDir}/lt.config.json`);
    info(`   API mode: ${apiMode}`);
    info(`   Default controller type: ${controllerType}`);

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
    info(`  Run tests: ${toolbox.pm.run('test:e2e')}`);
    info(`  Start server: ${toolbox.pm.run('start')}`);
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `created server ${name}`;
  },
};

export default NewCommand;
