import { filesystem as fs, GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { applyAgentNotesIgnorePolicy } from '../../lib/agent-notes-ignore';
import { caddyAvailable } from '../../lib/caddy';
import { CommandHelp } from '../../lib/command-help';
import { runMigrate } from '../../lib/dev-migrate-helper';
import { resolveLayout } from '../../lib/dev-project';
import { execArgs, spawnArgs } from '../../lib/exec-args';
import { failRun } from '../../lib/fail-run';
import { selectFrontendBlocks } from '../../lib/frontend-claude-blocks';
import { resolveFrontendFrameworkMode } from '../../lib/frontend-mode-resolution';
import { GIT_IDENTITY_FIX, gitIdentityProblem } from '../../lib/git-identity';
import { resolveLocalNgBaseBuild } from '../../lib/ng-base-vendor';
import { setPackageName, setPackageVersion } from '../../lib/package-name';
import { removeTemplateAgentMemory } from '../../lib/template-agent-memory';
import { healVendorClaudeMd } from '../../lib/vendor-claude-md';
import {
  detectWorkspaceLayout,
  finalizeWorkspaceRoot,
  reconfigureUpstreamForDownstream,
  reportWorkspaceConflicts,
} from '../../lib/workspace-integration';
import addApiCommand from './add-api';
import addAppCommand from './add-app';

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
      print: { colors, error, info, spin, success, warning },
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
      'lt fullstack init --name <name> --frontend <nuxt|angular> --api-mode <Rest|GraphQL|Both> --framework-mode <npm|vendor: workspace-wide, applies to API and frontend> [--frontend-framework-mode <npm|vendor>: overrides --framework-mode for the frontend only] [--framework-upstream-branch <ref>] [--frontend-framework-copy <path>: local ng-base checkout for Angular (vendor: copied source, npm: injected file: dependency on its build)] [--next: implies nuxt-base-starter#next unless --frontend-branch overrides] [--dry-run] --noConfirm',
    );

    // Check git
    if (!(await git.gitInstalled())) {
      failRun(toolbox);
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
    const configFrontendFrameworkCopy = ltConfig?.commands?.fullstack?.frontendFrameworkCopy;
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
      'frontend-framework-copy': cliFrontendFrameworkCopy,
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

    // ── Auto-detect existing workspace ─────────────────────────────────
    //
    // If `lt fullstack init` runs inside a directory that already looks
    // like a workspace (pnpm-workspace.yaml or projects/) and the user
    // didn't pass a workspace name, dispatch to the matching incremental
    // command instead of trying to clone a new lt-monorepo on top of the
    // existing one. Three branches:
    //
    //   - both projects/api and projects/app exist  → nothing to do.
    //   - only projects/app exists                  → delegate to add-api.
    //   - only projects/api exists                  → delegate to add-app.
    //
    // Users who really want to create a *new* workspace from inside an
    // existing one bypass detection by supplying `--name <slug>` (or a
    // positional argument); the slug then becomes the new project dir
    // and the original detection-skipping path runs normally.
    const noNameProvided = !cliName && !parameters.first;
    if (noNameProvided) {
      const cwdLayout = detectWorkspaceLayout('.', filesystem);
      if (cwdLayout.hasWorkspace) {
        if (cwdLayout.hasApi && cwdLayout.hasApp) {
          error('Workspace already has both projects/api and projects/app — nothing to add.');
          info('Use `lt fullstack add-api --help-json` or `lt fullstack add-app --help-json` to inspect options.');
          failRun(toolbox);
          return;
        }
        if (cwdLayout.hasApp && !cwdLayout.hasApi) {
          info('Detected existing workspace with projects/app — delegating to `lt fullstack add-api`.');
          // gluegun's `GluegunCommand.run` is typed as
          // `void | Promise<any>`. Cast through `unknown` so the await
          // is statically meaningful for our async implementations.
          return (await (addApiCommand.run as (t: ExtendedGluegunToolbox) => Promise<unknown>)(toolbox)) as string;
        }
        if (cwdLayout.hasApi && !cwdLayout.hasApp) {
          info('Detected existing workspace with projects/api — delegating to `lt fullstack add-app`.');
          return (await (addAppCommand.run as (t: ExtendedGluegunToolbox) => Promise<unknown>)(toolbox)) as string;
        }
        // Workspace dir but neither sub-project present — fall through
        // to normal init. The user can still pass --name to override.
      }
    }

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
      failRun(toolbox);
      return;
    }

    // Determine frontend with priority: CLI > config > interactive
    let frontend: string | undefined;
    if (cliFrontend) {
      frontend = cliFrontend === 'angular' ? 'angular' : cliFrontend === 'nuxt' ? 'nuxt' : null;
      if (!frontend) {
        error('Invalid frontend option. Use "angular" or "nuxt".');
        failRun(toolbox);
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
    // Default is 'vendor' — the lt CLI integrates the framework core directly
    // (clones the starter, vendors core into src/core/), which is the
    // recommended setup; pass `--framework-mode npm` for the classic npm dep.
    let frameworkMode: 'npm' | 'vendor';
    if (experimental) {
      frameworkMode = 'npm';
    } else if (cliFrameworkMode === 'npm' || cliFrameworkMode === 'vendor') {
      frameworkMode = cliFrameworkMode;
    } else if (cliFrameworkMode) {
      error(`Invalid --framework-mode value "${cliFrameworkMode}". Use "npm" or "vendor".`);
      failRun(toolbox);
      return;
    } else if (configFrameworkMode === 'npm' || configFrameworkMode === 'vendor') {
      frameworkMode = configFrameworkMode;
      info(`Using framework mode from lt.config: ${frameworkMode}`);
    } else if (noConfirm) {
      frameworkMode = 'vendor';
      info('Using default framework mode: vendor (noConfirm mode)');
    } else {
      const frameworkModeChoice = await ask({
        choices: [
          'npm    - @lenne.tech/nest-server as npm dependency (classic, stable)',
          'vendor - framework core vendored into projects/api/src/core/ (default, allows local patches)',
        ],
        initial: 1,
        message: 'Framework consumption mode?',
        name: 'frameworkMode',
        type: 'select',
      });
      frameworkMode = frameworkModeChoice.frameworkMode.startsWith('vendor') ? 'vendor' : 'npm';
    }

    // ── Frontend framework mode ─────────────────────────────────────────
    const configFrontendFrameworkMode = ltConfig?.commands?.fullstack?.frontendFrameworkMode as
      'npm' | 'vendor' | undefined;

    // Same rule as `lt fullstack add-app` (see frontend-mode-resolution.ts): the
    // frontend-specific flag, then the workspace-wide `--framework-mode`, then config,
    // then vendor. Consumers who genuinely want mixed modes pass `--frontend-framework-mode`.
    const frontendModeResolution = resolveFrontendFrameworkMode({
      cliFrameworkMode,
      cliFrontendFrameworkMode,
      configFrameworkMode,
      configFrontendFrameworkMode,
    });
    if (frontendModeResolution.error) {
      error(frontendModeResolution.error);
      failRun(toolbox);
      return;
    }
    const frontendFrameworkMode = frontendModeResolution.mode;
    if (frontendModeResolution.source && frontendModeResolution.source !== '--frontend-framework-mode') {
      info(`Using frontend framework mode from ${frontendModeResolution.source}: ${frontendFrameworkMode}`);
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
          // Git is always initialized locally (dev branch + initial commit);
          // --git only controls the remote push. Without a link there is
          // nothing to push to, so degrade to a local-only init instead of
          // aborting the whole scaffold — consistent with the config and
          // interactive branches below.
          warning('--git true without --git-link: initializing local git only (no remote push).');
          pushToRemote = false;
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
    } else if (noConfirm) {
      // Default in noConfirm mode: git true. Git is always initialized locally
      // (dev branch + initial commit); push to a remote only when a gitLink is
      // configured, otherwise stay local-only (nothing to push to).
      gitLink = configGitLink;
      pushToRemote = !!gitLink;
      info(
        `Using default git: true${gitLink ? ' (push to configured gitLink)' : ' (local only — no --git-link configured)'}`,
      );
    }

    // Determine branches and copy/link paths with priority: CLI > config
    const apiBranch = cliApiBranch || configApiBranch;
    // Under `--next`, default the nuxt-base-starter ref to the `next`
    // branch — that branch ships an auth basePath (`/api/auth`) that
    // matches the experimental nest-base API. Explicit
    // `--frontend-branch` (or lt.config) still wins so consumers can
    // target a custom branch on either line. Nuxt only: ng-base-starter
    // has no `next` branch, and cloning it would fail.
    const frontendBranch =
      cliFrontendBranch || configFrontendBranch || (experimental && frontend === 'nuxt' ? 'next' : undefined);
    const frontendFrameworkCopy =
      typeof cliFrontendFrameworkCopy === 'string' && cliFrontendFrameworkCopy
        ? cliFrontendFrameworkCopy
        : configFrontendFrameworkCopy;

    // A local ng-base in npm mode (Angular only, Nuxt ignores the option): an injected
    // `file:` dependency on its build. Refused here, before anything is written, when the
    // build is missing.
    let localNgBaseBuild: string | undefined;
    if (frontend === 'angular' && frontendFrameworkMode === 'npm' && frontendFrameworkCopy) {
      const build = resolveLocalNgBaseBuild(frontendFrameworkCopy);
      if (build.error) {
        error(build.error);
        failRun(toolbox);
        return;
      }
      localNgBaseBuild = build.distDir;
    }
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
      if (frontendFrameworkCopy && frontend === 'angular') {
        info(`  frontendFrameworkCopy:      ${frontendFrameworkCopy}`);
      }
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
          `  4. clone @lenne.tech/nest-server (${frameworkUpstreamBranch ? `branch/tag: ${frameworkUpstreamBranch}` : 'version pinned by the starter'}) → /tmp`,
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
      if (localNgBaseBuild) {
        info(`  M1. @lenne.tech/ng-base as injected file: dependency on ${localNgBaseBuild}`);
      } else if (frontendFrameworkMode === 'vendor' && frontend === 'angular') {
        info(
          frontendFrameworkCopy
            ? `  M1. copy @lenne.tech/ng-base from ${frontendFrameworkCopy} (working tree)`
            : `  M1. clone @lenne.tech/ng-base (tag of the version the starter pins) → /tmp`,
        );
        info(`  M2. vendor projects/ng-base → projects/app/src/core/ + tsconfig paths (no import rewrite)`);
      } else if (frontendFrameworkMode === 'vendor') {
        info(`  M1. clone @lenne.tech/nuxt-extensions → /tmp`);
        info(`  M2. vendor app/core/ (module.ts + runtime/) + codemod consumer imports`);
        info(`  M3. rewrite nuxt.config.ts module entry`);
      }
      info('  N. pnpm install + initial git commit');
      info('');
      return `fullstack init dry-run (${frameworkMode} / ${apiMode})`;
    }

    // The initial commit is the last step. Without an identity it failed only there, after the
    // whole workspace was built and installed (see git-identity.ts): ask git before the first write.
    const identityProblem = await gitIdentityProblem(filesystem.cwd());
    if (identityProblem) {
      error(`git cannot create the initial commit: ${identityProblem}`);
      info('Set your git identity once, then run the command again:');
      GIT_IDENTITY_FIX.forEach((line) => info(`  $ ${line}`));
      failRun(toolbox);
      return;
    }

    const workspaceSpinner = spin(`Create fullstack workspace with ${frontend} in ${projectDir} with ${name} app`);

    // Clone monorepo
    try {
      await execArgs('git', ['clone', '--', 'https://github.com/lenneTech/lt-monorepo.git', projectDir]);
    } catch (err) {
      workspaceSpinner.fail(`Failed to clone monorepo: ${err.message}`);
      failRun(toolbox);
      return;
    }

    // Check for directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      workspaceSpinner.fail(`The directory "${projectDir}" could not be created.`);
      failRun(toolbox);
      return;
    }

    workspaceSpinner.succeed(`Create fullstack workspace with ${frontend} in ${projectDir} for ${name} created`);

    // Include example app
    const ngBaseSpinner = spin(`Integrate example for ${frontend}`);

    // Remove git folder after clone
    filesystem.remove(`${projectDir}/.git`);
    // lt-monorepo's agent notes describe lt-monorepo, not the new project, and
    // would otherwise land in its initial commit.
    removeTemplateAgentMemory(projectDir);

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
        // Keep only the chosen frontend's `<!-- lt:frontend … -->` blocks (lt-monorepo).
        const selection = selectFrontendBlocks(filesystem.read(claudeMdPath) || '', frontend as 'angular' | 'nuxt');
        if (selection.problem) {
          warning(`CLAUDE.md: ${selection.problem} — left all frontend blocks in place.`);
        } else {
          filesystem.write(claudeMdPath, selection.content);
        }
        await patching.update(claudeMdPath, (content: string) =>
          content
            .replace(/\{\{PROJECT_NAME\}\}/g, () => name)
            .replace(/\{\{PROJECT_DIR\}\}/g, () => projectDir)
            .replace(/\{\{API_MODE\}\}/g, () => apiMode)
            .replace(/\{\{FRAMEWORK_MODE\}\}/g, () => frameworkMode)
            .replace(/\{\{FRONTEND_FRAMEWORK\}\}/g, () => frontendName),
        );
      }
      // The README carries the same blocks (lt-monorepo): without this an Angular workspace
      // explained the `NUXT_*` variables, and every workspace showed both quick starts.
      const readmePath = `${projectDir}/README.md`;
      if (filesystem.exists(readmePath)) {
        const selection = selectFrontendBlocks(filesystem.read(readmePath) || '', frontend as 'angular' | 'nuxt');
        if (selection.problem) {
          warning(`README.md: ${selection.problem} — left all frontend blocks in place.`);
        } else {
          filesystem.write(readmePath, selection.content);
        }
      }
    }

    // Rename the cloned monorepo's root package so each project gets a unique
    // `lt dev` slug. The slug is derived from package.json `name`; without
    // this rename every lt-monorepo-based project would register as
    // `lt-monorepo` and collide on `https://lt-monorepo.localhost`.
    setPackageName({ filesystem, name: projectDir, packageJsonPath: `${projectDir}/package.json` });
    // …and start it at its own version instead of the template's release
    // (`3.17.2`), which `lt status` would otherwise report as the project's.
    // `0.0.0` like the API's `src/meta.json`.
    setPackageVersion({ filesystem, packageJsonPath: `${projectDir}/package.json`, version: '0.0.0' });

    // Always initialize git
    try {
      // Argument lists, no shell: projectDir comes from --name, gitLink from a flag or lt.config.
      await execArgs('git', ['init', '--initial-branch=dev'], { cwd: projectDir });
    } catch (err) {
      ngBaseSpinner.fail(`Failed to initialize git: ${err.message}`);
      failRun(toolbox);
      return;
    }

    // Add remote if push is configured
    if (pushToRemote && gitLink) {
      try {
        await execArgs('git', ['remote', 'add', '--', 'origin', gitLink], { cwd: projectDir });
      } catch (err) {
        ngBaseSpinner.fail(`Failed to add remote: ${err.message}`);
        failRun(toolbox);
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
        localNgBaseBuild,
        siteName: name,
        skipGitInit: true, // Git is handled at monorepo level
        skipInstall: true, // Will install at monorepo level
        workspace: true, // `app` package name, no husky, no nested lockfile, no repo-only files
      });
    }

    if (!frontendResult.success) {
      ngBaseSpinner.fail(`Failed to set up ${frontend} frontend: ${frontendResult.path}`);
      failRun(toolbox);
      return;
    }

    // Patch frontend .env with project-specific values (skip for linked templates)
    if (frontendResult.method !== 'link') {
      frontendHelper.patchFrontendEnv(frontendDest, projectDir);
    }

    // ── Frontend vendoring (if requested) ───────────────────────────────
    // Set only when the conversion succeeded: a failed one continues in npm mode, and the
    // vendor notices below must then not claim a `core/` tree that does not exist.
    let frontendVendored = false;
    if (frontendFrameworkMode === 'vendor' && frontendResult.method !== 'link') {
      const vendorSpinner = spin('Converting frontend to vendor mode...');
      try {
        if (isNuxt) {
          await frontendHelper.convertAppCloneToVendored({
            dest: frontendDest,
            projectName: name,
          });
          vendorSpinner.succeed('Frontend converted to vendor mode (app/core/)');
          frontendVendored = true;
        } else {
          const vendored = await frontendHelper.convertAngularAppToVendored({
            dest: frontendDest,
            localSource: frontendFrameworkCopy,
            source: '`lt fullstack init`',
          });
          vendorSpinner.succeed(
            `Frontend converted to vendor mode (src/core/, @lenne.tech/ng-base ${vendored.version || '(version not detected)'})`,
          );
          frontendVendored = true;
        }
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
        failRun(toolbox);
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
          await spawnArgs('bun', ['run', 'rename', projectDir], { cwd: apiDest });
          renameSpinner.succeed(`Renamed nest-base → ${projectDir} in projects/api`);
        } catch (err) {
          renameSpinner.warn(
            `Auto-rename failed (${(err as Error).message}). Run \`bun run rename ${projectDir}\` manually inside projects/api.`,
          );
        }

        // Flip .claude/upstream.json from the template-self default to the
        // downstream shape so `/upstream-pr` can contribute core fixes back
        // to nest-base. Independent of the rename above — run it even if the
        // rename failed. Non-fatal when the file is absent.
        const upstreamResult = reconfigureUpstreamForDownstream({
          apiDir: apiDest,
          filesystem,
          upstreamBranch: apiBranch,
        });
        if (upstreamResult.updated) {
          info('Configured .claude/upstream.json for downstream contributions');
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

      // Normalize the workspace root. Hoists workspace-scoped pnpm config out
      // of the sub-projects (pnpm only honors `pnpm.overrides` etc. at the
      // root — otherwise CVE overrides are silently disabled), drops the
      // starters' standalone pnpm-lock.yaml files the root supersedes, and
      // guarantees a root `.dockerignore` (else the images carry the host's
      // node_modules, a stale .output, and a local .env that `nuxt build`
      // bakes in).
      // Two sources setting the same pnpm key to different values is not a merge
      // to resolve — it is a disagreement between two repos, and the merge would
      // pick one silently. Say so here, where both halves are still visible, and
      // again at the end (the install output below buries this one).
      const { conflicts } = finalizeWorkspaceRoot({ filesystem, projectDir });
      reportWorkspaceConflicts(conflicts, toolbox.print.warning);

      // The templates are public and keep their agent notes out of git; a
      // private project decides for itself, so the rule goes unless --public.
      if (!(await applyAgentNotesIgnorePolicy(toolbox, projectDir, { noConfirm }))) {
        failRun(toolbox);
        return;
      }

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
          failRun(toolbox);
          return;
        }
      } else {
        info('Skipping workspace install — run `bun install` (api) and `pnpm install` (app) manually.');
      }

      // Best-effort `lt dev init` so the workspace is ready for `lt dev up`
      // out-of-the-box: registers the slug in `~/.lenneTech/projects.json`,
      // injects the URL block into CLAUDE.md / AGENTS.md, patches
      // playwright.config.ts, adds `.lt-dev/` to .gitignore. Before the format
      // pass and the initial commit: run after the commit, its edits left every
      // new workspace with four modified files. Failures here are non-fatal —
      // `init` itself remains successful.
      let devMigrateOk = false;
      try {
        const layout = resolveLayout(projectDir, fs);
        const migrate = runMigrate({ layout });
        devMigrateOk = true;
        if (!migrate.alreadyMigrated) {
          info(colors.dim(`  registered "${migrate.identity.slug}" with \`lt dev\``));
        }
      } catch {
        /* best-effort — never block init */
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
      if (!experimental && filesystem.isDirectory(`${projectDir}/projects/app`)) {
        await toolbox.apiMode.formatProject(`${projectDir}/projects/app`);
      }

      // Sync the vendor-mode notice blocks across all CLAUDE.md files,
      // including the monorepo root — so a freshly scaffolded vendor project
      // tells Claude (and humans) how to update/contribute the vendored core
      // from the very first commit. Idempotent / no-op for npm-mode projects.
      healVendorClaudeMd(filesystem, {
        apiDir: `${projectDir}/projects/api`,
        appDir: `${projectDir}/projects/app`,
        backendVendor: frameworkMode === 'vendor',
        frontendKind: isNuxt ? 'nuxt' : 'angular',
        frontendVendor: frontendVendored,
        workspaceRoot: projectDir,
      });

      // Create initial commit after everything is set up
      try {
        await execArgs('git', ['add', '.'], { cwd: projectDir });
        await execArgs('git', ['commit', '-m', 'Initial commit'], { cwd: projectDir });
      } catch (err) {
        error(`Failed to create initial commit: ${err.message}`);
        failRun(toolbox);
        return;
      }

      // Push to remote if configured
      if (pushToRemote) {
        try {
          await execArgs('git', ['push', '-u', 'origin', 'dev'], { cwd: projectDir });
        } catch (err) {
          error(`Failed to push to remote: ${err.message}`);
          failRun(toolbox);
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
      reportWorkspaceConflicts(conflicts, toolbox.print.warning);
      info('Next:');
      if (experimental) {
        info(`  $ cd ${projectDir}`);
        info('  Frontend: cd projects/app && pnpm install');
        info('  API:      cd projects/api && bun install');
        info('  Configure projects/api/.env (see .env.example)');
        info('  Start Postgres + run prisma generate / migrate');
      } else {
        // The workspace's own package manager: detected from cwd (the parent directory), this
        // used to recommend `npm run start` for a pnpm workspace.
        const start = toolbox.pm.run('start', toolbox.pm.detect(projectDir));
        info(`  Run ${name}`);
        info(`  $ cd ${projectDir}`);
        if (devMigrateOk) {
          // Prefer lt dev up — sets up Caddy + HTTPS URLs + cross-wiring guards.
          const caddyOk = await caddyAvailable();
          if (caddyOk) {
            info('  $ lt dev up   # start API + App behind Caddy with project-specific URLs');
          } else {
            info('  $ lt dev install   # one-time per machine: verify Caddy + CA');
            info('  $ lt dev up        # then: start API + App behind Caddy');
          }
          info(colors.dim(`  (fallback: ${start} runs the classic localhost:3000/3001 mode)`));
        } else {
          info(`  $ ${start}`);
        }
      }
      info('');

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }

      // For tests
      return `new workspace ${projectDir} with ${name}`;
    } else {
      // The frontend setup reported success but left no `projects/app`. Without this
      // branch the command fell off the end here: no message, no failing exit code,
      // and `ngBaseSpinner` still spinning — which keeps the event loop alive (see
      // the spinner note in CLAUDE.md), so the process never returned at all.
      ngBaseSpinner.fail(`${frontend} was set up but "${projectDir}/projects/app" does not exist — cannot continue`);
      failRun(toolbox);
      return;
    }
  },
};

