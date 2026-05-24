/**
 * End-to-end integration tests for `dev-service` against a REAL
 * `caddy` binary + a REAL `launchctl` (macOS only).
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ NOT PART OF `npm test`. This file is named `*.manual.ts`, not     │
 * │ `*.test.ts`, so Jest's `testMatch` (`<rootDir>/*.test.ts`) does   │
 * │ NOT pick it up. It therefore never appears as a skipped test in   │
 * │ the normal suite — it is deliberately EXCLUDED, not skipped.      │
 * │                                                                    │
 * │ Run it on demand with:   npm run test:e2e:service                 │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * WHY it is excluded from the default run:
 *   This suite drives the REAL macOS service manager. `installService` /
 *   `uninstallService` operate on the LaunchAgent label
 *   `tech.lenne.lt-dev-caddy` and a real `caddy` bound to admin port
 *   2019. If the developer already ran `lt dev install`, that exact
 *   label + port are in use by their LIVE service — running this suite
 *   would `launchctl bootout` the user's daemon (shared label) and/or
 *   fail to bind 2019. Forcing it into `npm test` is therefore unsafe on
 *   any machine that uses `lt dev`. The mocked equivalents in
 *   `dev-service.test.ts` (injected `ShellRunner`) cover the logic in
 *   CI; this file exists only for manual, on-machine OS verification.
 *
 * What this catches that the mocked tests cannot:
 *   - the rendered plist is actually accepted by `launchctl bootstrap`
 *   - `caddy run --config <our-file>` starts successfully and opens
 *     port 2019 (this is exactly the failure mode the user hit with
 *     `brew services caddy`)
 *   - `uninstallService` boots the agent out cleanly
 *
 * Even under `npm run test:e2e:service`, the in-suite guards below still
 * apply: it self-skips when not on macOS, when `caddy` is absent, or
 * when a real `lt dev` LaunchAgent is present (to protect the live
 * service from the shared-label bootout described above).
 */
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CADDYFILE_TMP = mkdtempSync(join(tmpdir(), 'lt-dev-svc-e2e-'));
process.env.LT_DEV_CADDYFILE = join(CADDYFILE_TMP, 'Caddyfile');

// Detect a pre-existing real LaunchAgent (e.g. the developer already
// ran `lt dev install`). If found, we skip the entire E2E suite —
// otherwise the tests would bootout the user's service via shared
// label and leave them with a broken setup until they re-install.
const REAL_PLIST = join(process.env.HOME || '', 'Library', 'LaunchAgents', 'tech.lenne.lt-dev-caddy.plist');
const REAL_SERVICE_PRESENT = existsSync(REAL_PLIST);

import { caddyAvailable, writeCaddyfile } from '../src/lib/caddy';
import {
  getServicePaths,
  getServiceStatus,
  installService,
  platformSupported,
  uninstallService,
  waitForServiceReady,
} from '../src/lib/dev-service';

const isDarwin = platformSupported() === 'darwin';

describe('dev-service E2E (real launchctl + caddy)', () => {
  let hasCaddy = false;
  let tmpHome: string;

  beforeAll(async () => {
    hasCaddy = await caddyAvailable();
  });

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'lt-dev-svc-e2e-home-'));
    process.env.HOME = tmpHome;
    // Stub Caddyfile (the lib reads it at module init; rewriting it here
    // ensures we always have a valid file for `caddy run`).
    writeFileSync(process.env.LT_DEV_CADDYFILE!, '# test\n', 'utf8');
    writeCaddyfile('# E2E test Caddyfile\n');
  });

  afterEach(async () => {
    // ALWAYS uninstall, even if the test failed mid-way, to avoid
    // leaving stray LaunchAgents on the developer's machine.
    try {
      await uninstallService();
    } catch {
      /* best-effort */
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(CADDYFILE_TMP, { recursive: true, force: true });
  });

  if (!isDarwin) {
    test.skip('skipped — not running on macOS', () => undefined);
    return;
  }

  if (REAL_SERVICE_PRESENT) {
    // Skipping prevents `launchctl bootout` from being invoked against
    // the user's actual lt-dev service — same label, same dance.
    test.skip(`skipped — real lt-dev plist present at ${REAL_PLIST}; would clash on shared label`, () => undefined);
    return;
  }

  test('install + start + admin endpoint responds + uninstall', async () => {
    if (!hasCaddy) {
      console.warn('[e2e] caddy not installed — skipping real launchctl test');
      return;
    }

    const ins = await installService();
    if (!ins.ok) {
      throw new Error(`installService failed: ${ins.message}`);
    }
    expect(ins.created).toBe(true);
    expect(ins.bootstrapped).toBe(true);

    const paths = getServicePaths();
    expect(existsSync(paths.unitFile)).toBe(true);

    const ready = await waitForServiceReady(10_000);
    expect(ready).toBe(true);

    const status = await getServiceStatus();
    expect(status.installed).toBe(true);
    expect(status.loaded).toBe(true);
    expect(status.daemonReachable).toBe(true);
    expect(status.pid).toBeGreaterThan(0);

    // Confirm port 2019 truly accepted a connection from another tool
    // (we used curl inside the lib — here we re-confirm via curl with
    // explicit ipv4 to detect any ::1 vs 127.0.0.1 quirks).
    const adminCode = await new Promise<null | number>((resolve) => {
      const c = spawn('curl', ['-fsS', '-o', '/dev/null', '--max-time', '2', 'http://127.0.0.1:2019/config/'], {
        stdio: 'ignore',
      });
      c.on('error', () => resolve(null));
      c.on('close', resolve);
    });
    expect(adminCode).toBe(0);

    const un = await uninstallService();
    expect(un.ok).toBe(true);
    expect(un.bootedOut).toBe(true);
    expect(existsSync(paths.unitFile)).toBe(false);
  }, 30_000);

  test('install is idempotent: second call does not re-bootstrap', async () => {
    if (!hasCaddy) {
      console.warn('[e2e] caddy not installed — skipping');
      return;
    }

    const first = await installService();
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    // Wait for the daemon to actually claim port 2019 — without this,
    // the second install can race ahead and bootstrap fails because
    // launchctl is still tearing the previous service down.
    await waitForServiceReady(10_000);

    const second = await installService();
    expect(second.ok).toBe(true);
    expect(second.created).toBe(false);

    const status = await getServiceStatus();
    expect(status.daemonReachable).toBe(true);
  }, 30_000);

  test('uninstall when nothing is installed is a clean no-op', async () => {
    const result = await uninstallService();
    expect(result.ok).toBe(true);
    expect(result.removed).toEqual([]);
  });
});
