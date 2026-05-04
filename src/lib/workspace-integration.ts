/**
 * Helpers for integrating an API (`projects/api/`) or an App
 * (`projects/app/`) into a fullstack workspace. Used by `lt fullstack
 * init` (full-workspace flow) and by `lt fullstack add-api` /
 * `lt fullstack add-app` (incremental flow on an already-existing
 * workspace that only ships one half of the stack).
 *
 * The functions here own the small amount of "monorepo glue" that sits
 * between the framework-agnostic setup primitives in
 * `extensions/server.ts` and `extensions/frontend-helper.ts`:
 *
 *   - writing `projects/api/lt.config.json` with the resolved api/
 *     framework mode so that follow-up generators (lt server module
 *     etc.) pick it up without re-probing,
 *   - patching the frontend `.env` with the project-specific storage
 *     prefix,
 *   - running the experimental `bun run rename` step for the
 *     `--next` nest-base template,
 *   - running the post-install format pass on the touched sub-project,
 *
 * They deliberately do NOT manage workspace-level concerns
 * (lt-monorepo clone, root CLAUDE.md patching, top-level pnpm install,
 * git initialisation). Those stay in `commands/fullstack/init.ts`
 * because they only happen once per workspace creation. add-api /
 * add-app run on an already-installed workspace and only need to wire
 * in the new sub-project plus run a workspace-wide install.
 */

import type { GluegunFilesystem, GluegunPatching } from 'gluegun';

/**
 * Options accepted by `addApiToWorkspace`. Mirrors the API-related
 * flags exposed by `lt fullstack init` so add-api can offer the same
 * surface area.
 */
export interface AddApiOptions {
  apiMode: 'Both' | 'GraphQL' | 'Rest';
  branch?: string;
  copyPath?: string;
  experimental?: boolean;
  frameworkMode: 'npm' | 'vendor';
  frameworkUpstreamBranch?: string;
  linkPath?: string;
  /** Project name used to derive `<name>-api-server` etc. */
  name: string;
  /** Workspace root, e.g. "." or "/abs/path/to/workspace". */
  workspaceDir: string;
}

/**
 * Options accepted by `addAppToWorkspace`. Mirrors the frontend-related
 * flags exposed by `lt fullstack init`.
 */
export interface AddAppOptions {
  branch?: string;
  copyPath?: string;
  /** Frontend kind. Drives which template is cloned. */
  frontend: 'angular' | 'nuxt';
  frontendFrameworkMode: 'npm' | 'vendor';
  linkPath?: string;
  /** Project name. */
  name: string;
  /** Workspace root. */
  workspaceDir: string;
}

/**
 * Result of a standalone-vs-workspace gate check. Used by `lt server
 * create`, `lt frontend nuxt`, and `lt frontend angular` to decide
 * whether to proceed, prompt, or refuse outright.
 */
export interface StandaloneGateDecision {
  /** Whether the standalone command should continue. */
  proceed: boolean;
  /** A user-facing message that explains the decision (always present
   *  when `proceed === false`). The caller prints it via `error()`. */
  reason?: string;
}

/**
 * Layout of an existing fullstack workspace.
 */
export interface WorkspaceLayout {
  /** True if `projects/api/` exists and looks like a NestJS server. */
  hasApi: boolean;
  /** True if `projects/app/` exists and looks like a frontend app. */
  hasApp: boolean;
  /**
   * True if the directory looks like an lt-monorepo workspace
   * (contains `pnpm-workspace.yaml` or a `projects/` directory).
   */
  hasWorkspace: boolean;
  /** Absolute or relative workspace root path that was probed. */
  workspaceDir: string;
}

/**
 * Detect whether the current working directory IS a sub-project of an
 * lt-monorepo workspace (i.e. cwd is `projects/api/` or `projects/app/`,
 * or any nested directory thereof). Returns the workspace root + the
 * sub-project kind so the caller can give a precise hint like
 * "you're inside projects/api — go up to the workspace root".
 *
 * Returns `null` when cwd is not inside such a sub-project.
 */
export function detectSubProjectContext(
  startDir: string,
  filesystem: GluegunFilesystem,
): null | { kind: 'api' | 'app'; subProjectDir: string; workspaceRoot: string } {
  const root = findWorkspaceRoot(startDir, filesystem);
  if (!root) return null;
  // If the start dir IS the root, we're not inside a sub-project.
  if (root === startDir) return null;

  const apiDir = filesystem.path(root, 'projects', 'api');
  const appDir = filesystem.path(root, 'projects', 'app');

  // Resolve absolute prefixes for a clean startsWith compare. We use
  // the gluegun-resolved paths because all callers go through it.
  const startAbs = filesystem.path(startDir);
  if (startAbs === apiDir || startAbs.startsWith(`${apiDir}/`)) {
    return { kind: 'api', subProjectDir: apiDir, workspaceRoot: root };
  }
  if (startAbs === appDir || startAbs.startsWith(`${appDir}/`)) {
    return { kind: 'app', subProjectDir: appDir, workspaceRoot: root };
  }
  return null;
}