export const help: CommandHelp = {
  configuration:
    'commands.fullstack.{frontend, apiMode, frameworkMode, frontendFrameworkMode, apiBranch, frontendBranch, apiCopy, frontendCopy, apiLink, frontendLink, frontendFrameworkCopy, git, gitLink, noConfirm} in lt.config (CLI flags win).',
  description:
    'Create a fullstack workspace from lt-monorepo: projects/api (nest-server-starter) and projects/app (nuxt-base-starter or ng-base-starter), installed, registered with `lt dev` and committed. Inside a workspace that already has one half, it delegates to `lt fullstack add-api` / `add-app`.',
  examples: [
    'fullstack init --name shop --frontend nuxt --api-mode Rest --noConfirm',
    'fullstack init --name shop --frontend angular --api-mode Rest --frontend-framework-mode npm --noConfirm',
    'fullstack init --name shop --frontend angular --api-mode Rest --dry-run --noConfirm',
  ],
  features: [
    'Backend and frontend framework each in npm or vendor mode (vendor: the framework source is copied into the project).',
    'Keeps only the chosen frontend’s blocks in the root CLAUDE.md and README.md.',
    'Checks the git identity before writing anything; the initial commit leaves a clean working tree.',
  ],
  name: 'init',
  options: [
    { description: 'Project name', flag: '--name', type: 'string' },
    { description: 'Frontend framework', flag: '--frontend', type: 'string', values: ['angular', 'nuxt'] },
    { description: 'API mode of the backend', flag: '--api-mode', type: 'string', values: ['Rest', 'GraphQL', 'Both'] },
    {
      default: 'vendor',
      description: 'Backend framework consumption: npm dependency or core copied to src/core/',
      flag: '--framework-mode',
      type: 'string',
      values: ['npm', 'vendor'],
    },
    {
      description:
        'Upstream nest-server branch/tag to vendor from (only with --framework-mode vendor). Default: the version the starter pins',
      flag: '--framework-upstream-branch',
      type: 'string',
    },
    {
      default: 'vendor',
      description:
        'Frontend framework consumption: npm dependency, or copied into the app (Nuxt: app/core/, Angular: src/core/)',
      flag: '--frontend-framework-mode',
      type: 'string',
      values: ['npm', 'vendor'],
    },
    {
      description:
        'Angular only: local ng-base checkout. Vendor mode copies its working tree, npm mode injects its build as file: dependency',
      flag: '--frontend-framework-copy',
      type: 'string',
    },
    { description: 'Branch of nest-server-starter to use for the API', flag: '--api-branch', type: 'string' },
    { description: 'Copy the API from a local template directory', flag: '--api-copy', type: 'string' },
    {
      description: 'Symlink the API to a local template (changes affect the original)',
      flag: '--api-link',
      type: 'string',
    },
    { description: 'Branch of the frontend starter to use', flag: '--frontend-branch', type: 'string' },
    { description: 'Copy the frontend from a local template directory', flag: '--frontend-copy', type: 'string' },
    {
      description: 'Symlink the frontend to a local template (changes affect the original)',
      flag: '--frontend-link',
      type: 'string',
    },
    {
      description: 'Experimental: nest-base (Bun + Prisma + Postgres) as API instead of nest-server-starter',
      flag: '--next',
      type: 'boolean',
    },
    { description: 'Push the initial commit to a remote (git is always initialized)', flag: '--git', type: 'boolean' },
    { description: 'Git remote URL (required with --git)', flag: '--git-link', type: 'string' },
    {
      description: 'Public project: keep the templates’ rule that keeps agent notes (.claude/agent-memory) out of git',
      flag: '--public',
      type: 'boolean',
    },
    { description: 'Print the resolved plan without making any changes', flag: '--dry-run', type: 'boolean' },
    { description: 'Skip confirmation prompts', flag: '--noConfirm', type: 'boolean' },
  ],
};

export default NewCommand;
