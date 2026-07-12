/**
 * Resolve the project layout for `lt dev` commands.
 *
 * Walks up from `cwd` to find the workspace root (lt-monorepo style)
 * or treats the current directory as a standalone project. Wraps
 * existing helpers from `workspace-integration.ts` to keep detection
 * consistent with the rest of the CLI.
 */
import type { GluegunFilesystem } from 'gluegun';

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { detectStandaloneKind } from './dev-identity';
import { detectSubProjectContext, detectWorkspaceLayout, findWorkspaceRoot } from './workspace-integration';

export interface DevProjectLayout {
  /** Absolute path to the API subproject root (or null). */
  apiDir: null | string;
  /** Absolute path to the App subproject root (or null). */
  appDir: null | string;
  /** Project root — workspace root for monorepos, project itself for standalones. */
  root: string;
  /** True if this is a fullstack monorepo with `projects/api` + `projects/app`. */
  workspace: boolean;
}

/**
 * Detect whether the API project still has the legacy hardcoded `port: 3000`.
 * Returns the file path if a patch is needed, null otherwise.
 */
export function apiNeedsPortPatch(apiDir: string): null | string {
  const file = join(apiDir, 'src', 'config.env.ts');
  if (!existsSync(file)) return null;
  const content = readFileSync(file, 'utf8');
  return /port:\s*3000\s*,/.test(content) ? file : null;
}

/**
 * Detect whether the App project still has hardcoded `port: 3001` or a
 * hardcoded vite-proxy `target: 'http://localhost:3000'`. Returns an
 * array of file paths that need patching.
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
      /host:\s*'http:\/\/localhost:3001'/.test(c) ||
      // Unguarded Playwright `webServer` (no LT_DEV_ACTIVE guard) — patch it so
      // `lt dev test`'s isolated stack is reused instead of a stray server.
      (/webServer:\s*[[{]/.test(c) && !/webServer:\s*process\.env\.LT_DEV_ACTIVE/.test(c))
    );
  });
}

/** Read `dbName` from the API config (defaults to `<slug>-local`). */
export function deriveDbName(apiDir: null | string, slug: string): string {
  if (apiDir) {
    const cfg = join(apiDir, 'src', 'config.env.ts');
    if (existsSync(cfg)) {
      const content = readFileSync(cfg, 'utf8');
      const match = content.match(/dbName:\s*['"`]([^'"`]+)['"`]/);
      if (match) return match[1];
    }
  }
  return `${slug}-local`;
}

/**
 * Derive the dedicated database name for the `lt dev test` stack from the
 * project's dev DB name. Distinct from both `<…>-local` (developer DB) and
 * the API unit-test DB (`<…>-e2e`), so Playwright E2E never touches developer
 * or API-test data.
 *
 *   svl-sports-system-local → svl-sports-system-test
 *
 * Uses the `-test` suffix so it passes test-helper guards that only permit
 * local/test databases (name ending in `-local` | `-ci` | `-e2e` | `-test`).
 */
export function deriveTestDbName(devDbName: string): string {
  const base = devDbName.replace(/-(local|dev)$/i, '');
  return `${base}-test`;
}

/**
 * Derive the per-TICKET database name from the project's dev DB name, so each
 * ticket worktree reads/writes its OWN database and tickets never collide.
 *
 *   svl-sports-system-local + "2200" → svl-sports-system-2200
 *
 * The ticket's isolated `lt dev test` stack then derives its test DB from this
 * via {@link deriveTestDbName} → `svl-sports-system-2200-test`.
 */
export function deriveTicketDbName(devDbName: string, ticketId: string): string {
  const base = devDbName.replace(/-(local|dev)$/i, '');
  return `${base}-${ticketId}`;
}

/**
 * Resolve layout starting from `cwd`. Walks up to find a workspace if
 * cwd is inside `projects/api/` or `projects/app/`.
 *
 * A workspace marker alone never wins: it only selects the monorepo layout
 * when `projects/api` or `projects/app` actually exists. Otherwise we fall
 * through to the standalone probe — a single-package repo may legitimately
 * carry a settings-only `pnpm-workspace.yaml` (pnpm 10/11 keeps `overrides`
 * and build allowlists there), and an npm workspace may use `packages/*`
 * rather than the lt `projects/*` convention.
 */
export function resolveLayout(cwd: string, filesystem: GluegunFilesystem): DevProjectLayout {
  const subContext = detectSubProjectContext(cwd, filesystem);
  if (subContext) return monorepoLayout(subContext.workspaceRoot);

  const layout = detectWorkspaceLayout(cwd, filesystem);
  if (layout.hasWorkspace) {
    const mono = monorepoLayout(layout.workspaceDir);
    if (mono.apiDir || mono.appDir) return mono;
  }

  const workspaceRoot = findWorkspaceRoot(cwd, filesystem);
  if (workspaceRoot) {
    const mono = monorepoLayout(workspaceRoot);
    if (mono.apiDir || mono.appDir) return mono;
  }

  // Standalone project — API-only, App-only, or a single repo holding both.
  const { isApi, isApp } = detectStandaloneKind(cwd);
  return {
    apiDir: isApi ? cwd : null,
    appDir: isApp ? cwd : null,
    root: cwd,
    workspace: false,
  };
}

/** Build the layout for an lt-monorepo workspace root. */
function monorepoLayout(workspaceRoot: string): DevProjectLayout {
  const apiDir = join(workspaceRoot, 'projects', 'api');
  const appDir = join(workspaceRoot, 'projects', 'app');
  return {
    apiDir: existsSync(apiDir) ? apiDir : null,
    appDir: existsSync(appDir) ? appDir : null,
    root: workspaceRoot,
    workspace: true,
  };
}