/**
 * Detect what's already present in a workspace directory. Used by the
 * fullstack commands to decide whether to perform a full init, only
 * add the missing sub-project, or refuse because both halves already
 * exist.
 */
export function detectWorkspaceLayout(workspaceDir: string, filesystem: GluegunFilesystem): WorkspaceLayout {
  const projectsDir = `${workspaceDir}/projects`;
  const apiDir = `${projectsDir}/api`;
  const appDir = `${projectsDir}/app`;

  // `hasWorkspaceMarker` covers pnpm-workspace.yaml, npm/yarn
  // `workspaces` in package.json, and the `projects/` directory
  // convention. Mirrors what `findWorkspaceRoot` walks for.
  const hasWorkspace = hasWorkspaceMarker(workspaceDir, filesystem);

  // For "hasApi"/"hasApp", a directory existing is not enough — empty
  // or stub directories from a partially-cloned monorepo would yield
  // false positives. Require at least a package.json inside.
  const hasApi = filesystem.exists(`${apiDir}/package.json`) === 'file';
  const hasApp = filesystem.exists(`${appDir}/package.json`) === 'file';

  return { hasApi, hasApp, hasWorkspace, workspaceDir };
}

/**
 * Walk up from `startDir` until a workspace marker is found or the
 * filesystem root is reached. Limited to 6 levels to avoid pathological
 * scans on deeply-nested CWDs (e.g. inside a temp dir hierarchy).
 *
 * Returns the directory that contains the marker, or `null` if none
 * was found within the search budget. Used by the standalone commands
 * to detect the case "user is inside `projects/api/` and ran
 * `lt frontend nuxt` there".
 */
export function findWorkspaceRoot(startDir: string, filesystem: GluegunFilesystem, maxDepth = 6): null | string {
  // Resolve to an absolute path so the parent traversal is reliable.
  // gluegun's filesystem.path is a join helper; we want the OS path.
  let cur = startDir;
  // First check the start dir itself.
  if (hasWorkspaceMarker(cur, filesystem)) return cur;

  for (let i = 0; i < maxDepth; i++) {
    const parent = filesystem.path(cur, '..');
    if (parent === cur) return null;
    if (hasWorkspaceMarker(parent, filesystem)) return parent;
    cur = parent;
  }
  return null;
}

/**
 * Treat the caller as "non-interactive" (KI/CI) when either
 *   - `--noConfirm` was passed explicitly, OR
 *   - stdin is not a TTY (typical for `claude < script.txt`, piped CI
 *     runs, or any agent that captures the CLI's stdout).
 *
 * The TTY check catches AI agents that call `lt …` without
 * `--noConfirm` (Claude Code does this) and would otherwise hit the
 * `confirm()` prompt forever. Caller can opt out via `force`.
 *
 * Exposed so commands can derive their `noConfirm` value once and
 * pass the same boolean to `shouldProceedAsStandalone`.
 */
export function isNonInteractive(noConfirmFlag: boolean): boolean {
  if (noConfirmFlag) return true;
  // process.stdin may be undefined in some test runners — guard.
  return Boolean(process.stdin && process.stdin.isTTY === false);
}

/**
 * Run the experimental `bun run rename <projectDir>` step. Only relevant
 * for the `--next` nest-base template (it ships hard-coded `nest-base`
 * references in package.json, README.md, portless.yml, and
 * docker-compose.yml). Failures are non-fatal — the workspace is still
 * usable, and the user can re-run the rename script manually.
 *
 * Returns true if the step was attempted (regardless of success). The
 * caller decides whether to surface a warning.
 */
export async function runExperimentalNestBaseRename(options: {
  apiDir: string;
  patching: GluegunPatching;
  projectDir: string;
  /** Same shape as gluegun's `system` toolbox member. */
  system: { run: (cmd: string) => Promise<string> };
}): Promise<{ attempted: boolean; error?: Error }> {
  const { apiDir, patching, projectDir, system } = options;

  // setupServerForFullstack already patched package.json to set
  // `name = projectDir`. The rename planner reads that name as the
  // "old" slug, which would short-circuit the rest of the rewrites
  // because they still say `nest-base`. Restore the canonical
  // `name = "nest-base"` first so the planner has a coherent starting
  // state across all four files.
  await patching.update(`${apiDir}/package.json`, (config: Record<string, unknown>) => {
    config.name = 'nest-base';
    return config;
  });

  try {
    await system.run(`cd ${apiDir} && bun run rename ${projectDir}`);
    return { attempted: true };
  } catch (err) {
    return { attempted: true, error: err as Error };
  }
}

