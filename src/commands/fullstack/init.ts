import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new fullstack workspace
 */
const NewCommand: GluegunCommand = {
  alias: ['init'],
  description: 'Create fullstack workspace',
  hidden: false,
  name: 'init',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      filesystem,
      frontendHelper,
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { kebabCase },
      system,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new fullstack workspace');

    // Hint for non-interactive callers (e.g. Claude Code)
    toolbox.tools.nonInteractiveHint('lt fullstack init --name <name> --frontend <nuxt|angular> --api-mode <Rest|GraphQL|Both> --noConfirm');

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Load configuration
    const ltConfig = config.loadConfig();
    const configFrontend = ltConfig?.commands?.fullstack?.frontend;
    const configApiMode = ltConfig?.commands?.fullstack?.apiMode;
    const configGit = ltConfig?.commands?.fullstack?.git;
    const configGitLink = ltConfig?.commands?.fullstack?.gitLink;
    const configApiBranch = ltConfig?.commands?.fullstack?.apiBranch;
    const configFrontendBranch = ltConfig?.commands?.fullstack?.frontendBranch;
    const configApiCopy = ltConfig?.commands?.fullstack?.apiCopy;
    const configFrontendCopy = ltConfig?.commands?.fullstack?.frontendCopy;
    const configApiLink = ltConfig?.commands?.fullstack?.apiLink;
    const configFrontendLink = ltConfig?.commands?.fullstack?.frontendLink;

    // Parse CLI arguments
    const {
      'api-branch': cliApiBranch,
      'api-copy': cliApiCopy,
      'api-link': cliApiLink,
      'api-mode': cliApiMode,
      frontend: cliFrontend,
      'frontend-branch': cliFrontendBranch,
      'frontend-copy': cliFrontendCopy,
      'frontend-link': cliFrontendLink,
      git: cliGit,
      'git-link': cliGitLink,
      name: cliName,
    } = parameters.options;

    // Determine noConfirm with priority: CLI > command > parent > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.fullstack,
      config: ltConfig,
    });

    // Get name of the workspace
    const name = cliName || await helper.getInput(parameters.first, {
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
      return;
    }

    // Determine frontend with priority: CLI > config > interactive
    let frontend: string | undefined;
    if (cliFrontend) {
      frontend = cliFrontend === 'angular' ? 'angular' : cliFrontend === 'nuxt' ? 'nuxt' : null;
      if (!frontend) {
        error('Invalid frontend option. Use "angular" or "nuxt".');
        return;
      }
    } else if (configFrontend) {
      frontend = configFrontend;
      info(`Using frontend from lt.config: ${frontend}`);
    } else if (noConfirm) {
      // Use default when noConfirm
      frontend = 'nuxt';
      info('Using default frontend: nuxt (noConfirm mode)');
    } else {
      // Interactive mode with sensible default
      const choices = ['angular', 'nuxt'];
      frontend = (
        await ask({
          choices,
          initial: 1, // Default to nuxt
          message: 'Which frontend framework?',
          name: 'frontend',
          type: 'select',
        })
      ).frontend;

      if (!frontend) {
        return;
      }
    }

    // Determine API mode with priority: CLI > config > global > interactive (default: Rest)
    const globalApiMode = config.getGlobalDefault<'Both' | 'GraphQL' | 'Rest'>(ltConfig, 'apiMode');
    let apiMode: 'Both' | 'GraphQL' | 'Rest';
    if (cliApiMode) {
      apiMode = cliApiMode as 'Both' | 'GraphQL' | 'Rest';
    } else if (configApiMode) {
      apiMode = configApiMode;
      info(`Using API mode from lt.config: ${apiMode}`);
    } else if (globalApiMode) {
      apiMode = globalApiMode;
      info(`Using API mode from lt.config defaults: ${apiMode}`);
    } else if (noConfirm) {
      apiMode = 'Rest';
      info('Using default API mode: REST/RPC');
    } else {
      const apiModeChoice = await ask({
        choices: [
          'Rest - REST/RPC API with Swagger documentation (recommended)',
          'GraphQL - GraphQL API with subscriptions',
          'Both - REST and GraphQL in parallel (hybrid)',
        ],
        initial: 0,
        message: 'API mode?',
        name: 'apiMode',
        type: 'select',
      });
      apiMode = apiModeChoice.apiMode.split(' - ')[0] as 'Both' | 'GraphQL' | 'Rest';
    }

    // Determine remote push settings with priority: CLI > config > interactive
    // Git is always initialized; the question is whether to push to a remote
    let pushToRemote = false;
    let gitLink: string | undefined;

    if (cliGit !== undefined) {
      // CLI parameter provided
      pushToRemote = cliGit === 'true' || cliGit === true;
      if (pushToRemote) {
        gitLink = cliGitLink || configGitLink;
        if (!gitLink) {
          error('--git-link is required when --git is true (or configure gitLink in lt.config)');
          return;
        }
      }
    } else if (configGit !== undefined) {
      // Config value provided
      pushToRemote = configGit;
      if (pushToRemote) {
        gitLink = cliGitLink || configGitLink;
        if (!gitLink) {
          // Ask for git link interactively
          gitLink = await helper.getInput(null, {
            name: 'git repository link',
            showError: true,
          });
          if (!gitLink) {
            pushToRemote = false;
          }
        } else {
          info(`Using git configuration from lt.config`);
        }
      }
    } else if (!noConfirm && parameters.third !== 'false') {
      // Interactive mode
      pushToRemote = parameters.third === 'true' || (await confirm('Push initial commit to a remote repository (dev branch)?'));

      if (pushToRemote) {
        gitLink = configGitLink || await helper.getInput(null, {
          name: 'git repository link',
          showError: true,
        });
        if (!gitLink) {
          pushToRemote = false;
        }
      }
    }

    // Determine branches and copy/link paths with priority: CLI > config
    const apiBranch = cliApiBranch || configApiBranch;
    const frontendBranch = cliFrontendBranch || configFrontendBranch;
    const apiCopy = cliApiCopy || configApiCopy;
    const apiLink = cliApiLink || configApiLink;
    const frontendCopy = cliFrontendCopy || configFrontendCopy;
    const frontendLink = cliFrontendLink || configFrontendLink;

    const workspaceSpinner = spin(`Create fullstack workspace with ${frontend} in ${projectDir} with ${name} app`);

    // Clone monorepo
    try {
      await system.run(`git clone https://github.com/lenneTech/lt-monorepo.git ${projectDir}`);
    } catch (err) {
      workspaceSpinner.fail(`Failed to clone monorepo: ${err.message}`);
      return;
    }

    // Check for directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      workspaceSpinner.fail(`The directory "${projectDir}" could not be created.`);
      return;
    }

    workspaceSpinner.succeed(`Create fullstack workspace with ${frontend} in ${projectDir} for ${name} created`);

    // Include example app
    const ngBaseSpinner = spin(`Integrate example for ${frontend}`);

    // Remove git folder after clone
    filesystem.remove(`${projectDir}/.git`);

    // Always initialize git
    try {
      await system.run(`cd ${projectDir} && git init --initial-branch=dev`);
    } catch (err) {
      error(`Failed to initialize git: ${err.message}`);
      return;
    }

    // Add remote if push is configured
    if (pushToRemote && gitLink) {
      try {
        await system.run(`cd ${projectDir} && git remote add origin ${gitLink}`);
      } catch (err) {
        error(`Failed to add remote: ${err.message}`);
        return;
      }
    }

    // Setup frontend using FrontendHelper
    const frontendDest = `${projectDir}/projects/app`;
    const isNuxt = frontend === 'nuxt';

    let frontendResult;
    if (isNuxt) {
      frontendResult = await frontendHelper.setupNuxt(frontendDest, {
        branch: frontendBranch,
        copyPath: frontendCopy,
        linkPath: frontendLink,
        skipInstall: true, // Will install at monorepo level
      });
    } else {
      frontendResult = await frontendHelper.setupAngular(frontendDest, {
        branch: frontendBranch,
        copyPath: frontendCopy,
        linkPath: frontendLink,
        skipGitInit: true, // Git is handled at monorepo level
        skipHuskyRemoval: true, // Will handle at monorepo level if needed
        skipInstall: true, // Will install at monorepo level
      });
    }

    if (!frontendResult.success) {
      error(`Failed to set up ${frontend} frontend: ${frontendResult.path}`);
      return;
    }

    // Remove gitkeep file
    filesystem.remove(`${projectDir}/projects/.gitkeep`);

    // Integrate files
    if (filesystem.isDirectory(`./${projectDir}/projects/app`)) {
      ngBaseSpinner.succeed(`Example for ${frontend} integrated`);

      // Include files from https://github.com/lenneTech/nest-server-starter
      const serverSpinner = spin(`Integrate Nest Server Starter${apiLink ? ' (link)' : apiCopy ? ' (copy)' : apiBranch ? ` (branch: ${apiBranch})` : ''}`);

      // Setup API using Server extension
      const apiDest = `${projectDir}/projects/api`;
      const apiResult = await server.setupServerForFullstack(apiDest, {
        apiMode,
        branch: apiBranch,
        copyPath: apiCopy,
        linkPath: apiLink,
        name,
        projectDir,
      });

      if (!apiResult.success) {
        serverSpinner.fail(`Failed to set up API: ${apiResult.path}`);
        return;
      }

      // Create lt.config.json for API
      const apiConfigPath = filesystem.path(apiDest, 'lt.config.json');
      filesystem.write(apiConfigPath, {
        commands: {
          server: {
            module: {
              controller: apiMode,
            },
          },
        },
        meta: {
          apiMode,
          version: '1.0.0',
        },
      }, { jsonIndent: 2 });

      // Integrate files
      if (filesystem.isDirectory(`./${projectDir}/projects/api`)) {
        serverSpinner.succeed('Nest Server Starter integrated');
      } else {
        serverSpinner.warn('Nest Server Starter not integrated');
      }

      // Install all packages
      const installSpinner = spin('Install all packages');
      try {
        const detectedPm = toolbox.pm.detect(projectDir);
        await system.run(`cd ${projectDir} && ${toolbox.pm.install(detectedPm)} && ${toolbox.pm.run('init', detectedPm)}`);
        installSpinner.succeed('Successfully installed all packages');
      } catch (err) {
        installSpinner.fail(`Failed to install packages: ${err.message}`);
        return;
      }

      // Create initial commit after everything is set up
      try {
        await system.run(`cd ${projectDir} && git add . && git commit -m "Initial commit"`);
      } catch (err) {
        error(`Failed to create initial commit: ${err.message}`);
        return;
      }

      // Push to remote if configured
      if (pushToRemote) {
        try {
          await system.run(`cd ${projectDir} && git push -u origin dev`);
        } catch (err) {
          error(`Failed to push to remote: ${err.message}`);
          return;
        }
      }

      // We're done, so show what to do next
      info('');
      success(
        `Generated fullstack workspace with ${frontend} in ${projectDir} with ${name} app in ${helper.msToMinutesAndSeconds(
          timer(),
        )}m.`,
      );
      info('');
      info('Next:');
      info(`  Run ${name}`);
      info(`  $ cd ${projectDir}`);
      info(`  $ ${toolbox.pm.run('start')}`);
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
