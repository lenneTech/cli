import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { applyAgentNotesIgnorePolicy } from '../../lib/agent-notes-ignore';
import { failRun } from '../../lib/fail-run';
import { isVendoredProject } from '../../lib/framework-detection';
import { selectFrontendBlocks } from '../../lib/frontend-claude-blocks';
import { frontendKindLabel } from '../../lib/frontend-kind';
import { resolveFrontendFrameworkMode } from '../../lib/frontend-mode-resolution';
import { resolveLocalNgBaseBuild } from '../../lib/ng-base-vendor';
import { healVendorClaudeMd } from '../../lib/vendor-claude-md';
import {
  detectWorkspaceLayout,
  finalizeWorkspaceRoot,
  findWorkspaceRoot,
  reportWorkspaceConflicts,
} from '../../lib/workspace-integration';

/**
 * Add a frontend app (`projects/app/`) to a fullstack workspace that
 * currently only ships an API (`projects/api/`). Mirrors every
 * frontend-related flag from `lt fullstack init` so the surface area
 * stays in lockstep.
 *
 * Refuses to run if `projects/app/` already exists.
 */
export const help = {
  aliases: ['add-app'],
  configuration: 'commands.fullstack.*',
  description: 'Add a frontend app to an existing fullstack workspace',
  name: 'add-app',
  options: [
    { description: 'Frontend framework', flag: '--frontend', type: 'string', values: ['nuxt', 'angular'] },
    {
      description: 'Frontend framework consumption mode (default: vendor, as in `lt fullstack init`)',
      flag: '--frontend-framework-mode',
      type: 'string',
      values: ['npm', 'vendor'],
    },
    {
      description: 'Workspace-wide framework mode; applies when --frontend-framework-mode is not given',
      flag: '--framework-mode',
      type: 'string',
      values: ['npm', 'vendor'],
    },
    {
      description:
        'Angular: local ng-base checkout (vendor: its source is copied; npm: injected file: dependency on its build)',
      flag: '--frontend-framework-copy',
      type: 'string',
    },
    { description: 'Branch of the frontend starter to clone', flag: '--frontend-branch', type: 'string' },
    { description: 'Path to local frontend template to copy from', flag: '--frontend-copy', type: 'string' },
    { description: 'Path to local frontend template to symlink', flag: '--frontend-link', type: 'string' },
    { description: 'Use experimental nuxt-base-starter `next` branch (Nuxt only)', flag: '--next', type: 'boolean' },
    { description: 'Workspace root (defaults to cwd)', flag: '--workspace-dir', type: 'string' },
    { description: 'Skip install / format after app integration', flag: '--skip-install', type: 'boolean' },
    {
      description: 'Public project: keep the template rule that keeps agent notes out of git',
      flag: '--public',
      type: 'boolean',
    },
    { description: 'Print resolved plan and exit without disk changes', flag: '--dry-run', type: 'boolean' },
    { description: 'Skip all interactive prompts', flag: '--noConfirm', type: 'boolean' },
  ],
};

