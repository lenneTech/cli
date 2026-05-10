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
 */
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

  const sharedKeys: NodeJS.ProcessEnv = {
    ...(apiUrl ? { BASE_URL: apiUrl, NSC__BASE_URL: apiUrl } : {}),
    ...(appUrl ? { APP_URL: appUrl, NSC__APP_URL: appUrl } : {}),
    ...(dbName ? { DATABASE_URL: buildPostgresUrl(dbName), NSC__MONGOOSE__URI: `mongodb://127.0.0.1/${dbName}` } : {}),
  };

  return {
    api: {
      env: {
        ...baseEnv,
        ...sharedKeys,
        PORT: String(apiInternalPort),
      },
      internalPort: apiInternalPort,
    },
    app: {
      env: {
        ...baseEnv,
        ...sharedKeys,
        ...(apiUrl ? { NUXT_API_URL: apiUrl, NUXT_PUBLIC_API_URL: apiUrl } : {}),
        ...(appUrl ? { NUXT_PUBLIC_SITE_URL: appUrl } : {}),
        // Vite-API-Proxy is OFF by default in lt dev mode — Caddy serves
        // both subdomains under HTTPS with shared cookie domain, so
        // same-origin trickery is no longer required.
        NUXT_PUBLIC_API_PROXY: 'false',
        NUXT_PUBLIC_STORAGE_PREFIX: identity.slug,
        PORT: String(appInternalPort),
      },
      internalPort: appInternalPort,
    },
  };
}

/** Postgres convenience URL — used by Postgres-based projects (e.g. nest-base). */
function buildPostgresUrl(dbName: string): string {
  return `postgresql://${dbName}:${dbName}@localhost:5432/${dbName}`;
}
