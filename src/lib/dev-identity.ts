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
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';

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
 * For standalone projects (single repo, no `projects/` directory):
 * - API project (config.env.ts present) → `api.<slug>.localhost`
 * - App project (nuxt.config.ts present) → `<slug>.localhost`
 */
export function buildIdentity(root: string): DevIdentity {
  const slug = projectSlug(root);
  const subdomains: Record<string, DevSubdomain> = {};

  const projectsDir = join(root, 'projects');
  if (existsSync(projectsDir)) {
    // Monorepo: enumerate projects/* subdirectories.
    const apiDir = join(projectsDir, 'api');
    const appDir = join(projectsDir, 'app');

    if (existsSync(apiDir)) {
      subdomains.api = {
        hostname: `api.${slug}.localhost`,
        isPrimaryApp: false,
        subdir: 'projects/api',
      };
    }
    if (existsSync(appDir)) {
      subdomains.app = {
        hostname: `${slug}.localhost`,
        isPrimaryApp: true,
        subdir: 'projects/app',
      };
    }
  } else {
    // Standalone — derive from project shape.
    const isApi = existsSync(join(root, 'src', 'config.env.ts')) || existsSync(join(root, 'nest-cli.json'));
    const isApp = existsSync(join(root, 'nuxt.config.ts'));

    if (isApi) {
      subdomains.api = { hostname: `api.${slug}.localhost`, isPrimaryApp: false, subdir: null };
    }
    if (isApp) {
      subdomains.app = { hostname: `${slug}.localhost`, isPrimaryApp: true, subdir: null };
    }
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
 * Read the bare project name from package.json (scope stripped).
 * Falls back to directory basename if no package.json or no `name`.
 */
export function projectSlug(root: string): string {
  const fromPkg = readPackageName(root);
  const raw = fromPkg || basename(root);
  return slugify(raw);
}

/** Lowercase, alphanumerics + dashes only, trimmed dashes. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
