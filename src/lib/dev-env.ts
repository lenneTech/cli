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
 *
 * CA trust for SSR fetches:
 * - Both API and App receive `NODE_EXTRA_CA_CERTS` pointing at the
 *   Caddy local root CA so server-side fetches between the two
 *   subdomains succeed. Without this Nuxt SSR fails with "unable to
 *   get local issuer certificate" when the app calls its own API.
 */
import { detectCaddyRootCa } from './dev-env-bridge';
import { DevIdentity } from './dev-identity';

export interface BuildDevEnvInput {
  /** Internal API port (assigned by `dev-state.allocateInternalPort`). */
  apiInternalPort: number;
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
  const { apiInternalPort, appInternalPort, baseEnv = {}, dbName, identity } = input;
  const apiSub = identity.subdomains.api;
  const appSub = identity.subdomains.app;

  const apiUrl = apiSub ? `https://${apiSub.hostname}` : '';
  const appUrl = appSub ? `https://${appSub.hostname}` : '';

  const caPath = detectCaddyRootCa();
  const sharedKeys: NodeJS.ProcessEnv = {
    // Marks the API + App processes as running under `lt dev`. Consumed by the
    // backend to relax dev-only behaviour (rate limiting, Better-Auth
    // user-cache) so E2E suites run without a separate VITEST/PLAYWRIGHT flag.
    // (Also written to the .lt-dev/.env bridge for external test runners.)
    LT_DEV_ACTIVE: 'true',
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
        ...(apiUrl ? { API_URL: apiUrl, NUXT_API_URL: apiUrl, NUXT_PUBLIC_API_URL: apiUrl } : {}),
        ...(appUrl ? { NUXT_PUBLIC_SITE_URL: appUrl, SITE_URL: appUrl } : {}),
        // Vite-API-Proxy is OFF by default in lt dev mode — Caddy serves
        // both subdomains under HTTPS with shared cookie domain, so
        // same-origin trickery is no longer required.
        NUXT_PUBLIC_API_PROXY: 'false',
        NUXT_PUBLIC_STORAGE_PREFIX: identity.slug,
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

/** Postgres convenience URL — used by Postgres-based projects (e.g. nest-base). */
function buildPostgresUrl(dbName: string): string {
  return `postgresql://${dbName}:${dbName}@localhost:5432/${dbName}`;
}
