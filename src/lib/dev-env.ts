/**
 * Build environment variables for `lt dev up`.
 *
 * URL-first: API and App processes receive complete URLs (not just ports)
 * so they can configure CORS, BetterAuth trusted origins, OpenAPI servers,
 * Vite proxies and storage prefixes consistently — without ever needing
 * to know which internal port Caddy proxies them to.
 *
 * Cross-wiring protection:
 * - `BASE_URL`/`APP_URL` lock the API to its own App origin (CORS + BetterAuth)
 * - `NUXT_PUBLIC_*` lock the App to its own API
 * - `NUXT_PUBLIC_STORAGE_PREFIX` namespaces localStorage/sessionStorage
 * - `NSC__MONGOOSE__URI` / `DATABASE_URL` namespace the database per project
 * - `NUXT_SESSION_PASSWORD` is keyed per slug, so a session cookie sealed by one
 *   stack cannot be unsealed by another (dev vs. `-test` vs. `-test-N` shard)
 *
 * CA trust for SSR fetches:
 * - Both API and App receive `NODE_EXTRA_CA_CERTS` pointing at the
 *   Caddy local root CA so server-side fetches between the two
 *   subdomains succeed. Without this Nuxt SSR fails with "unable to
 *   get local issuer certificate" when the app calls its own API.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { detectCaddyRootCa } from './dev-env-bridge';
import { DevIdentity } from './dev-identity';

export interface BuildDevEnvInput {
  /** Internal API port (assigned by `dev-state.allocateInternalPort`). */
  apiInternalPort: number;
  /**
   * App project directory (e.g. `<root>/projects/app`). Optional — when given, the app's
   * own `.env` is consulted for keys the built Nitro server would otherwise never see.
   */
  appDir?: string;
  /** Internal App port. */
  appInternalPort: number;
  /** Inherited shell env (defaults to {}, callers usually pass `process.env`). */
  baseEnv?: NodeJS.ProcessEnv;
  /** Database name (per-project, used in MONGODB_URI / DATABASE_URL). */
  dbName?: string;
  /** Project identity (slug + subdomains). */
  identity: DevIdentity;
}

/** Per-process environment for `lt dev up`. */
export interface DevEnv {
  /** Internal port the API process binds to (Caddy upstream). */
  api: { env: NodeJS.ProcessEnv; internalPort: number };
  /** Internal port the primary App process binds to. */
  app: { env: NodeJS.ProcessEnv; internalPort: number };
}

/**
 * Build the environment maps for both API and App processes.
 *
 * Both processes inherit `baseEnv` (typically `process.env`) so user-set
 * vars survive. `lt dev`-managed keys win on top.
 */