const NewCommand: GluegunCommand = {
  alias: ['add-app'],
  description: 'Add app to fullstack workspace',
  hidden: false,
  name: 'add-app',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      frontendHelper,
      git,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { ask },
      system,
    } = toolbox;

    if (toolbox.tools.helpJson(help)) {
      return;
    }

    const timer = system.startTimer();
    info('Add app to fullstack workspace');
    toolbox.tools.nonInteractiveHint(
      'lt fullstack add-app --frontend <nuxt|angular> [--frontend-branch <ref>] [--next] [--dry-run] --noConfirm',
    );

    if (!(await git.gitInstalled())) {
      failRun(toolbox);
      return;
    }

    const ltConfig = config.loadConfig();

    const cliFrontend = parameters.options.frontend;
    const cliFrontendFrameworkMode = parameters.options['frontend-framework-mode'] as 'npm' | 'vendor' | undefined;
    const cliFrontendBranch = parameters.options['frontend-branch'] as string | undefined;
    const cliFrontendCopy = parameters.options['frontend-copy'] as string | undefined;
    const cliFrontendLink = parameters.options['frontend-link'] as string | undefined;
    const cliFrontendFrameworkCopy = parameters.options['frontend-framework-copy'] as string | undefined;
    const cliWorkspaceDir = parameters.options['workspace-dir'] as string | undefined;
    const cliDryRun = parameters.options['dry-run'];
    const cliSkipInstall = parameters.options['skip-install'];
    const experimental = parameters.options.next === true || parameters.options.next === 'true';
    const dryRun = cliDryRun === true || cliDryRun === 'true';
    const skipInstall = cliSkipInstall === true || cliSkipInstall === 'true';

    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.fullstack,
      config: ltConfig,
    });

    const configFrontend = ltConfig?.commands?.fullstack?.frontend;
    const configFrontendFrameworkMode = ltConfig?.commands?.fullstack?.frontendFrameworkMode as
      'npm' | 'vendor' | undefined;
    const configFrontendBranch = ltConfig?.commands?.fullstack?.frontendBranch;
    const configFrontendCopy = ltConfig?.commands?.fullstack?.frontendCopy;
    const configFrontendLink = ltConfig?.commands?.fullstack?.frontendLink;
    const configFrontendFrameworkCopy = ltConfig?.commands?.fullstack?.frontendFrameworkCopy;
    const configFrameworkMode = ltConfig?.commands?.fullstack?.frameworkMode;

    // Workspace detection — same priority as `add-api`:
    //   1. explicit `--workspace-dir <path>` always wins
    //   2. cwd if it itself is a workspace
    //   3. nearest workspace by walking up from cwd (so users running
    //      from inside `projects/api/src/` don't have to pass
    //      `--workspace-dir ../..`)
    let workspaceDir: string;
    if (cliWorkspaceDir) {
      workspaceDir = cliWorkspaceDir;
    } else {
      const cwdLayout = detectWorkspaceLayout('.', filesystem);
      if (cwdLayout.hasWorkspace) {
        workspaceDir = '.';
      } else {
        const upRoot = findWorkspaceRoot('.', filesystem);
        if (upRoot) {
          workspaceDir = upRoot;
          info(`Detected fullstack workspace at ${upRoot} (walked up from cwd).`);
        } else {
          workspaceDir = '.';
        }
      }
    }
    const layout = detectWorkspaceLayout(workspaceDir, filesystem);

    if (!layout.hasWorkspace) {
      error(
        `No fullstack workspace detected at "${workspaceDir}". Expected pnpm-workspace.yaml, package.json#workspaces, or a projects/ directory. Use \`lt fullstack init\` for a fresh workspace.`,
      );
      failRun(toolbox);
      return;
    }
    if (layout.hasApp) {
      error(
        `An app already exists at "${workspaceDir}/projects/app". Remove it first or use \`lt fullstack init\` in a fresh directory.`,
      );
      failRun(toolbox);
      return;
    }

    // Resolve frontend.
    let frontend: 'angular' | 'nuxt' | undefined;
    if (cliFrontend === 'angular' || cliFrontend === 'nuxt') {
      frontend = cliFrontend;
    } else if (cliFrontend) {
      error('Invalid --frontend option. Use "angular" or "nuxt".');
      failRun(toolbox);
      return;
    } else if (configFrontend === 'angular' || configFrontend === 'nuxt') {
      frontend = configFrontend;
      info(`Using frontend from lt.config: ${frontend}`);
    } else if (noConfirm) {
      frontend = 'nuxt';
      info('Using default frontend: nuxt (noConfirm mode)');
    } else {
      const choice = await ask({
        choices: ['angular', 'nuxt'],
        initial: 1,
        message: 'Which frontend framework?',
        name: 'frontend',
        type: 'select',
      });
      frontend = (choice.frontend === 'angular' ? 'angular' : 'nuxt') as 'angular' | 'nuxt';
    }

    // Resolve frontend framework mode — the same rule as `lt fullstack init`
    // (frontend-mode-resolution.ts), so an app added later gets the mode a fresh
    // workspace would have given it. Default: vendor.
    const modeResolution = resolveFrontendFrameworkMode({
      cliFrameworkMode: parameters.options['framework-mode'],
      cliFrontendFrameworkMode,
      configFrameworkMode,
      configFrontendFrameworkMode,
    });
    if (modeResolution.error) {
      error(modeResolution.error);
      failRun(toolbox);
      return;
    }
    const frontendFrameworkMode = modeResolution.mode;
    if (modeResolution.source && modeResolution.source !== '--frontend-framework-mode') {
      info(`Using frontend framework mode from ${modeResolution.source}: ${frontendFrameworkMode}`);
    }

    // Branch / copy / link with the same `--next` default that init.ts
    // applies: under `--next`, default the nuxt-base-starter ref to the
    // `next` branch (auth basePath aligned with the experimental API).
    const frontendBranch =
      cliFrontendBranch || configFrontendBranch || (experimental && frontend === 'nuxt' ? 'next' : undefined);
    const frontendCopy = cliFrontendCopy || configFrontendCopy;
    const frontendLink = cliFrontendLink || configFrontendLink;
    const frontendFrameworkCopy = cliFrontendFrameworkCopy || configFrontendFrameworkCopy;

    // A local ng-base in npm mode (Angular only, Nuxt ignores the option): an injected
    // `file:` dependency on its build, refused before anything is written when it is missing.
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

    // Derive a project name (kebab-case workspace slug) for env patching.
    let projectName = parameters.options.name as string | undefined;
    if (!projectName) {
      const apiPkgPath = filesystem.path(workspaceDir, 'projects', 'api', 'package.json');
      if (filesystem.exists(apiPkgPath)) {
        const apiPkg = filesystem.read(apiPkgPath, 'json') as null | Record<string, unknown>;
        if (apiPkg && typeof apiPkg.name === 'string' && apiPkg.name) {
          projectName = apiPkg.name;
        }
      }
    }
    if (!projectName) {
      const segments = filesystem.path(workspaceDir).split(/[\\/]/).filter(Boolean);
      projectName = segments[segments.length - 1] || 'fullstack-app';
    }

    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  workspaceDir:               ${workspaceDir}`);
      info(`  projectName:                ${projectName}`);
      info(`  frontend:                   ${frontend}`);
      info(`  frontendFrameworkMode:      ${frontendFrameworkMode}`);
      info(`  frontendBranch:             ${frontendBranch || '(default)'}`);
      info(`  frontendCopy:               ${frontendCopy || '(none)'}`);
      info(`  frontendLink:               ${frontendLink || '(none)'}`);
      info(`  experimental (--next):      ${experimental}`);
      info('');
      info('Would execute:');
      info(`  1. setup ${frontend} → ${workspaceDir}/projects/app`);
      if (frontend === 'nuxt' && frontendFrameworkMode === 'vendor') {
        info(`  2. clone @lenne.tech/nuxt-extensions → /tmp`);
        info(`  3. vendor app/core/ (module.ts + runtime/)`);
        info(`  4. rewrite nuxt.config.ts module entry`);
      } else if (localNgBaseBuild) {
        info(`  2. @lenne.tech/ng-base as injected file: dependency on ${localNgBaseBuild}`);
      } else if (frontendFrameworkMode === 'vendor') {
        info(
          frontendFrameworkCopy
            ? `  2. copy @lenne.tech/ng-base from ${frontendFrameworkCopy} (working tree)`
            : `  2. clone @lenne.tech/ng-base (tag of the version the starter pins) → /tmp`,
        );
        info(`  3. vendor projects/ng-base → projects/app/src/core/ + tsconfig paths (no import rewrite)`);
      }
      info(`  N. patch projects/app/.env with the storage prefix and CLAUDE.md with the frontend blocks`);
      if (!skipInstall) info(`  M. pnpm install + format projects/app`);
      info('');
      return `fullstack add-app dry-run (${frontend} / ${frontendFrameworkMode})`;
    }

    const appDest = `${workspaceDir}/projects/app`;
    const appSpinner = spin(
      `Integrate ${frontend}${frontendLink ? ' (link)' : frontendCopy ? ' (copy)' : frontendBranch ? ` (branch: ${frontendBranch})` : ''}`,
    );

    const isNuxt = frontend === 'nuxt';
    const result = isNuxt
      ? await frontendHelper.setupNuxt(appDest, {
          branch: frontendBranch,
          copyPath: frontendCopy,
          linkPath: frontendLink,
          skipInstall: true,
        })
      : await frontendHelper.setupAngular(appDest, {
          branch: frontendBranch,
          copyPath: frontendCopy,
          linkPath: frontendLink,
          localNgBaseBuild,
          skipGitInit: true,
          skipInstall: true,
          workspace: true,
        });

    if (!result.success) {
      appSpinner.fail(`Failed to set up ${frontend} frontend: ${result.path}`);
      failRun(toolbox);
      return;
    }
    appSpinner.succeed(`${frontend} integrated (${result.method})`);

    // Patch frontend .env (skip on link mode — points at user's checkout).
    if (result.method !== 'link') {
      frontendHelper.patchFrontendEnv(appDest, projectName);
    }

    // Vendor frontend if requested. Skipped on link mode for the same
    // reason as `init.ts`.
    let frontendVendored = false;
    if (frontendFrameworkMode === 'vendor' && result.method !== 'link') {
      const vendorSpinner = spin('Converting frontend to vendor mode...');
      try {
        if (isNuxt) {
          await frontendHelper.convertAppCloneToVendored({
            dest: appDest,
            projectName,
          });
          vendorSpinner.succeed('Frontend converted to vendor mode (app/core/)');
        } else {
          const vendored = await frontendHelper.convertAngularAppToVendored({
            dest: appDest,
            localSource: frontendFrameworkCopy,
            source: '`lt fullstack add-app`',
          });
          vendorSpinner.succeed(
            `Frontend converted to vendor mode (src/core/, @lenne.tech/ng-base ${vendored.version || '(version not detected)'})`,
          );
        }
        frontendVendored = true;
      } catch (err) {
        vendorSpinner.fail(`Frontend vendor conversion failed: ${(err as Error).message}`);
        warning('Continuing with npm mode for frontend.');
      }
    }

    // The workspace CLAUDE.md: keep only this frontend's `<!-- lt:frontend … -->`
    // blocks, fill `{{FRONTEND_FRAMEWORK}}`, and sync the vendor notices — the same
    // state `lt fullstack init` leaves behind.
    const rootClaudeMd = filesystem.path(workspaceDir, 'CLAUDE.md');
    if (filesystem.exists(rootClaudeMd)) {
      const selection = selectFrontendBlocks(filesystem.read(rootClaudeMd) || '', frontend);
      if (selection.problem) {
        warning(`CLAUDE.md: ${selection.problem} — left all frontend blocks in place.`);
      }
      const next = selection.content.replace(/\{\{FRONTEND_FRAMEWORK\}\}/g, () => frontendKindLabel(frontend));
      if (next !== filesystem.read(rootClaudeMd)) {
        filesystem.write(rootClaudeMd, next);
      }
    }
    healVendorClaudeMd(filesystem, {
      apiDir: filesystem.path(workspaceDir, 'projects', 'api'),
      appDir: appDest,
      backendVendor: isVendoredProject(filesystem.path(workspaceDir, 'projects', 'api')),
      frontendKind: frontend,
      frontendVendor: frontendVendored,
      workspaceRoot: workspaceDir,
    });

    // Normalize the workspace root: hoist pnpm config (frontend templates may
    // carry pnpm.overrides too), drop the frontend starter's standalone
    // pnpm-lock.yaml the root supersedes, and guarantee a root `.dockerignore`
    // (else the image inherits the host's node_modules, .output and .env).
    // A disagreement between the two repos is not something the merge may decide
    // silently. Reported here, and repeated in the closing block — this call site
    // sits directly above the install output that would otherwise bury it.
    const { conflicts } = finalizeWorkspaceRoot({ filesystem, projectDir: workspaceDir });
    reportWorkspaceConflicts(conflicts, toolbox.print.warning);

    // Only the new sub-project: the root `.gitignore` belongs to the workspace.
    if (!(await applyAgentNotesIgnorePolicy(toolbox, appDest, { noConfirm }))) {
      failRun(toolbox);
      return;
    }

    if (!skipInstall) {
      const installSpinner = spin('Install workspace packages');
      try {
        const detectedPm = toolbox.pm.detect(workspaceDir);
        await system.run(toolbox.pm.install(detectedPm), { cwd: workspaceDir });
        installSpinner.succeed('Successfully installed workspace packages');
      } catch (err) {
        installSpinner.fail(`Failed to install packages: ${(err as Error).message}`);
        warning('Run install manually after fixing the issue.');
      }

      if (filesystem.isDirectory(appDest)) {
        await toolbox.apiMode.formatProject(appDest);
      }
    }

    info('');
    success(`App integrated into ${workspaceDir} in ${toolbox.helper.msToMinutesAndSeconds(timer())}m.`);
    info('');
    reportWorkspaceConflicts(conflicts, toolbox.print.warning);
    info('Next:');
    info(`  $ cd ${workspaceDir}`);
    info(`  $ ${toolbox.pm.run('start')}`);
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `added app to workspace ${workspaceDir}`;
  },
};

export default NewCommand;
