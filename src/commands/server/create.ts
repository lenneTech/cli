import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { runStandaloneWorkspaceGate } from '../../lib/workspace-integration';

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

    // Handle --help-json flag
    if (
      toolbox.tools.helpJson({
        aliases: ['c'],
        configuration: 'commands.server.create.*',
        description: 'Create new server',
        name: 'create',
        options: [
          { description: 'Server name', flag: '--name', required: true, type: 'string' },
          {
            description: 'API mode',
            flag: '--api-mode',
            required: false,
            type: 'string',
            values: ['Rest', 'GraphQL', 'Both'],
          },
          { description: 'Project description', flag: '--description', required: false, type: 'string' },
          { description: 'Project author', flag: '--author', required: false, type: 'string' },
          { description: 'Initialize git repository', flag: '--git', required: false, type: 'boolean' },
          { description: 'Git branch to clone from', flag: '--branch', required: false, type: 'string' },
          { description: 'Copy from local path instead of cloning', flag: '--copy', required: false, type: 'string' },
          { description: 'Symlink to local path instead of cloning', flag: '--link', required: false, type: 'string' },
          {
            description: 'Backend framework consumption mode',
            flag: '--framework-mode',
            required: false,
            type: 'string',
            values: ['npm', 'vendor'],
          },
          {
            description: 'Upstream nest-server branch/tag to vendor (with --framework-mode vendor)',
            flag: '--framework-upstream-branch',
            required: false,
            type: 'string',
          },
          {
            default: false,
            description: 'Use experimental nest-base template (Bun + Prisma + Postgres)',
            flag: '--next',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Print resolved plan and exit without making any changes',
            flag: '--dry-run',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Override the workspace-detection abort under --noConfirm',
            flag: '--force',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Skip all interactive prompts',
            flag: '--noConfirm',
            required: false,
            type: 'boolean',
          },
        ],
      })
    ) {
      return;
    }

    // Load configuration
    const ltConfig = config.loadConfig();
    const configGit = ltConfig?.commands?.server?.create?.git;
    const configAuthor = ltConfig?.commands?.server?.create?.author;
    const configDescription = ltConfig?.commands?.server?.create?.description;
    const configBranch = ltConfig?.commands?.server?.create?.branch;
    const configCopy = ltConfig?.commands?.server?.create?.copy;
    const configLink = ltConfig?.commands?.server?.create?.link;
    const configApiMode = ltConfig?.commands?.server?.create?.apiMode;
    const configFrameworkMode = ltConfig?.commands?.server?.create?.frameworkMode as 'npm' | 'vendor' | undefined;

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
    const cliFrameworkMode = parameters.options['framework-mode'] as 'npm' | 'vendor' | undefined;
    const cliFrameworkUpstreamBranch = parameters.options['framework-upstream-branch'] as string | undefined;
    const cliDryRun = parameters.options['dry-run'];
    const cliForce = parameters.options.force;
    const experimental = parameters.options.next === true || parameters.options.next === 'true';
    const dryRun = cliDryRun === true || cliDryRun === 'true';
    const force = cliForce === true || cliForce === 'true';

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
    toolbox.tools.nonInteractiveHint(
      'lt server create --name <name> --api-mode <Rest|GraphQL|Both> --framework-mode <npm|vendor> [--next] [--dry-run] --noConfirm',
    );

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Workspace-awareness: bundled into runStandaloneWorkspaceGate so
    // server/frontend commands share the print + prompt + decision +
    // exit logic. Three modes:
    //   - interactive             → confirm prompt
    //   - non-interactive         → refuse (KI/CI default — fail loud)
    //   - non-interactive + force → proceed with a hint
    const proceed = await runStandaloneWorkspaceGate({
      cwd: '.',
      filesystem,
      force,
      fromGluegunMenu: Boolean(toolbox.parameters.options.fromGluegunMenu),
      noConfirmFlag: noConfirm,
      pieceName: 'api',
      print: { confirm, error, info },
      projectKind: 'server',
      suggestion: 'lt fullstack add-api',
    });
    if (!proceed) return;

    // Get name. Honour the explicit `--name <slug>` flag (declared as
    // required in the help-json contract) before falling back to the
    // first positional argument or interactive input. Without this, a
    // non-interactive caller passing only `--name my-srv` is forced
    // into the prompt because `parameters.first` is empty.
    const cliName = parameters.options.name as string | undefined;
    const name =
      cliName ||
      (await helper.getInput(parameters.first, {
        name: 'server name',
        showError: true,
      }));
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

    // Determine description with priority: CLI > config > interactive.
    // Skip the interactive prompt under --noConfirm; description is
    // optional and defaulting to the project name keeps the package.json
    // valid for non-interactive callers.
    let description: string;
    if (cliDescription) {
      description = cliDescription;
    } else if (configDescription) {
      description = configDescription.replace('{name}', name);
      info(`Using description from lt.config: ${description}`);
    } else if (noConfirm) {
      description = '';
    } else {
      description = await helper.getInput(parameters.second, {
        name: 'Description',
        showError: false,
      });
    }

    // Determine author with priority: CLI > config > global > interactive.
    // Skip the prompt under --noConfirm.
    let author: string;
    if (cliAuthor) {
      author = cliAuthor;
    } else if (configAuthor) {
      author = configAuthor;
      info(`Using author from lt.config commands.server.create: ${author}`);
    } else if (globalAuthor) {
      author = globalAuthor;
      info(`Using author from lt.config defaults: ${author}`);
    } else if (noConfirm) {
      author = '';
    } else {
      author = await helper.getInput('', {
        name: 'Author',
        showError: false,
      });
    }

    // Determine API mode with priority: CLI > config > global > interactive (default: Rest)
    let apiMode: 'Both' | 'GraphQL' | 'Rest';
    if (experimental) {
      apiMode = 'Rest';
      info('Using experimental nest-base template (Bun + Prisma + Postgres + Better-Auth)');
    } else if (cliApiMode) {
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

    // Determine framework consumption mode — same resolution cascade as
    // lt fullstack init: CLI flag > lt.config > interactive (default npm).
    let frameworkMode: 'npm' | 'vendor';
    if (experimental) {
      frameworkMode = 'npm';
    } else if (cliFrameworkMode === 'npm' || cliFrameworkMode === 'vendor') {
      frameworkMode = cliFrameworkMode;
    } else if (cliFrameworkMode) {
      error(`Invalid --framework-mode value "${cliFrameworkMode}". Use "npm" or "vendor".`);
      return;
    } else if (configFrameworkMode === 'npm' || configFrameworkMode === 'vendor') {
      frameworkMode = configFrameworkMode;
      info(`Using framework mode from lt.config: ${frameworkMode}`);
    } else if (noConfirm) {
      frameworkMode = 'npm';
    } else {
      const frameworkModeChoice = await ask({
        choices: [
          'npm    - @lenne.tech/nest-server as npm dependency (classic, stable)',
          'vendor - framework core vendored into src/core/ (pilot, allows local patches)',
        ],
        initial: 0,
        message: 'Framework consumption mode?',
        name: 'frameworkMode',
        type: 'select',
      });
      frameworkMode = frameworkModeChoice.frameworkMode.startsWith('vendor') ? 'vendor' : 'npm';
    }

    const frameworkUpstreamBranch =
      typeof cliFrameworkUpstreamBranch === 'string' && cliFrameworkUpstreamBranch.length > 0
        ? cliFrameworkUpstreamBranch
        : undefined;

    // Dry-run: print the resolved plan and exit without any disk
    // changes. Mirrors the dry-run surface of `lt fullstack init` /
    // `add-api` / `add-app` so agent workflows can preview the
    // standalone path the same way.
    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  name:                       ${name}`);
      info(`  projectDir:                 ${projectDir}`);
      info(`  apiMode:                    ${apiMode}`);
      info(`  frameworkMode:              ${frameworkMode}`);
      if (frameworkUpstreamBranch) {
        info(`  frameworkUpstreamBranch:    ${frameworkUpstreamBranch}`);
      }
      info(`  branch:                     ${branch || '(default)'}`);
      info(`  copy:                       ${copyPath || '(none)'}`);
      info(`  link:                       ${linkPath || '(none)'}`);
      info(`  experimental (--next):      ${experimental}`);
      info(`  description:                ${description || '(none)'}`);
      info(`  author:                     ${author || '(none)'}`);
      info('');
      info('Would execute:');
      if (experimental) {
        info(`  1. clone nest-base → ./${projectDir}`);
        info(`  2. patch package.json (name = ${projectDir})`);
      } else if (frameworkMode === 'vendor') {
        info(`  1. clone nest-server-starter → ./${projectDir}`);
        info(
          `  2. clone @lenne.tech/nest-server${frameworkUpstreamBranch ? ` (${frameworkUpstreamBranch})` : ''} → /tmp`,
        );
        info(`  3. vendor core/ + flatten-fix + codemod consumer imports`);
        info(`  4. merge upstream deps`);
        info(`  5. run processApiMode(${apiMode})`);
      } else {
        info(`  1. clone nest-server-starter → ./${projectDir}`);
        info(`  2. run processApiMode(${apiMode})`);
      }
      info(`  N. write ./${projectDir}/lt.config.json`);
      info('');
      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }
      return `dry-run server create (${frameworkMode} / ${apiMode})`;
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
      experimental,
      frameworkMode,
      frameworkUpstreamBranch,
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

    if (!experimental) {
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
    }

    // We're done, so show what to do next
    info('');
    success(
      `Generated ${name} server with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );
    info('');
    info('Next:');
    if (experimental) {
      info(`  Go to project directory: cd ${projectDir}`);
      info('  Install dependencies: bun install');
      info('  Configure .env (see .env.example)');
      info('  Start Postgres + run prisma generate / migrate');
      info('  Start server: bun run dev');
    } else {
      info('  Start database server (e.g. MongoDB)');
      info(`  Check config: ${projectDir}/src/config.env.ts`);
      info(`  Go to project directory: cd ${projectDir}`);
      info(`  Run tests: ${toolbox.pm.run('test:e2e')}`);
      info(`  Start server: ${toolbox.pm.run('start')}`);
    }
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `created server ${name}`;
  },
};

export default NewCommand;
