/**
 * Project layout detection for `lt local` commands. Wraps existing
 * workspace-integration helpers to figure out where the API and App
 * directories live for a given cwd.
 */
import type { GluegunFilesystem } from 'gluegun';

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { detectSubProjectContext, detectWorkspaceLayout, findWorkspaceRoot } from './workspace-integration';

/** Resolved layout for `lt local` operations. */
export interface LocalProjectLayout {
  /** Absolute path to the API subproject root, or null if not present. */
  apiDir: null | string;
  /** Absolute path to the App subproject root, or null if not present. */
  appDir: null | string;
  /** Project name — derived from package.json or basename. */
  name: string;
  /** "Source of truth" root — for monorepos this is the workspace root, for standalones the project itself. */
  root: string;
  /** True if this is a fullstack monorepo with projects/api + projects/app. */
  workspace: boolean;
}

/**
 * Detect whether the API project still has the legacy hardcoded
 * `port: 3000`. Returns the absolute file path if a patch is needed,
 * null if already env-aware (or no file).
 */
export function apiNeedsPortPatch(apiDir: string): null | string {
  const file = join(apiDir, 'src', 'config.env.ts');
  if (!existsSync(file)) return null;
  const content = readFileSync(file, 'utf8');
  // Match `port: 3000,` exactly (not yet env-wrapped).
  return /port:\s*3000\s*,/.test(content) ? file : null;
}

/**
 * Detect whether the App project still has hardcoded `port: 3001` or a
 * hardcoded vite-proxy `target: 'http://localhost:3000'`. Returns an
 * array of absolute file paths that need patching.
 */
export function appNeedsPortPatch(appDir: string): string[] {
  const candidates = [join(appDir, 'nuxt.config.ts'), join(appDir, 'playwright.config.ts')];
  return candidates.filter((file) => {
    if (!existsSync(file)) return false;
    const c = readFileSync(file, 'utf8');
    return (
      /port:\s*3001\s*,/.test(c) ||
      /target:\s*'http:\/\/localhost:3000'/.test(c) ||
      /baseURL:\s*'http:\/\/localhost:3001'/.test(c) ||
      /url:\s*'http:\/\/localhost:3001'/.test(c) ||
      /host:\s*'http:\/\/localhost:3001'/.test(c)
    );
  });
}

/**
 * Resolve the project layout starting from `cwd`. Walks up to find a
 * monorepo workspace if cwd is inside `projects/api/` or `projects/app/`.
 */
export function resolveLayout(cwd: string, filesystem: GluegunFilesystem): LocalProjectLayout {
  // Inside a sub-project? → walk to workspace root.
  const subContext = detectSubProjectContext(cwd, filesystem);
  if (subContext) {
    return monorepoLayout(subContext.workspaceRoot);
  }

  // Workspace root directly?
  const layout = detectWorkspaceLayout(cwd, filesystem);
  if (layout.hasWorkspace) {
    return monorepoLayout(layout.workspaceDir);
  }

  // Walk up to find a workspace.
  const workspaceRoot = findWorkspaceRoot(cwd, filesystem);
  if (workspaceRoot) {
    return monorepoLayout(workspaceRoot);
  }

  // Fall back to standalone — figure out if it's API or App.
  const isApi = existsSync(join(cwd, 'src', 'config.env.ts')) || existsSync(join(cwd, 'nest-cli.json'));
  const isApp = existsSync(join(cwd, 'nuxt.config.ts'));

  return {
    apiDir: isApi ? cwd : null,
    appDir: isApp ? cwd : null,
    name: readPackageName(cwd) || basename(cwd),
    root: cwd,
    workspace: false,
  };
}

function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || 'project';
}

/** Build the layout for an lt-monorepo workspace root. */
function monorepoLayout(workspaceRoot: string): LocalProjectLayout {
  const apiDir = join(workspaceRoot, 'projects', 'api');
  const appDir = join(workspaceRoot, 'projects', 'app');
  return {
    apiDir: existsSync(apiDir) ? apiDir : null,
    appDir: existsSync(appDir) ? appDir : null,
    name: readPackageName(workspaceRoot) || basename(workspaceRoot),
    root: workspaceRoot,
    workspace: true,
  };
}

/** Read the `name` field from `package.json`, scrubbed to just the bare name (no scope). */
function readPackageName(dir: string): null | string {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
    if (!pkg.name) return null;
    // Strip npm scope: @lenne.tech/foo → foo
    return pkg.name.includes('/') ? pkg.name.split('/').pop()! : pkg.name;
  } catch {
    return null;
  }
}