export function buildDevEnv(input: BuildDevEnvInput): DevEnv {
  const { apiInternalPort, appDir, appInternalPort, baseEnv = {}, dbName, identity } = input;
  const apiSub = identity.subdomains.api;
  const appSub = identity.subdomains.app;

  const apiUrl = apiSub ? `https://${apiSub.hostname}` : '';
  const appUrl = appSub ? `https://${appSub.hostname}` : '';
  // Same two services, addressed the way Node can reach them. See `internalUrl`.
  const apiInternal = internalUrl(apiInternalPort);
  const appInternal = internalUrl(appInternalPort);

  const caPath = detectCaddyRootCa();
  const sharedKeys: NodeJS.ProcessEnv = {
    // Marks the API + App processes as running under `lt dev`. Consumed by the
    // backend to relax dev-only behaviour (rate limiting, Better-Auth
    // user-cache) so E2E suites run without a separate VITEST/PLAYWRIGHT flag.
    // (Also written to the .lt-dev/.env bridge for external test runners.)
    LT_DEV_ACTIVE: 'true',
    // The loopback addresses, named explicitly so anything Node-side (an external
    // test runner reading the `.lt-dev/.env` bridge, a project's own helper) can
    // reach the components without going through a hostname it may not resolve.
    ...(apiInternal ? { LT_DEV_API_INTERNAL_URL: apiInternal } : {}),
    ...(appInternal ? { LT_DEV_APP_INTERNAL_URL: appInternal } : {}),
    ...(apiUrl ? { BASE_URL: apiUrl, NSC__BASE_URL: apiUrl } : {}),
    ...(appUrl ? { APP_URL: appUrl, NSC__APP_URL: appUrl } : {}),
    ...(dbName ? { DATABASE_URL: buildPostgresUrl(dbName), NSC__MONGOOSE__URI: `mongodb://127.0.0.1/${dbName}` } : {}),
    // Caddy's local root CA — without this, Node's TLS rejects
    // self-signed certs and Nuxt SSR + API server-side fetches fail.
    ...(caPath ? { NODE_EXTRA_CA_CERTS: caPath } : {}),
  };

  return {
    api: {
      env: {
        ...baseEnv,
        ...sharedKeys,
        // Force IPv4 loopback binding so Caddy's `127.0.0.1` upstream
        // (see `caddy.ts#renderProjectBlock`) always matches the
        // listener. Without this, Nuxt + Nest sometimes bind to
        // `[::1]` only, and Caddy gets connection-refused on IPv4.
        HOST: '127.0.0.1',
        NITRO_HOST: '127.0.0.1',
        PORT: String(apiInternalPort),
      },
      internalPort: apiInternalPort,
    },
    app: {
      env: {
        ...baseEnv,
        ...sharedKeys,
        // See API note above: pin the dev server to IPv4 so Caddy's
        // `127.0.0.1` upstream is unambiguous.
        HOST: '127.0.0.1',
        NITRO_HOST: '127.0.0.1',
        // `API_URL` / `SITE_URL` are common legacy aliases used by
        // projects that pre-date the `NUXT_*` convention (e.g. when
        // nuxt.config.ts reads `process.env.API_URL` directly into
        // runtimeConfig.public). Exporting them transparently means
        // those projects "just work" under `lt dev up` without code
        // changes. The `NUXT_*` variants below win at runtime where
        // both are read.
        // `NUXT_API_URL` is the SERVER-side address (the Vite/Nitro proxy target,
        // and what `buildLtApiUrl()` prefers during SSR); `NUXT_PUBLIC_API_URL`
        // lands in `runtimeConfig.public` and is fetched by the BROWSER. The
        // module already distinguishes the two — until now they carried the same
        // value, so the distinction bought nothing. `API_URL` is the legacy alias
        // projects read into `runtimeConfig.public`, so it stays public.
        ...(apiUrl ? { API_URL: apiUrl, NUXT_PUBLIC_API_URL: apiUrl } : {}),
        ...(apiInternal || apiUrl ? { NUXT_API_URL: apiInternal || apiUrl } : {}),
        ...(appUrl ? { NUXT_PUBLIC_SITE_URL: appUrl, SITE_URL: appUrl } : {}),
        // Vite-API-Proxy is OFF by default in lt dev mode — Caddy serves
        // both subdomains under HTTPS with shared cookie domain, so
        // same-origin trickery is no longer required.
        NUXT_PUBLIC_API_PROXY: 'false',
        NUXT_PUBLIC_STORAGE_PREFIX: identity.slug,
        // Nuxt/h3 sessions need a password of at least 32 characters. An ABSENT one makes
        // every login answer 500 `H3Error: Empty password`; a SHORT one answers `Password
        // string too short (min 32 characters required)` — two distinct errors from
        // iron-webcrypto (`minPasswordlength: 32`), reached via h3's seal/unseal. `nuxt dev`
        // gets a password for free because it reads the project's `.env`; `lt dev test`
        // serves the *built* Nitro server, which reads only `process.env`. So a project with
        // a perfectly good `.env` watched half its E2E suite fail on a cause unrelated to it.
        //
        // Precedence, highest first: a value exported in the SHELL, then the app's own
        // `.env` file, then the derived fallback. `lt dev` fills a gap; it never replaces a
        // value the project chose. Forwarding the `.env` value explicitly is the point — the
        // built server would not read that file itself.
        //
        // Derived rather than random so a restarted stack does not invalidate open sessions.
        // Keyed on the SLUG, so the dev stack, the `-test` stack and every `-test-N` shard
        // stack get DIFFERENT values (see `testStackNames`) — that is what stops one stack's
        // cookies from validating against another's. Salted per machine, because the slug is
        // public: it is the app's own `NUXT_PUBLIC_STORAGE_PREFIX` and ships in every SSR
        // payload, and `lt dev tunnel` can put that app on a public URL. An unsalted
        // derivation would hand any visitor the key that seals its sessions.
        //
        // Inert for the standard lt stack — nuxt-base-starter and nuxt-extensions
        // authenticate via Better Auth, not h3 sessions. This exists for projects that added
        // h3 `useSession` / nuxt-auth-utils on top; for everyone else it is an unused key.
        ...(baseEnv.NUXT_SESSION_PASSWORD
          ? {}
          : {
              NUXT_SESSION_PASSWORD:
                readEnvFileValue(appDir, 'NUXT_SESSION_PASSWORD') ?? deriveSessionPassword(identity.slug),
            }),
        PORT: String(appInternalPort),
        // macOS: the default $TMPDIR (/var/folders/…/T/, ~49 chars) pushes Nuxt's
        // vite-node IPC socket path past the 104-char UNIX sun_path limit, so the
        // dev server dies with "connect EINVAL …/nuxt-vite-node-….sock" and every
        // SSR request 500s. Pin a short TMPDIR for the app process so the socket
        // path stays well under the limit. Linux /tmp is already short → no-op there.
        ...(process.platform === 'darwin' ? { TMPDIR: '/tmp' } : {}),
      },
      internalPort: appInternalPort,
    },
  };
}

