/**
 * Project identity for `lt dev`.
 *
 * URL-first: every project has a slug derived from its package.json
 * "name", and a deterministic set of subdomains under `*.localhost`.
 *
 * Convention:
 * - `<slug>.localhost`         → primary App
 * - `api.<slug>.localhost`     → API
 * - `<other>.<slug>.localhost` → optional additional services
 *
 * The internal port behind each subdomain is opaque — Caddy proxies
 * arbitrary local ports. Developers and Claude only ever see the URL.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';

/** Stable identity for a single project root. */
export interface DevIdentity {
  /** Absolute path to the project root. */
  root: string;
  /** Bare slug (no scope, lowercase, dash-separated). */
  slug: string;
  /** Subdomain → upstream definition (`api`, `app`, etc.). */
  subdomains: Record<string, DevSubdomain>;
}

/** One subdomain entry — either the default app or an extra service. */
export interface DevSubdomain {
  /** Public hostname under `*.localhost` (e.g. `api.crm.localhost`). */
  hostname: string;
  /** True if this subdomain is the project's primary/default App (`<slug>.localhost`). */
  isPrimaryApp: boolean;
  /** Subdirectory inside the workspace (e.g. `projects/api`); null for standalone. */
  subdir: null | string;
}

/**
 * Build a complete identity from a project root.
 *
 * Detects monorepo subprojects under `projects/` automatically:
 * - `projects/api` → `api.<slug>.localhost`
 * - `projects/app` → `<slug>.localhost` (primary)
 * - `projects/<other>` → `<other>.<slug>.localhost`
 *
 * For standalone projects (single repo, no `projects/api` or `projects/app`):
 * - API project (config.env.ts present) → `api.<slug>.localhost`
 * - App project (nuxt.config.ts present) → `<slug>.localhost`
 *
 * Every combination is valid: api+app, api-only, and app-only.
 */
export function buildIdentity(root: string): DevIdentity {
  const slug = projectSlug(root);
  const subdomains: Record<string, DevSubdomain> = {};

  const apiDir = join(root, 'projects', 'api');
  const appDir = join(root, 'projects', 'app');
  const hasApi = existsSync(apiDir);
  const hasApp = existsSync(appDir);

  // Monorepo only when a known subproject is actually present. A bare (or
  // unrelated) `projects/` directory must not shadow the standalone probe —
  // it would yield an identity with zero subdomains and no routable URLs.
  if (hasApi || hasApp) {
    if (hasApi) {
      subdomains.api = {
        hostname: `api.${slug}.localhost`,
        isPrimaryApp: false,
        subdir: 'projects/api',
      };
    }
    if (hasApp) {
      subdomains.app = {
        hostname: `${slug}.localhost`,
        isPrimaryApp: true,
        subdir: 'projects/app',
      };
    }
    return { root, slug, subdomains };
  }

  // Standalone — derive from project shape.
  const { isApi, isApp } = detectStandaloneKind(root);
  if (isApi) {
    subdomains.api = { hostname: `api.${slug}.localhost`, isPrimaryApp: false, subdir: null };
  }
  if (isApp) {
    subdomains.app = { hostname: `${slug}.localhost`, isPrimaryApp: true, subdir: null };
  }

  return { root, slug, subdomains };
}

/**
 * Derive an ephemeral "test" identity from a base identity (used by
 * `lt dev test`). Suffixes the slug and every subdomain hostname with
 * `-test`, so the test stack runs on its own URLs / ports / Caddy block,
 * fully parallel to (and isolated from) the dev session.
 *
 *   svl.localhost      → svl-test.localhost
 *   api.svl.localhost  → api.svl-test.localhost
 */
export function buildTestIdentity(base: DevIdentity, suffix = '-test'): DevIdentity {
  const slug = `${base.slug}${suffix}`;
  const subdomains: Record<string, DevSubdomain> = {};
  for (const [sub, value] of Object.entries(base.subdomains)) {
    subdomains[sub] = {
      ...value,
      hostname: value.isPrimaryApp ? `${slug}.localhost` : `${sub}.${slug}.localhost`,
    };
  }
  return { root: base.root, slug, subdomains };
}

