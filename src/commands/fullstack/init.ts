import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { hoistWorkspacePnpmConfig } from '../../lib/hoist-workspace-pnpm-config';

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
      patching,
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { kebabCase },
      system,
      template,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new fullstack workspace');

    // Hint for non-interactive callers (e.g. Claude Code)
    toolbox.tools.nonInteractiveHint(
      'lt fullstack init --name <name> --frontend <nuxt|angular> --api-mode <Rest|GraphQL|Both> --framework-mode <npm|vendor> [--framework-upstream-branch <ref>] [--next] [--dry-run] --noConfirm',
    );

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
    const configFrameworkMode = ltConfig?.commands?.fullstack?.frameworkMode as 'npm' | 'vendor' | undefined;

    // Parse CLI arguments
    const {
      'api-branch': cliApiBranch,
      'api-copy': cliApiCopy,
      'api-link': cliApiLink,
      'api-mode': cliApiMode,
      'dry-run': cliDryRun,
      'framework-mode': cliFrameworkMode,
      'framework-upstream-branch': cliFrameworkUpstreamBranch,
      frontend: cliFrontend,
      'frontend-branch': cliFrontendBranch,
      'frontend-copy': cliFrontendCopy,
      'frontend-framework-mode': cliFrontendFrameworkMode,
      'frontend-link': cliFrontendLink,
      git: cliGit,
      'git-link': cliGitLink,
      name: cliName,
      next: cliNext,
    } = parameters.options;

    const dryRun = cliDryRun === true || cliDryRun === 'true';
    const experimental = cliNext === true || cliNext === 'true';
    const frameworkUpstreamBranch =
      typeof cliFrameworkUpstreamBranch === 'string' && cliFrameworkUpstreamBranch.length > 0
        ? cliFrameworkUpstreamBranch
        : undefined;

    // Determine noConfirm with priority: CLI > command > parent > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.fullstack,
      config: ltConfig,
    });

    // Get name of the workspace
    const name =
      cliName ||
      (await helper.getInput(parameters.first, {
        name: 'workspace name',
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
    if (experimental) {
      apiMode = 'Rest';
      info('Using experimental nest-base template (Bun + Prisma + Postgres + Better-Auth)');
    } else if (cliApiMode) {
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

    // Determine framework-consumption mode (npm vs vendored)
    //
    //   npm    — classic: @lenne.tech/nest-server is an npm dependency. Framework
    //            source lives in node_modules/@lenne.tech/nest-server. Backend is
    //            cloned from nest-server-starter. Updates via
    //            `/lt-dev:backend:update-nest-server`.
    //
    //   vendor — pilot: the framework's core/ directory is copied directly into
    //            projects/api/src/core/ as first-class project code. No npm
    //            dependency. Backend is cloned from the nest-server framework repo
    //            itself and stripped of framework-internal content. Updates via
    //            `/lt-dev:backend:update-nest-server-core`; local patches are logged
    //            in src/core/VENDOR.md.
    //
    // Default is still 'npm' until the vendoring pilot is fully evaluated.
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
      info('Using default framework mode: npm (noConfirm mode)');
    } else {
      const frameworkModeChoice = await ask({
        choices: [
          'npm    - @lenne.tech/nest-server as npm dependency (classic, stable)',
          'vendor - framework core vendored into projects/api/src/core/ (pilot, allows local patches)',
        ],
        initial: 0,
        message: 'Framework consumption mode?',
        name: 'frameworkMode',
        type: 'select',
      });
      frameworkMode = frameworkModeChoice.frameworkMode.startsWith('vendor') ? 'vendor' : 'npm';
    }

    // ── Frontend framework mode ─────────────────────────────────────────
    const configFrontendFrameworkMode = ltConfig?.commands?.fullstack?.frontendFrameworkMode as
      | 'npm'
      | 'vendor'
      | undefined;

    let frontendFrameworkMode: 'npm' | 'vendor';
    if (cliFrontendFrameworkMode === 'npm' || cliFrontendFrameworkMode === 'vendor') {
      frontendFrameworkMode = cliFrontendFrameworkMode;
    } else if (cliFrontendFrameworkMode) {
      error(`Invalid --frontend-framework-mode value "${cliFrontendFrameworkMode}". Use "npm" or "vendor".`);
      return;
    } else if (configFrontendFrameworkMode === 'npm' || configFrontendFrameworkMode === 'vendor') {
      frontendFrameworkMode = configFrontendFrameworkMode;
      info(`Using frontend framework mode from lt.config: ${frontendFrameworkMode}`);
    } else if (noConfirm) {
      frontendFrameworkMode = 'npm';
    } else {
      // Default to npm without asking (unless user sets it explicitly)
      frontendFrameworkMode = 'npm';
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
      pushToRemote =
        parameters.third === 'true' || (await confirm('Push initial commit to a remote repository (dev branch)?'));

      if (pushToRemote) {
        gitLink =
          configGitLink ||
          (await helper.getInput(null, {
            name: 'git repository link',
            showError: true,
          }));
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

    // Dry-run mode: print the resolved plan and exit without any disk
    // changes. Useful for CI previews, for Claude Code confirmation
    // steps, and for debugging the mode-detection logic without
    // committing to a multi-minute init flow.
    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  name:                       ${name}`);
      info(`  projectDir:                 ${projectDir}`);
      info(`  frontend:                   ${frontend}`);
      info(`  apiMode:                    ${apiMode}`);
      info(`  frameworkMode:              ${frameworkMode}`);
      info(`  frontendFrameworkMode:      ${frontendFrameworkMode}`);
      if (frameworkUpstreamBranch) {
        info(`  frameworkUpstreamBranch:    ${frameworkUpstreamBranch}`);
      }
      info(`  apiBranch:                  ${apiBranch || '(default)'}`);
      info(`  frontendBranch:             ${frontendBranch || '(default)'}`);
      info(`  apiCopy:                    ${apiCopy || '(none)'}`);
      info(`  apiLink:                    ${apiLink || '(none)'}`);
      info(`  frontendCopy:               ${frontendCopy || '(none)'}`);
      info(`  frontendLink:               ${frontendLink || '(none)'}`);
      info(`  pushToRemote:               ${pushToRemote}`);
      if (pushToRemote) {
        info(`  gitLink:                    ${gitLink || '(unset — would abort at run-time)'}`);
      }
      info('');
      info('Would execute:');
      info(`  1. git clone lt-monorepo → ${projectDir}/`);
      info(`  2. setup frontend (${frontend}) → ${projectDir}/projects/app`);
      if (experimental) {
        info(`  3. clone nest-base (experimental) → ${projectDir}/projects/api`);
      } else if (frameworkMode === 'vendor') {
        info(`  3. clone nest-server-starter → ${projectDir}/projects/api`);
        info(
          `  4. clone @lenne.tech/nest-server${frameworkUpstreamBranch ? ` (branch/tag: ${frameworkUpstreamBranch})` : ''} → /tmp`,
        );
        info(`  5. vendor core/ + flatten-fix + codemod consumer imports`);
        info(`  6. merge upstream deps (dynamic, no hard-coded list)`);
        info(`  7. run processApiMode(${apiMode})`);
        if (apiMode === 'Rest') {
          info(`  8. restore vendored core essentials (graphql-*)`);
        }
      } else {
        info(`  3. clone nest-server-starter → ${projectDir}/projects/api`);
        info(`  4. run processApiMode(${apiMode})`);
      }
      if (frontendFrameworkMode === 'vendor') {
        info(`  M1. clone @lenne.tech/nuxt-extensions → /tmp`);
        info(`  M2. vendor app/core/ (module.ts + runtime/) + codemod consumer imports`);
        info(`  M3. rewrite nuxt.config.ts module entry`);
      }
      info('  N. pnpm install + initial git commit');
      info('');
      return `fullstack init dry-run (${frameworkMode} / ${apiMode})`;
    }

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

    // Patch root files for the project.
    //
    // For the classic flow we patch the cloned `lt-monorepo` CLAUDE.md with
    // template variables. For `--next` (experimental) we replace the root
    // README.md, CLAUDE.md, and create `.claude/QUICKSTART.md` outright,
    // because `lt-monorepo`'s root files describe the legacy MongoDB +
    // GraphQL stack which is explicitly out of scope for the nest-base
    // template — leaving them in place poisons every AI agent's context.
    if (experimental) {
      const nextTemplateProps = { name, projectDir };

      // Render new root files. `template.generate({ target })` overwrites
      // anything at `target`, which is what we want — the freshly cloned
      // monorepo's stale README/CLAUDE.md must be replaced wholesale.
      await template.generate({
        props: nextTemplateProps,
        target: `${projectDir}/README.md`,
        template: 'next-fullstack/README.md.ejs',
      });
      await template.generate({
        props: nextTemplateProps,
        target: `${projectDir}/CLAUDE.md`,
        template: 'next-fullstack/CLAUDE.md.ejs',
      });
      await template.generate({
        props: nextTemplateProps,
        target: `${projectDir}/.claude/QUICKSTART.md`,
        template: 'next-fullstack/.claude/QUICKSTART.md.ejs',
      });
    } else {
      const claudeMdPath = `${projectDir}/CLAUDE.md`;
      if (filesystem.exists(claudeMdPath)) {
        const frontendName = frontend === 'nuxt' ? 'Nuxt 4' : 'Angular';
        await patching.update(claudeMdPath, (content: string) =>
          content
            .replace(/\{\{PROJECT_NAME\}\}/g, () => name)
            .replace(/\{\{PROJECT_DIR\}\}/g, () => projectDir)
            .replace(/\{\{API_MODE\}\}/g, () => apiMode)
            .replace(/\{\{FRAMEWORK_MODE\}\}/g, () => frameworkMode)
            .replace(/\{\{FRONTEND_FRAMEWORK\}\}/g, () => frontendName),
        );
      }
    }

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

    // Patch frontend .env with project-specific values (skip for linked templates)
    if (frontendResult.method !== 'link') {
      frontendHelper.patchFrontendEnv(frontendDest, projectDir);
    }

    // ── Frontend vendoring (if requested) ───────────────────────────────
    if (isNuxt && frontendFrameworkMode === 'vendor' && frontendResult.method !== 'link') {
      const vendorSpinner = spin('Converting frontend to vendor mode...');
      try {
        await frontendHelper.convertAppCloneToVendored({
          dest: frontendDest,
          projectName: name,
        });
        vendorSpinner.succeed('Frontend converted to vendor mode (app/core/)');
      } catch (err) {
        vendorSpinner.fail(`Frontend vendor conversion failed: ${(err as Error).message}`);
        toolbox.print.warning('Continuing with npm mode for frontend.');
      }
    }

    // Remove gitkeep file
    filesystem.remove(`${projectDir}/projects/.gitkeep`);

    // Integrate files
    if (filesystem.isDirectory(`./${projectDir}/projects/app`)) {
      ngBaseSpinner.succeed(`Example for ${frontend} integrated`);

      // Include files from https://github.com/lenneTech/nest-server-starter
      const serverSpinner = spin(
        `Integrate Nest Server Starter${apiLink ? ' (link)' : apiCopy ? ' (copy)' : apiBranch ? ` (branch: ${apiBranch})` : ''}`,
      );

      // Setup API using Server extension
      const apiDest = `${projectDir}/projects/api`;
      const apiResult = await server.setupServerForFullstack(apiDest, {
        apiMode,
        branch: apiBranch,
        copyPath: apiCopy,
        experimental,
        frameworkMode,
        frameworkUpstreamBranch,
        linkPath: apiLink,
        name,
        projectDir,
      });

      if (!apiResult.success) {
        serverSpinner.fail(`Failed to set up API: ${apiResult.path}`);
        return;
      }

      // Auto-run `bun run rename <projectDir>` for the experimental nest-base
      // template. The template ships with hard-coded `nest-base` references in
      // four files (package.json, README.md, portless.yml, docker-compose.yml).
      // The rename script patches all four idempotently. Since the consumer
      // already gave us --name, doing this for them is strictly less
      // friction-prone than relying on a manual follow-up step (which agents
      // and humans both forget). Failure is non-fatal: the workspace is still
      // usable, the user can re-run `bun run rename <name>` manually.
      //
      // Note: setupServerForFullstack already patched projects/api/package.json
      // to set `name = projectDir`. The rename planner reads that name as the
      // "old" slug, which would short-circuit the README/portless/compose
      // rewrites because they still say `nest-base`. We restore the canonical
      // `name = "nest-base"` first so the planner has a coherent starting
      // state across all four files; the rename then writes the project name
      // into every spot consistently.
      if (experimental && apiResult.method !== 'link') {
        const apiPackageJsonPath = `${apiDest}/package.json`;
        if (filesystem.exists(apiPackageJsonPath)) {
          await patching.update(apiPackageJsonPath, (config: Record<string, unknown>) => {
            config.name = 'nest-base';
            return config;
          });
        }

        const renameSpinner = spin(`Rename nest-base → ${projectDir}`);
        try {
          await system.run(`cd ${apiDest} && bun run rename ${projectDir}`);
          renameSpinner.succeed(`Renamed nest-base → ${projectDir} in projects/api`);
        } catch (err) {
          renameSpinner.warn(
            `Auto-rename failed (${(err as Error).message}). Run \`bun run rename ${projectDir}\` manually inside projects/api.`,
          );
        }
      }

      // Create lt.config.json for API
      // Note: frameworkMode is persisted under meta so that subsequent `lt
      // server module` / `addProp` / `permissions` calls can detect the mode
      // without re-probing src/core/VENDOR.md each time (the VENDOR.md check
      // still works; this is just an explicit marker).
      const apiConfigPath = filesystem.path(apiDest, 'lt.config.json');
      filesystem.write(
        apiConfigPath,
        {
          commands: {
            server: {
              module: {
                controller: apiMode,
              },
            },
          },
          meta: {
            apiMode,
            frameworkMode,
            version: '1.0.0',
          },
        },
        { jsonIndent: 2 },
      );

      // Integrate files
      if (filesystem.isDirectory(`./${projectDir}/projects/api`)) {
        serverSpinner.succeed('Nest Server Starter integrated');
      } else {
        serverSpinner.warn('Nest Server Starter not integrated');
      }

      // Hoist workspace-scoped pnpm config out of sub-projects. pnpm only
      // honors `pnpm.overrides`, `pnpm.onlyBuiltDependencies`, and
      // `pnpm.ignoredOptionalDependencies` at the workspace root; leaving
      // them in projects/api/package.json or projects/app/package.json
      // causes `WARN The field … was found in … This will not take
      // effect. You should configure … at the root of the workspace
      // instead.` and silently disables CVE overrides.
      hoistWorkspacePnpmConfig({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });

      // Install all packages
      if (!experimental) {
        const installSpinner = spin('Install all packages');
        try {
          const detectedPm = toolbox.pm.detect(projectDir);
          await system.run(
            `cd ${projectDir} && ${toolbox.pm.install(detectedPm)} && ${toolbox.pm.run('init', detectedPm)}`,
          );
          installSpinner.succeed('Successfully installed all packages');
        } catch (err) {
          installSpinner.fail(`Failed to install packages: ${err.message}`);
          return;
        }
      } else {
        info('Skipping workspace install — run `bun install` (api) and `pnpm install` (app) manually.');
      }

      // Post-install format pass. processApiMode (run earlier in
      // setupServerForFullstack) and convertAppCloneToVendored rewrite
      // source files, leaving whitespace artifacts that oxfmt flags in
      // `pnpm run format:check` (multi-line arrays/imports after region
      // stripping, import-path rewrites that now fit single-line). The
      // formatter is only available after install, so we normalize here.
      if (!experimental && apiMode && filesystem.isDirectory(`${projectDir}/projects/api`)) {
        await toolbox.apiMode.formatProject(`${projectDir}/projects/api`);
      }
      if (!experimental && isNuxt && filesystem.isDirectory(`${projectDir}/projects/app`)) {
        await toolbox.apiMode.formatProject(`${projectDir}/projects/app`);
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
      if (experimental) {
        info(`  $ cd ${projectDir}`);
        info('  Frontend: cd projects/app && pnpm install');
        info('  API:      cd projects/api && bun install');
        info('  Configure projects/api/.env (see .env.example)');
        info('  Start Postgres + run prisma generate / migrate');
      } else {
        info(`  Run ${name}`);
        info(`  $ cd ${projectDir}`);
        info(`  $ ${toolbox.pm.run('start')}`);
      }
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
