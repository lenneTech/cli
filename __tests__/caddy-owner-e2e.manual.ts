/**
 * `detectCaddyOwner` against the JSON a real Caddy serves, not against hand-written fixtures.
 *
 * Starts a throwaway Caddy whose admin API listens on 127.0.0.1:29019 and whose sites use plain
 * http on 127.0.0.1:18731, so it never meets the lt dev Caddy on :2019/:443. The owner check reads
 * this instance's `GET /config/` through LT_DEV_CADDY_ADMIN; our Caddyfile and the registry are the
 * temp files the test setup points LT_DEV_CADDYFILE / LT_DEV_REGISTRY_PATH at. Needs `caddy` on PATH:
 * `npm run test:manual -- __tests__/caddy-owner-e2e.manual.ts`.
 */
import { ChildProcess, spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { get } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';

// The owner check reads the admin API at LT_DEV_CADDY_ADMIN, captured when caddy.ts is imported;
// the test setup points it at a dead port, this suite at its throwaway Caddy.
const { ADMIN } = vi.hoisted(() => {
  process.env.LT_DEV_CADDY_ADMIN = '127.0.0.1:29019';
  return { ADMIN: '127.0.0.1:29019' };
});

import { AdminAnswer, detectCaddyOwner, OWNER_LOGGER, paths, writeCaddyfile } from '../src/lib/caddy';
import { saveRegistry } from '../src/lib/dev-state';
const SITE_PORT = 18731;
const hasCaddy = spawnSync('caddy', ['version']).status === 0;

function fetchConfig(): Promise<AdminAnswer | null> {
  return new Promise((resolve) => {
    const req = get(`http://${ADMIN}/config/`, { timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ body, status: res.statusCode ?? 0 }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Start a Caddy with `sites` (Caddyfile site blocks), wait for its admin API, return it. */
async function startCaddy(dir: string, sites: string, globalOptions = ''): Promise<ChildProcess> {
  const file = join(dir, `Caddyfile-${Date.now()}`);
  writeFileSync(file, `{\n\tadmin ${ADMIN}\n${globalOptions}}\n\n${sites}\n`);
  const child = spawn('caddy', ['run', '--config', file, '--adapter', 'caddyfile'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if ((await fetchConfig()) !== null) return child;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('throwaway caddy did not come up');
}

async function stopCaddy(child: ChildProcess): Promise<void> {
  child.kill();
  for (let i = 0; i < 50 && (await fetchConfig()) !== null; i++) await new Promise((r) => setTimeout(r, 100));
}

const site = (host: string) => `http://${host}:${SITE_PORT} {\n\trespond "${host}"\n}`;

describe.runIf(hasCaddy)('detectCaddyOwner against a real Caddy', () => {
  let dir: string;
  let caddy: ChildProcess | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-caddy-owner-e2e-'));
    // Our Caddyfile has moved on: crm is still there, shop is gone, cms is new.
    writeCaddyfile(`# >>> lt-dev:crm >>>\n${site('crm.localhost')}\n# <<< lt-dev:crm <<<\n\n${site('cms.localhost')}\n`);
    // shop is still registered; its route survives only in Caddy's old config.
    saveRegistry({
      projects: {
        shop: { internalPorts: {}, path: '/nowhere/shop', subdomains: { app: 'shop.localhost' } },
      },
      version: 1,
    });
  });

  afterEach(async () => {
    if (caddy) await stopCaddy(caddy);
    caddy = undefined;
  });

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test('our Caddy that kept its old routes after a failed reload is ours (DEV-4005, check 3)', async () => {
    caddy = await startCaddy(dir, [site('crm.localhost'), site('shop.localhost'), site('crm-2314.localhost')].join('\n'));
    expect(await detectCaddyOwner()).toBe('ours');
  });

  test('a Caddy serving one site lt dev does not know is foreign', async () => {
    caddy = await startCaddy(dir, [site('crm.localhost'), site('client.example')].join('\n'));
    expect(await detectCaddyOwner()).toBe('foreign');
  });

  test('a Caddy with a catch-all site is foreign', async () => {
    caddy = await startCaddy(dir, `http://:${SITE_PORT} {\n\trespond "anything"\n}`);
    expect(await detectCaddyOwner()).toBe('foreign');
  });

  test('the marker makes a config ours whatever it serves', async () => {
    caddy = await startCaddy(dir, site('client.example'), `\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n`);
    expect(await detectCaddyOwner()).toBe('ours');
  });

  test('our own Caddyfile, loaded as it is, is ours (Windows: Caddy started by hand, check 2)', async () => {
    const own = spawnSync('caddy', ['adapt', '--config', paths.caddyfile, '--adapter', 'caddyfile'], {
      encoding: 'utf8',
    });
    expect(own.status).toBe(0);
    expect(own.stdout).toContain(OWNER_LOGGER);
    caddy = await startCaddy(dir, [site('crm.localhost'), site('cms.localhost')].join('\n'));
    expect(await detectCaddyOwner()).toBe('ours');
  });

  test('nothing on the admin port is none', async () => {
    expect(await detectCaddyOwner()).toBe('none');
  });
});