/**
 * Derive a per-TICKET identity from a base identity (used by `lt ticket` /
 * `lt dev up --ticket`). Suffixes the slug + every subdomain hostname with the
 * ticket id, so each ticket worktree runs on its OWN URLs / ports / Caddy block
 * / DB — fully parallel to and isolated from every other ticket and the base
 * dev session.
 *
 *   svl.localhost      → svl-2200.localhost
 *   api.svl.localhost  → api.svl-2200.localhost
 *
 * Mechanically identical to {@link buildTestIdentity} (a named wrapper for
 * readability + intent at the call sites). `id` is already a clean slug (see
 * `deriveTicketId` in dev-ticket.ts).
 */
export function buildTicketIdentity(base: DevIdentity, id: string): DevIdentity {
  return buildTestIdentity(base, `-${id}`);
}

/**
 * Probe a single directory for the shape of a STANDALONE lt project.
 *
 * Single source of truth for "is this an API / an App?", shared by
 * {@link buildIdentity} and `dev-project.ts#resolveLayout` so the identity
 * (URLs) and the layout (which processes to spawn) can never disagree.
 *
 * Both flags can be true (a single repo holding both), and both can be false
 * (not an lt-dev project).
 */
export function detectStandaloneKind(dir: string): { isApi: boolean; isApp: boolean } {
  return {
    isApi: existsSync(join(dir, 'src', 'config.env.ts')) || existsSync(join(dir, 'nest-cli.json')),
    isApp: existsSync(join(dir, 'nuxt.config.ts')),
  };
}

/**
 * package.json `name` values that are unchanged starter-template defaults.
 *
 * A project scaffolded by cloning a template (`git clone lenneTech/lt-monorepo
 * my-project`) instead of running `lt fullstack init`, or one that predates the
 * rename-on-init logic, keeps the template's default `name`. That value is not
 * project-identifying, so {@link projectSlug} ignores it and falls back to the
 * project directory name; `renameUnmodifiedTemplatePackage` (in package-name.ts)
 * rewrites the field on the next `lt dev init`.
 */
const UNMODIFIED_TEMPLATE_NAMES = new Set<string>(['lt-monorepo']);

/**
 * True when `name` matches a known unmodified starter-template default.
 *
 * Such names (e.g. `lt-monorepo`) are NOT project-identifying — see
 * {@link UNMODIFIED_TEMPLATE_NAMES} — so {@link projectSlug} ignores them and
 * derives the slug from the project directory instead.
 */
export function isUnmodifiedTemplateName(name: null | string | undefined): boolean {
  return typeof name === 'string' && UNMODIFIED_TEMPLATE_NAMES.has(name);
}

/**
 * Read the bare project name from package.json (scope stripped) and slugify it.
 *
 * Falls back to the PROJECT directory name when there is no usable name — i.e.
 * no package.json, no `name`, or an unmodified starter-template default (e.g.
 * `lt-monorepo`, left over from a project scaffolded before rename-on-init
 * existed). The fallback is anchored on the MAIN git worktree, so a linked
 * `lt ticket` worktree (`imo-2314/`) inherits the base project name (`imo`)
 * rather than slugging to its own folder — otherwise {@link buildTicketIdentity}
 * would double-suffix it to `imo-2314-2314`.
 */
export function projectSlug(root: string): string {
  const fromPkg = readPackageName(root);
  if (fromPkg && !isUnmodifiedTemplateName(fromPkg)) {
    return slugify(fromPkg);
  }
  return slugify(basename(mainWorktreeDir(root) ?? root));
}

/** Lowercase, alphanumerics + dashes only, trimmed dashes. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Best-effort directory of the MAIN git worktree containing `root`.
 *
 * For a linked worktree (e.g. an `lt ticket` worktree `imo-2314/`) this resolves
 * to the primary checkout (`imo/`), NOT the worktree folder: `--git-common-dir`
 * is the shared `.git`, identical for every worktree, and its parent is the main
 * repo root. Used only by {@link projectSlug}'s fallback so every worktree
 * inherits the same base project name. Returns null when `root` is outside a git
 * repo or git is unavailable.
 */
function mainWorktreeDir(root: string): null | string {
  try {
    const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return commonDir ? dirname(commonDir) : null;
  } catch {
    return null;
  }
}

/** Read `name` from package.json, scope-stripped (e.g. `@lenne.tech/foo` → `foo`). */
function readPackageName(dir: string): null | string {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
    if (!pkg.name) return null;
    return pkg.name.includes('/') ? pkg.name.split('/').pop()! : pkg.name;
  } catch {
    return null;
  }
}
