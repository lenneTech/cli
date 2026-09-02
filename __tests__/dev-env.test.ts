import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildDevEnv } from '../src/lib/dev-env';
import { buildTestIdentity, DevIdentity } from '../src/lib/dev-identity';

const fullIdentity: DevIdentity = {
  root: '/tmp/fake',
  slug: 'crm',
  subdomains: {
    api: { hostname: 'api.crm.localhost', isPrimaryApp: false, subdir: 'projects/api' },
    app: { hostname: 'crm.localhost', isPrimaryApp: true, subdir: 'projects/app' },
  },
};

describe('dev-env / buildDevEnv', () => {
  // `deriveSessionPassword` reads (and on first use creates) a machine-local salt. Redirect it
  // into a tmpdir for the whole suite, so running the tests never writes to the developer's
  // real `~/.lenneTech/` — and so the derived values stay stable across the cases below.
  let saltDir: string;
  let previousSaltPath: string | undefined;

  beforeAll(() => {
    saltDir = mkdtempSync(join(tmpdir(), 'lt-dev-env-'));
    previousSaltPath = process.env.LT_DEV_SESSION_SALT_PATH;
    process.env.LT_DEV_SESSION_SALT_PATH = join(saltDir, 'dev-session-salt');
  });

  afterAll(() => {
    if (previousSaltPath === undefined) {
      delete process.env.LT_DEV_SESSION_SALT_PATH;
    } else {
      process.env.LT_DEV_SESSION_SALT_PATH = previousSaltPath;
    }
    rmSync(saltDir, { force: true, recursive: true });
  });

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

  test('gives the App a session password so logins work on the built server', () => {
    // Regression: `lt dev test` serves the *built* Nitro server, which reads only `process.env`.
    // Without a password every login answered 500 ("H3Error: Empty password") and roughly half
    // of a project's Playwright suite failed on a cause unrelated to its tests.
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });

    // 32 hex chars: h3's floor is 32 characters, and pinning the ALPHABET too means a change of
    // digest or encoding is caught — `toHaveLength(32)` alone would accept base64 just as well.
    expect(env.app.env.NUXT_SESSION_PASSWORD).toMatch(/^[0-9a-f]{32}$/);
  });

  test('keeps the session password on the App only — the API has no h3 session', () => {
    // The key sits in the app block, not in `sharedKeys`. Moving it is a one-line, plausible
    // refactor, and nothing else in the suite would notice.
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });

    expect(env.api.env.NUXT_SESSION_PASSWORD).toBeUndefined();
  });

  test('derives the session password deterministically per slug', () => {
    const first = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    const second = buildDevEnv({ apiInternalPort: 4020, appInternalPort: 4021, identity: fullIdentity });

    // Same slug, different ports → same value. That is what lets a stack be stopped and started
    // again without logging everybody out. (It does NOT mean all shards of `lt dev test --shard`
    // agree — each shard runs under its own `-test-N` slug, see the next case.)
    expect(second.app.env.NUXT_SESSION_PASSWORD).toBe(first.app.env.NUXT_SESSION_PASSWORD);

    const other = buildDevEnv({
      apiInternalPort: 4010,
      appInternalPort: 4011,
      identity: { ...fullIdentity, slug: 'shop' },
    });

    // Different project → different value, so one stack's cookies never validate against another
    expect(other.app.env.NUXT_SESSION_PASSWORD).not.toBe(first.app.env.NUXT_SESSION_PASSWORD);
  });

  test('gives the dev stack and its parallel test stacks different session passwords', () => {
    // The pair that actually co-exists on one machine is not "two projects" but the dev stack
    // and the `lt dev test` stack it runs beside — plus one stack per shard (`testStackNames`
    // suffixes `-test-N`). Each must seal its own cookies, or a test run could resurrect a
    // session from the developer's parked `lt dev up`.
    const dev = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    const test = buildDevEnv({
      apiInternalPort: 4510,
      appInternalPort: 4511,
      identity: buildTestIdentity(fullIdentity),
    });
    const shard = buildDevEnv({
      apiInternalPort: 4520,
      appInternalPort: 4521,
      identity: buildTestIdentity(fullIdentity, '-test-2'),
    });

    const values = [dev, test, shard].map((e) => e.app.env.NUXT_SESSION_PASSWORD);
    expect(new Set(values).size).toBe(3);
  });

  test('never overrides a session password exported in the shell', () => {
    // A project with real session data must keep its own value — lt dev only fills the gap.
    // The fixture is exactly 32 characters, so it also stands for a value h3 would accept.
    const shellValue = 'project-owned-value-with-32-char';
    expect(shellValue).toHaveLength(32);

    const env = buildDevEnv({
      apiInternalPort: 4010,
      appInternalPort: 4011,
      baseEnv: { NUXT_SESSION_PASSWORD: shellValue },
      identity: fullIdentity,
    });

    expect(env.app.env.NUXT_SESSION_PASSWORD).toBe(shellValue);
  });

  test('forwards a session password the project set in its own .env', () => {
    // The case the fix exists for: the project HAS a password, in the file the built Nitro
    // server never reads. Forwarding it (rather than deriving a replacement) is what makes
    // "lt dev fills a gap, it does not replace a value the project chose" actually true.
    const appDir = mkdtempSync(join(tmpdir(), 'lt-app-'));
    try {
      writeFileSync(
        join(appDir, '.env'),
        ['# a comment', '', 'NUXT_PUBLIC_FOO=bar', 'NUXT_SESSION_PASSWORD="dotenv-owned-value-32-chars-x"'].join('\n'),
        'utf8',
      );

      const env = buildDevEnv({ apiInternalPort: 4010, appDir, appInternalPort: 4011, identity: fullIdentity });

      // Quotes stripped, value taken verbatim — not the derived fallback
      expect(env.app.env.NUXT_SESSION_PASSWORD).toBe('dotenv-owned-value-32-chars-x');
    } finally {
      rmSync(appDir, { force: true, recursive: true });
    }
  });

  test('lets a shell export win over the app .env, and both over the derived fallback', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'lt-app-'));
    try {
      writeFileSync(join(appDir, '.env'), 'NUXT_SESSION_PASSWORD=from-dotenv-value-32-chars-ab\n', 'utf8');

      const env = buildDevEnv({
        apiInternalPort: 4010,
        appDir,
        appInternalPort: 4011,
        baseEnv: { NUXT_SESSION_PASSWORD: 'from-the-shell-value-32-chars-ab' },
        identity: fullIdentity,
      });

      expect(env.app.env.NUXT_SESSION_PASSWORD).toBe('from-the-shell-value-32-chars-ab');
    } finally {
      rmSync(appDir, { force: true, recursive: true });
    }
  });

  test('treats an empty session password as absent — an empty one is what h3 rejects', () => {
    const env = buildDevEnv({
      apiInternalPort: 4010,
      appInternalPort: 4011,
      baseEnv: { NUXT_SESSION_PASSWORD: '' },
      identity: fullIdentity,
    });

    expect(env.app.env.NUXT_SESSION_PASSWORD).toMatch(/^[0-9a-f]{32}$/);
  });

  test('salts the derivation per machine, so the slug alone does not yield the password', () => {
    // The slug is public: the app publishes it as `NUXT_PUBLIC_STORAGE_PREFIX` in every SSR
    // payload, and `lt dev tunnel` can put that app on a public URL. If the slug were the only
    // input, any visitor could recompute the key that seals the stack's session cookies.
    const withFirstSalt = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity })
      .app.env.NUXT_SESSION_PASSWORD;

    const otherMachine = mkdtempSync(join(tmpdir(), 'lt-salt-'));
    const previous = process.env.LT_DEV_SESSION_SALT_PATH;
    try {
      process.env.LT_DEV_SESSION_SALT_PATH = join(otherMachine, 'dev-session-salt');
      const withSecondSalt = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity })
        .app.env.NUXT_SESSION_PASSWORD;

      // Same slug, different machine → different value
      expect(withSecondSalt).not.toBe(withFirstSalt);
      expect(withSecondSalt).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      process.env.LT_DEV_SESSION_SALT_PATH = previous;
      rmSync(otherMachine, { force: true, recursive: true });
    }
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