/**
 * Print + prompt + decision for a standalone scaffolding command's
 * workspace gate. Centralises the ~25 lines of identical logic that
 * `lt server create`, `lt frontend nuxt`, and `lt frontend angular`
 * each had inline.
 *
 * Side effects (intentionally bundled — easier to reason about as one
 * unit, and the three commands all want the same shape):
 *   - prints the workspace-detected note + sub-project hint
 *   - asks the user via `confirm()` when interactive
 *   - prints the refusal/abort reason via `print.error` when refused
 *   - calls `process.exit(1)` on refusal (unless `fromGluegunMenu`)
 *
 * Returns `true` when the caller may proceed, `false` when the caller
 * has already been told to abort and should `return` from its `run`.
 *
 * The shape stays narrow on purpose — adding more knobs (e.g.
 * "abort message format") would just push the duplication elsewhere.
 */
export async function runStandaloneWorkspaceGate(options: {
  /** Path to probe (typically the cwd). */
  cwd: string;
  filesystem: GluegunFilesystem;
  force: boolean;
  fromGluegunMenu: boolean;
  noConfirmFlag: boolean;
  /** "API" → `projects/api`, "app" → `projects/app`. Drives the hint. */
  pieceName: 'api' | 'app';
  /**
   * Toolbox print helpers + confirm. Passed in rather than imported
   * to avoid a circular dependency on `ExtendedGluegunToolbox`.
   */
  print: {
    confirm: (message: string, initial?: boolean) => Promise<boolean>;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
  /** Verb shown in the refusal message (e.g. "Nuxt app", "server"). */
  projectKind: string;
  /** Workspace-aware replacement command (e.g. `lt fullstack add-api`). */
  suggestion: string;
}): Promise<boolean> {
  const {
    cwd,
    filesystem,
    force,
    fromGluegunMenu,
    noConfirmFlag,
    pieceName,
    print: { confirm, error, info },
    projectKind,
    suggestion,
  } = options;

  // Sub-project hint: if the user is inside `projects/api/` or
  // `projects/app/` of a workspace, point them at the root explicitly
  // — the standalone path would otherwise clone a sibling tree
  // *inside* the existing sub-project, which is almost never wanted.
  const subProject = detectSubProjectContext(cwd, filesystem);
  if (subProject) {
    info('');
    info(`You appear to be inside projects/${subProject.kind}/ of a workspace at ${subProject.workspaceRoot}.`);
    info(`  → Run \`${suggestion}\` from the workspace root instead.`);
    error(`Refusing to create a standalone ${projectKind} from inside a sub-project. cd to the workspace root first.`);
    if (!fromGluegunMenu) process.exit(1);
    return false;
  }

  const layout = detectWorkspaceLayout(cwd, filesystem);
  if (!layout.hasWorkspace) {
    return true; // Plain dir → standalone is fine, no gate.
  }

  const alreadyHas = pieceName === 'api' ? layout.hasApi : layout.hasApp;
  info('');
  info(
    'Note: current directory looks like a fullstack workspace (pnpm-workspace.yaml, package.json#workspaces, or projects/).',
  );
  if (!alreadyHas) {
    info(`  → To integrate the ${pieceName} into this workspace, use \`${suggestion}\`.`);
  } else {
    info(
      `  → projects/${pieceName}/ already exists in this workspace; this command would create a separate ${projectKind}.`,
    );
  }

  const nonInteractive = isNonInteractive(noConfirmFlag);
  const userConfirmed = nonInteractive
    ? undefined
    : await confirm(`Proceed with standalone ${projectKind} creation anyway?`, false);

  const decision = shouldProceedAsStandalone({
    force,
    nonInteractive,
    projectKind,
    suggestion,
    userConfirmed,
  });

  if (!decision.proceed) {
    error(decision.reason ?? 'Aborted.');
    if (!fromGluegunMenu) process.exit(1);
    return false;
  }
  if (nonInteractive && force) {
    info('  --force set — continuing despite workspace context.');
  }
  info('');
  return true;
}

/**
 * Decide whether a standalone scaffolding command (`lt server create`,
 * `lt frontend nuxt`, `lt frontend angular`) should run inside a
 * directory that already looks like a fullstack workspace.
 *
 * Three modes:
 *
 *   - **interactive** (the user can answer a prompt) — caller asks via
 *     `confirm()` and passes the result as `userConfirmed`.
 *   - **non-interactive without force** — refuse. This is the path AI
 *     agents and CI scripts take by default (either `--noConfirm` was
 *     set, or stdin isn't a TTY). Forcing them onto the workspace-
 *     aware command (`add-api` / `add-app`) prevents stray side-by-
 *     side clones that pnpm-workspace.yaml does not pick up.
 *   - **non-interactive with --force** — proceed, but the caller
 *     should log a hint so the override is visible in CI logs.
 *
 * The function does NOT print or prompt. It only decides; the caller
 * owns the interaction surface.
 */
export function shouldProceedAsStandalone(options: {
  force: boolean;
  /**
   * Whether the caller is non-interactive (`--noConfirm` OR stdin
   * not a TTY). Use `isNonInteractive(noConfirmFlag)` to derive.
   */
  nonInteractive: boolean;
  /**
   * Caller's resolved verb for the kind of project being created
   * ('API', 'app', 'Nuxt app', etc.). Surfaces in the refusal message
   * so users know which `add-*` command to reach for.
   */
  projectKind: string;
  /** Suggested workspace-aware replacement command. */
  suggestion: string;
  /**
   * Confirm-prompt result, or `undefined` if no prompt was shown
   * (non-interactive path). When defined, becomes the decision.
   */
  userConfirmed?: boolean;
}): StandaloneGateDecision {
  const { force, nonInteractive, projectKind, suggestion, userConfirmed } = options;

  // Interactive caller already gave an explicit yes/no.
  if (userConfirmed !== undefined) {
    return userConfirmed
      ? { proceed: true }
      : { proceed: false, reason: `Aborted standalone ${projectKind} creation. Use \`${suggestion}\` instead.` };
  }

  // Non-interactive path: refuse unless --force is set. This is the
  // AI-agent / CI default — fail loud rather than silently produce a
  // stray clone that does not integrate with the workspace.
  if (nonInteractive && !force) {
    return {
      proceed: false,
      reason:
        `Refusing to create a standalone ${projectKind} inside an existing fullstack workspace ` +
        `(non-interactive caller detected). ` +
        `Use \`${suggestion}\` for the workspace-aware flow, or pass --force to override (rare).`,
    };
  }

  // Non-interactive + force: caller knows what they want.
  return { proceed: true };
}

/**
 * Write `projects/api/lt.config.json` with the apiMode and frameworkMode
 * baked in so follow-up generators (lt server module, addProp,
 * permissions) can pick the correct controller type and detect vendor
 * mode without re-probing the file tree.
 *
 * Idempotent: overwrites whatever was at `lt.config.json` so a re-run
 * after an apiMode change reflects the new value.
 */
export function writeApiConfig(options: {
  apiDir: string;
  apiMode: 'Both' | 'GraphQL' | 'Rest';
  filesystem: GluegunFilesystem;
  frameworkMode: 'npm' | 'vendor';
}): void {
  const { apiDir, apiMode, filesystem, frameworkMode } = options;

  filesystem.write(
    filesystem.path(apiDir, 'lt.config.json'),
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
}

/**
 * Probe a single directory for workspace markers. Pure helper used by
 * `detectWorkspaceLayout` and `findWorkspaceRoot`.
 *
 * Recognised markers (any one is sufficient):
 *   - `pnpm-workspace.yaml`           — pnpm workspace
 *   - `package.json` with `workspaces` field — npm/yarn/bun workspaces
 *   - `projects/` directory           — lt-monorepo convention
 *
 * Returns false for `node_modules`-style directories that may contain
 * a stray `package.json` with `workspaces`.
 */
function hasWorkspaceMarker(dir: string, filesystem: GluegunFilesystem): boolean {
  if (filesystem.exists(`${dir}/pnpm-workspace.yaml`) === 'file') return true;
  if (filesystem.exists(`${dir}/projects`) === 'dir') return true;

  const pkgPath = `${dir}/package.json`;
  if (filesystem.exists(pkgPath) !== 'file') return false;
  const pkg = filesystem.read(pkgPath, 'json') as null | Record<string, unknown>;
  if (!pkg) return false;

  // npm/yarn workspaces: `workspaces` is either an array of globs
  // (`["packages/*"]`) or an object with a `packages` array
  // (yarn classic). Both count.
  const ws = pkg.workspaces;
  if (Array.isArray(ws) && ws.length > 0) return true;
  if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown[] }).packages)) {
    return ((ws as { packages: unknown[] }).packages ?? []).length > 0;
  }
  return false;
}
