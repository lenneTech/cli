import { buildDevEnv } from '../src/lib/dev-env';
import { DevIdentity } from '../src/lib/dev-identity';

const fullIdentity: DevIdentity = {
  root: '/tmp/fake',
  slug: 'crm',
  subdomains: {
    api: { hostname: 'api.crm.localhost', isPrimaryApp: false, subdir: 'projects/api' },
    app: { hostname: 'crm.localhost', isPrimaryApp: true, subdir: 'projects/app' },
  },
};

describe('dev-env / buildDevEnv', () => {
  test('sets URL-based env for both API and App', () => {
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, dbName: 'crm', identity: fullIdentity });
    expect(env.api.env.PORT).toBe('4010');
    expect(env.api.env.BASE_URL).toBe('https://api.crm.localhost');
    expect(env.api.env.NSC__BASE_URL).toBe('https://api.crm.localhost');
    expect(env.api.env.APP_URL).toBe('https://crm.localhost');
    expect(env.api.env.NSC__APP_URL).toBe('https://crm.localhost');
    expect(env.api.env.NSC__MONGOOSE__URI).toBe('mongodb://127.0.0.1/crm');
    expect(env.api.env.DATABASE_URL).toContain('crm');

    expect(env.app.env.PORT).toBe('4011');
    expect(env.app.env.NUXT_API_URL).toBe('https://api.crm.localhost');
    expect(env.app.env.NUXT_PUBLIC_API_URL).toBe('https://api.crm.localhost');
    expect(env.app.env.NUXT_PUBLIC_SITE_URL).toBe('https://crm.localhost');
    expect(env.app.env.NUXT_PUBLIC_STORAGE_PREFIX).toBe('crm');
  });

  test('pins HOST to 127.0.0.1 for both API and App so Caddy upstream stays unambiguous', () => {
    // Regression: without HOST=127.0.0.1 Nuxt / Nest may bind to
    // `[::1]` only on macOS, and Caddy's IPv4 upstream gets a
    // connection-refused while a stray IPv6 listener from a different
    // process (e.g. Vite HMR on :4000) silently hangs the request.
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    expect(env.api.env.HOST).toBe('127.0.0.1');
    expect(env.api.env.NITRO_HOST).toBe('127.0.0.1');
    expect(env.app.env.HOST).toBe('127.0.0.1');
    expect(env.app.env.NITRO_HOST).toBe('127.0.0.1');
  });

  test('NUXT_PUBLIC_API_PROXY defaults to false (Caddy makes vite-proxy obsolete)', () => {
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    expect(env.app.env.NUXT_PUBLIC_API_PROXY).toBe('false');
  });

  test('exports legacy API_URL + SITE_URL aliases for projects that pre-date the NUXT_ convention', () => {
    // Regression: RegioKonneX reads `process.env.API_URL` and `SITE_URL`
    // directly in nuxt.config.ts. Without these aliases the app would
    // fall back to its compile-time default (localhost:3000) and yield
    // GraphQL fetch failures behind Caddy.
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    expect(env.app.env.API_URL).toBe('https://api.crm.localhost');
    expect(env.app.env.SITE_URL).toBe('https://crm.localhost');
  });

  test('injects NODE_EXTRA_CA_CERTS into BOTH api + app when Caddy local CA is on disk', () => {
    // Regression: Nuxt SSR fetches its own API via HTTPS during page
    // rendering and Node rejects the cert unless NODE_EXTRA_CA_CERTS
    // points at the local Caddy root. Same applies to API->App
    // webhooks/redirects. Both processes must carry the path.
    //
    // The detection probes the filesystem, so we only assert when a
    // CA file actually exists locally — otherwise the dev box has not
    // run `caddy trust` yet and the warning is left to the user.
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    if (env.api.env.NODE_EXTRA_CA_CERTS) {
      expect(env.api.env.NODE_EXTRA_CA_CERTS).toMatch(/root\.crt$/);
      expect(env.app.env.NODE_EXTRA_CA_CERTS).toBe(env.api.env.NODE_EXTRA_CA_CERTS);
    }
  });

  test('inherits baseEnv (e.g. PATH) so user-set vars survive', () => {
    const env = buildDevEnv({
      apiInternalPort: 4010,
      appInternalPort: 4011,
      baseEnv: { CUSTOM_TOKEN: 'abc', PATH: '/usr/bin' },
      identity: fullIdentity,
    });
    expect(env.api.env.CUSTOM_TOKEN).toBe('abc');
    expect(env.api.env.PATH).toBe('/usr/bin');
    expect(env.app.env.PATH).toBe('/usr/bin');
  });

  test('omits DB env when no dbName given', () => {
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    expect(env.api.env.NSC__MONGOOSE__URI).toBeUndefined();
    expect(env.api.env.DATABASE_URL).toBeUndefined();
  });

  test('omits api/app URL keys when subdomain missing', () => {
    const apiOnly: DevIdentity = {
      root: '/tmp/fake',
      slug: 'svc',
      subdomains: {
        api: { hostname: 'api.svc.localhost', isPrimaryApp: false, subdir: null },
      },
    };
    const env = buildDevEnv({ apiInternalPort: 4020, appInternalPort: 0, identity: apiOnly });
    expect(env.api.env.BASE_URL).toBe('https://api.svc.localhost');
    expect(env.app.env.NUXT_PUBLIC_SITE_URL).toBeUndefined();
  });
});