/**
 * The loopback address of a component, for anything that RESOLVES a name.
 *
 * `lt dev` is URL-first: a project is reached at `https://<slug>.localhost`, and
 * Caddy proxies that to an opaque internal port. That promise holds for
 * **browsers**. It does not hold for Node: on Windows `*.localhost` subdomains do
 * not resolve at all (`dns.lookup('api.demo.localhost')` → ENOTFOUND, and `curl`
 * agrees), while Chromium resolves them internally without asking a resolver.
 *
 * So the question at every call site is not "which URL" but **"who reads it"**:
 *
 * | | example | address to use |
 * |---|---|---|
 * | a browser resolves it | Playwright `baseURL`, a printed link | the public name |
 * | Node resolves it | readiness probes, SSR fetches, a proxy target | **this** |
 * | another binary resolves it | `cloudflared` | **this** |
 * | nobody resolves it — it is COMPARED | `APP_URL` (CORS / `trustedOrigins`), the Caddy vhost matcher, the tunnel `Host:` header | the public name, untouched |
 *
 * That last row is why "rewrite every internal URL to 127.0.0.1" would be wrong:
 * `APP_URL` is matched as a string against the `Origin` header a browser sends,
 * and the browser arrives from `https://<slug>.localhost`. Rewriting it would
 * break every login — on the platform where only a health probe was broken before.
 *
 * **Loopback on every platform, not only on Windows.** 127.0.0.1 works everywhere,
 * so there is no branch to get wrong, and the path Windows depends on is the one
 * macOS exercises daily. A branch only the other platform runs is an unchecked
 * branch.
 *
 * One consequence to keep in mind: this goes PAST Caddy. For "is the component
 * alive?" that is an advantage — it measures the component, not the proxy. For
 * "does the routing work?" it is the wrong question, and that one belongs to
 * `lt dev doctor` over the public name.
 */
export function internalUrl(port: number | undefined): string {
  return port ? `http://127.0.0.1:${port}` : '';
}

/** Postgres convenience URL — used by Postgres-based projects (e.g. nest-base). */
function buildPostgresUrl(dbName: string): string {
  return `postgresql://${dbName}:${dbName}@localhost:5432/${dbName}`;
}

/**
 * Stable local session password for a project's app process.
 *
 * 32 hex chars — h3's floor. Deterministic per slug AND per machine: the same stack on the
 * same machine always gets the same value, so a restart does not invalidate open sessions,
 * while a different slug (or a different developer's machine) gets a different one.
 *
 * The machine salt is what makes it unguessable. Without it the only input is the slug, which
 * the app publishes itself via `NUXT_PUBLIC_STORAGE_PREFIX`, so anyone who loaded a page —
 * including any visitor of a `lt dev tunnel` URL — could recompute the key and forge a sealed
 * session cookie. With it, an attacker would have to read the developer's home directory.
 */
function deriveSessionPassword(slug: string): string {
  // No salt means the home directory is unwritable. Fall back to a constant key rather than a
  // random one: determinism is the property every caller depends on, and a fresh value per run
  // would log everybody out on every restart. The fallback is guessable — hence last resort.
  return createHmac('sha256', machineSessionSalt() ?? 'lt-dev')
    .update(`lt-dev:session:${slug}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Read (or create) the machine-local salt at `~/.lenneTech/dev-session-salt`, mode 0600.
 *
 * Returns `null` when it can be neither read nor created — see {@link deriveSessionPassword}
 * for what happens then.
 */
function machineSessionSalt(): null | string {
  const file = sessionSaltPath();
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Not created yet — fall through and create it.
  }

  try {
    mkdirSync(dirname(file), { recursive: true });
    // `wx` fails when the file already exists, so two shards racing on a cold machine can
    // never end up with two different salts: the loser falls into the catch and re-reads.
    const salt = randomBytes(32).toString('hex');
    writeFileSync(file, `${salt}\n`, { flag: 'wx', mode: 0o600 });
    return salt;
  } catch {
    try {
      return readFileSync(file, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }
}

/**
 * Read one key out of `<dir>/.env` without pulling in a dotenv dependency.
 *
 * Deliberately minimal: no interpolation, no multi-line values, no `.env.local` cascade. It
 * exists to answer one question — did the project set this key itself? — for a value the built
 * Nitro server would otherwise never see.
 */
function readEnvFileValue(dir: string | undefined, key: string): string | undefined {
  if (!dir) {
    return undefined;
  }

  let content: string;
  try {
    content = readFileSync(join(dir, '.env'), 'utf8');
  } catch {
    return undefined;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (
      trimmed
        .slice(0, eq)
        .replace(/^export\s+/, '')
        .trim() !== key
    ) {
      continue;
    }

    const raw = trimmed.slice(eq + 1).trim();
    const quoted =
      raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")));
    return (quoted ? raw.slice(1, -1) : raw) || undefined;
  }

  return undefined;
}

/**
 * Path of the machine-local salt. `LT_DEV_SESSION_SALT_PATH` overrides it, and `HOME` is read
 * before `os.homedir()` — both so tests can redirect the write to a tmpdir, the same reason
 * `dev-service.ts#userHome` does it.
 */
function sessionSaltPath(): string {
  return process.env.LT_DEV_SESSION_SALT_PATH || join(process.env.HOME || homedir(), '.lenneTech', 'dev-session-salt');
}
