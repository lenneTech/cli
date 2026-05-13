/**
 * Tests for `src/lib/dev-service.ts`.
 *
 * Strategy:
 *   - Pure render functions (plist, systemd unit) are tested directly.
 *   - Side-effecting service operations are tested with a recording
 *     ShellRunner — no real launchctl / systemctl invocations. The
 *     runner records every (cmd, args) tuple so we can assert the
 *     exact wire format. This protects against silent regressions in
 *     launchctl/systemctl flag names which are easy to get wrong.
 *   - File-system side effects are scoped to a temp dir via injected
 *     HOME — never touches `~/Library/LaunchAgents` on the real user.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

// Caddyfile path must be injected BEFORE importing dev-service (caddy paths is captured at import time).
const CADDYFILE_TMP = mkdtempSync(join(tmpdir(), 'lt-dev-service-caddy-'));
process.env.LT_DEV_CADDYFILE = join(CADDYFILE_TMP, 'Caddyfile');

import {
  getServicePaths,
  installService,
  platformSupported,
  renderLaunchAgentPlist,
  renderSystemdUnit,
  SERVICE_LABEL,
  ServiceConfig,
  setShellRunner,
  ShellResult,
  ShellRunner,
  uninstallService,
} from '../src/lib/dev-service';

interface RecordedCall {
  args: string[];
  cmd: string;
}

function makeRecorder(scripted: (call: RecordedCall) => ShellResult): { calls: RecordedCall[]; runner: ShellRunner } {
  const calls: RecordedCall[] = [];
  const runner: ShellRunner = async (cmd, args) => {
    const call = { args, cmd };
    calls.push(call);
    return scripted(call);
  };
  return { calls, runner };
}

const ok = (stdout = ''): ShellResult => ({ code: 0, ok: true, stderr: '', stdout });
const fail = (stderr = '', code = 1): ShellResult => ({ code, ok: false, stderr, stdout: '' });

/** Pre-seed a unit file at the canonical location, creating parent dirs as needed. */
function seedUnitFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

describe('dev-service', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'lt-dev-service-home-'));
    // dev-service reads HOME via os.homedir(); override there.
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    setShellRunner(null);
    rmSync(tmpHome, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(CADDYFILE_TMP, { recursive: true, force: true });
  });

  // ─── Pure helpers ────────────────────────────────────────────────────────

  describe('SERVICE_LABEL', () => {
    test('is the stable reverse-DNS label', () => {
      expect(SERVICE_LABEL).toBe('tech.lenne.lt-dev-caddy');
    });
  });

  describe('platformSupported', () => {
    test('returns a known platform identifier', () => {
      const plat = platformSupported();
      expect(['darwin', 'linux', 'unsupported']).toContain(plat);
    });
  });

  describe('getServicePaths', () => {
    test('macOS places plist under ~/Library/LaunchAgents', () => {
      const paths = getServicePaths(tmpHome, 'darwin');
      expect(paths.platform).toBe('darwin');
      expect(paths.unitFile).toBe(join(tmpHome, 'Library', 'LaunchAgents', 'tech.lenne.lt-dev-caddy.plist'));
      expect(paths.logFile).toBe(join(tmpHome, '.lenneTech', 'caddy.log'));
      expect(paths.errFile).toBe(join(tmpHome, '.lenneTech', 'caddy.err.log'));
      expect(paths.label).toBe(SERVICE_LABEL);
    });

    test('Linux places systemd-user unit under ~/.config/systemd/user', () => {
      const paths = getServicePaths(tmpHome, 'linux');
      expect(paths.platform).toBe('linux');
      expect(paths.unitFile).toBe(join(tmpHome, '.config', 'systemd', 'user', 'lt-dev-caddy.service'));
    });

    test('unsupported platform yields empty unitFile but valid label', () => {
      const paths = getServicePaths(tmpHome, 'unsupported');
      expect(paths.platform).toBe('unsupported');
      expect(paths.unitFile).toBe('');
      expect(paths.label).toBe(SERVICE_LABEL);
    });
  });

  describe('renderLaunchAgentPlist — plutil validation', () => {
    // launchctl will silently fail on a syntactically-invalid plist
    // (no error in user-visible output, just a crash loop). `plutil
    // -lint` ships with macOS, so we can verify syntax for free.
    const isDarwin = platformSupported() === 'darwin';
    const maybeDarwin = isDarwin ? test : test.skip;

    maybeDarwin('output passes `plutil -lint`', async () => {
      const { spawn } = await import('child_process');
      const plist = renderLaunchAgentPlist({
        caddyBin: '/opt/homebrew/bin/caddy',
        caddyfile: join(tmpHome, '.lenneTech', 'Caddyfile'),
        errFile: join(tmpHome, '.lenneTech', 'caddy.err.log'),
        homeDir: tmpHome,
        label: SERVICE_LABEL,
        logFile: join(tmpHome, '.lenneTech', 'caddy.log'),
      });
      const file = join(tmpHome, 'check.plist');
      writeFileSync(file, plist, 'utf8');
      const code = await new Promise<null | number>((resolve) => {
        const child = spawn('plutil', ['-lint', file], { stdio: 'ignore' });
        child.on('error', () => resolve(null));
        child.on('close', resolve);
      });
      if (code === null) return; // plutil not available (CI on linux)
      expect(code).toBe(0);
    });
  });

  describe('renderLaunchAgentPlist', () => {
    const cfg: ServiceConfig = {
      caddyBin: '/opt/homebrew/bin/caddy',
      caddyfile: '/Users/dev/.lenneTech/Caddyfile',
      errFile: '/Users/dev/.lenneTech/caddy.err.log',
      homeDir: '/Users/dev',
      label: SERVICE_LABEL,
      logFile: '/Users/dev/.lenneTech/caddy.log',
    };

    test('contains the service label', () => {
      expect(renderLaunchAgentPlist(cfg)).toContain('<string>tech.lenne.lt-dev-caddy</string>');
    });

    test('passes --config to caddy run pointing at our Caddyfile', () => {
      const plist = renderLaunchAgentPlist(cfg);
      expect(plist).toContain('<string>/opt/homebrew/bin/caddy</string>');
      expect(plist).toContain('<string>run</string>');
      expect(plist).toContain('<string>--config</string>');
      expect(plist).toContain('<string>/Users/dev/.lenneTech/Caddyfile</string>');
    });

    test('sets HOME env so caddy persists CA under the user profile', () => {
      const plist = renderLaunchAgentPlist(cfg);
      expect(plist).toMatch(/<key>HOME<\/key>\s*<string>\/Users\/dev<\/string>/);
    });

    test('sets PATH covering Homebrew binaries on Apple Silicon + Intel', () => {
      const plist = renderLaunchAgentPlist(cfg);
      expect(plist).toContain('/opt/homebrew/bin');
      expect(plist).toContain('/usr/local/bin');
    });

    test('enables RunAtLoad + KeepAlive', () => {
      const plist = renderLaunchAgentPlist(cfg);
      expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
      expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    });

    test('routes stdout + stderr to dedicated log files', () => {
      const plist = renderLaunchAgentPlist(cfg);
      expect(plist).toContain('<string>/Users/dev/.lenneTech/caddy.log</string>');
      expect(plist).toContain('<string>/Users/dev/.lenneTech/caddy.err.log</string>');
    });

    test('escapes XML-sensitive characters in homeDir', () => {
      const plist = renderLaunchAgentPlist({ ...cfg, homeDir: '/Users/dev<sec>&"' });
      expect(plist).toContain('/Users/dev&lt;sec&gt;&amp;"');
    });

    test('output is well-formed plist with header + opening + closing tags', () => {
      const plist = renderLaunchAgentPlist(cfg);
      expect(plist.startsWith('<?xml version="1.0"')).toBe(true);
      expect(plist).toMatch(/<plist version="1\.0">/);
      expect(plist.trimEnd().endsWith('</plist>')).toBe(true);
    });
  });

  describe('renderSystemdUnit', () => {
    const cfg: ServiceConfig = {
      caddyBin: '/usr/bin/caddy',
      caddyfile: '/home/dev/.lenneTech/Caddyfile',
      errFile: '/home/dev/.lenneTech/caddy.err.log',
      homeDir: '/home/dev',
      label: SERVICE_LABEL,
      logFile: '/home/dev/.lenneTech/caddy.log',
    };

    test('declares Type=simple Service', () => {
      expect(renderSystemdUnit(cfg)).toMatch(/^\[Service]\nType=simple$/m);
    });

    test('ExecStart contains the caddy run command with our config', () => {
      expect(renderSystemdUnit(cfg)).toContain('ExecStart=/usr/bin/caddy run --config /home/dev/.lenneTech/Caddyfile');
    });

    test('Restart=on-failure for resilience without busy-loop on persistent error', () => {
      const unit = renderSystemdUnit(cfg);
      expect(unit).toContain('Restart=on-failure');
      expect(unit).toContain('RestartSec=5s');
    });

    test('exports HOME so caddy persists CA under the user profile', () => {
      expect(renderSystemdUnit(cfg)).toContain('Environment=HOME=/home/dev');
    });

    test('appends to log files via systemd', () => {
      const unit = renderSystemdUnit(cfg);
      expect(unit).toContain('StandardOutput=append:/home/dev/.lenneTech/caddy.log');
      expect(unit).toContain('StandardError=append:/home/dev/.lenneTech/caddy.err.log');
    });

    test('Install target is default.target so it starts at user login', () => {
      expect(renderSystemdUnit(cfg)).toContain('WantedBy=default.target');
    });
  });

  // ─── Service lifecycle (mocked launchctl) ────────────────────────────────

  describe('installService (mocked launchctl on macOS)', () => {
    const isDarwin = platformSupported() === 'darwin';
    const maybeDarwin = isDarwin ? describe : describe.skip;

    maybeDarwin('on darwin', () => {
      test('writes plist + bootstraps when not yet installed', async () => {
        const { calls, runner } = makeRecorder((call) => {
          if (call.cmd === 'which' && call.args[0] === 'caddy') return ok('/opt/homebrew/bin/caddy\n');
          // print fails → not loaded yet
          if (call.cmd === 'launchctl' && call.args[0] === 'print') return fail('Could not find service');
          // bootstrap succeeds
          if (call.cmd === 'launchctl' && call.args[0] === 'bootstrap') return ok();
          return fail(`unexpected ${call.cmd} ${call.args.join(' ')}`);
        });
        setShellRunner(runner);

        const result = await installService();

        expect(result.ok).toBe(true);
        expect(result.created).toBe(true);
        expect(result.bootstrapped).toBe(true);

        const paths = getServicePaths();
        expect(existsSync(paths.unitFile)).toBe(true);
        const written = readFileSync(paths.unitFile, 'utf8');
        expect(written).toContain('<string>tech.lenne.lt-dev-caddy</string>');
        expect(written).toContain('<string>/opt/homebrew/bin/caddy</string>');

        // bootstrap was called with gui/<uid> + path to the plist
        const bootstrapCall = calls.find((c) => c.cmd === 'launchctl' && c.args[0] === 'bootstrap');
        expect(bootstrapCall).toBeDefined();
        expect(bootstrapCall!.args[1]).toMatch(/^gui\/\d+$/);
        expect(bootstrapCall!.args[2]).toBe(paths.unitFile);
      });

      test('idempotent re-install: same content, already loaded → no-op bootstrap', async () => {
        const paths = getServicePaths();
        const { calls, runner } = makeRecorder((call) => {
          if (call.cmd === 'which' && call.args[0] === 'caddy') return ok('/opt/homebrew/bin/caddy\n');
          if (call.cmd === 'launchctl' && call.args[0] === 'print') return ok('state = running\npid = 4242\n');
          if (call.cmd === 'launchctl' && call.args[0] === 'bootstrap') return ok();
          return fail();
        });
        setShellRunner(runner);

        const first = await installService();
        expect(first.ok).toBe(true);
        const after = readFileSync(paths.unitFile, 'utf8');

        // Reset call log; second install should detect no change + skip bootstrap.
        calls.length = 0;
        const second = await installService();
        expect(second.ok).toBe(true);
        expect(second.created).toBe(false);
        // print was called once to check status; bootstrap MUST NOT have been called again.
        expect(calls.some((c) => c.cmd === 'launchctl' && c.args[0] === 'bootstrap')).toBe(false);
        expect(readFileSync(paths.unitFile, 'utf8')).toBe(after);
      });

      test('content change while loaded triggers bootout + bootstrap', async () => {
        const paths = getServicePaths();
        // Pre-write a divergent plist so installService notices a change.
        seedUnitFile(paths.unitFile, '<?xml ?><stale/>');

        const { calls, runner } = makeRecorder((call) => {
          if (call.cmd === 'which' && call.args[0] === 'caddy') return ok('/opt/homebrew/bin/caddy\n');
          if (call.cmd === 'launchctl' && call.args[0] === 'print') return ok();
          if (call.cmd === 'launchctl' && call.args[0] === 'bootout') return ok();
          if (call.cmd === 'launchctl' && call.args[0] === 'bootstrap') return ok();
          return fail();
        });
        setShellRunner(runner);

        const result = await installService();
        expect(result.ok).toBe(true);
        expect(result.created).toBe(true);

        const order = calls.filter((c) => c.cmd === 'launchctl').map((c) => c.args[0]);
        expect(order).toContain('bootout');
        expect(order).toContain('bootstrap');
        expect(order.indexOf('bootout')).toBeLessThan(order.indexOf('bootstrap'));
      });

      test('caddy not on PATH returns ok=false with actionable message', async () => {
        const { runner } = makeRecorder((call) => {
          if (call.cmd === 'which' && call.args[0] === 'caddy') return fail('not found');
          return fail();
        });
        setShellRunner(runner);

        const result = await installService();
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/caddy not found/i);
        expect(existsSync(getServicePaths().unitFile)).toBe(false);
      });

      test('explicit caddyBin bypasses `which` lookup', async () => {
        const { calls, runner } = makeRecorder((call) => {
          if (call.cmd === 'launchctl' && call.args[0] === 'print') return fail();
          if (call.cmd === 'launchctl' && call.args[0] === 'bootstrap') return ok();
          if (call.cmd === 'which') throw new Error('should not call which when caddyBin is explicit');
          return fail();
        });
        setShellRunner(runner);

        await installService({ caddyBin: '/explicit/path/caddy' });
        expect(calls.find((c) => c.cmd === 'which')).toBeUndefined();
        const plist = readFileSync(getServicePaths().unitFile, 'utf8');
        expect(plist).toContain('<string>/explicit/path/caddy</string>');
      });

      test('bootstrap failure surfaces error message + leaves unit file', async () => {
        const { runner } = makeRecorder((call) => {
          if (call.cmd === 'which' && call.args[0] === 'caddy') return ok('/opt/homebrew/bin/caddy\n');
          if (call.cmd === 'launchctl' && call.args[0] === 'print') return fail();
          if (call.cmd === 'launchctl' && call.args[0] === 'bootstrap') return fail('5: Input/output error');
          return fail();
        });
        setShellRunner(runner);

        const result = await installService();
        expect(result.ok).toBe(false);
        expect(result.bootstrapped).toBe(false);
        expect(result.message).toMatch(/bootstrap failed/i);
        // Unit file still exists for inspection.
        expect(existsSync(getServicePaths().unitFile)).toBe(true);
      });
    });
  });

  describe('uninstallService (mocked launchctl on macOS)', () => {
    const isDarwin = platformSupported() === 'darwin';
    const maybeDarwin = isDarwin ? describe : describe.skip;

    maybeDarwin('on darwin', () => {
      test('boots out + removes plist when installed + loaded', async () => {
        const paths = getServicePaths();
        // simulate prior install
        seedUnitFile(paths.unitFile, '<?xml ?><plist/>');

        const { calls, runner } = makeRecorder((call) => {
          if (call.cmd === 'launchctl' && call.args[0] === 'print') return ok('running');
          if (call.cmd === 'launchctl' && call.args[0] === 'bootout') return ok();
          return fail();
        });
        setShellRunner(runner);

        const result = await uninstallService();
        expect(result.ok).toBe(true);
        expect(result.bootedOut).toBe(true);
        expect(result.removed).toContain(paths.unitFile);
        expect(existsSync(paths.unitFile)).toBe(false);
        // bootout must be invoked AFTER print confirmed presence.
        const labels = calls.filter((c) => c.cmd === 'launchctl').map((c) => c.args[0]);
        expect(labels).toEqual(['print', 'bootout']);
      });

      test('idempotent: nothing installed → ok with empty removed list', async () => {
        const { calls, runner } = makeRecorder(() => fail());
        setShellRunner(runner);

        const result = await uninstallService();
        expect(result.ok).toBe(true);
        expect(result.removed).toEqual([]);
        // bootout should NOT run when no plist exists.
        expect(calls.find((c) => c.cmd === 'launchctl' && c.args[0] === 'bootout')).toBeUndefined();
      });

      test('tolerates "service not loaded" errors during bootout', async () => {
        const paths = getServicePaths();
        seedUnitFile(paths.unitFile, '<plist/>');

        const { runner } = makeRecorder((call) => {
          if (call.cmd === 'launchctl' && call.args[0] === 'print') return ok();
          if (call.cmd === 'launchctl' && call.args[0] === 'bootout') return fail('No such process');
          return fail();
        });
        setShellRunner(runner);

        const result = await uninstallService();
        expect(result.ok).toBe(true);
        expect(result.bootedOut).toBe(true);
        expect(result.removed).toContain(paths.unitFile);
      });
    });
  });

  // ─── Combined lifecycle ──────────────────────────────────────────────────

  describe('install → uninstall round-trip', () => {
    const isDarwin = platformSupported() === 'darwin';
    const maybeDarwin = isDarwin ? test : test.skip;

    maybeDarwin('leaves no plist behind after symmetric calls', async () => {
      let bootstrapped = false;
      const runner: ShellRunner = async (cmd, args) => {
        if (cmd === 'which' && args[0] === 'caddy') return ok('/opt/homebrew/bin/caddy\n');
        if (cmd === 'launchctl' && args[0] === 'print') return bootstrapped ? ok('running') : fail();
        if (cmd === 'launchctl' && args[0] === 'bootstrap') {
          bootstrapped = true;
          return ok();
        }
        if (cmd === 'launchctl' && args[0] === 'bootout') {
          bootstrapped = false;
          return ok();
        }
        return fail();
      };
      setShellRunner(runner);

      const ins = await installService();
      expect(ins.ok).toBe(true);
      expect(existsSync(getServicePaths().unitFile)).toBe(true);

      const un = await uninstallService();
      expect(un.ok).toBe(true);
      expect(existsSync(getServicePaths().unitFile)).toBe(false);
    });
  });
});
