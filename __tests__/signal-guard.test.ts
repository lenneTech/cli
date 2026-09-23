import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { signalVerdict, takeViolations } from './support/signal-guard';

/**
 * The guard that stops a test from signalling a process it did not spawn.
 * Background in `support/signal-guard.ts`: the 2026-09-23 broadcast SIGTERM.
 *
 * Nothing in this file may reach a live process if the guard were broken: the
 * decision is tested as a pure function, and the wiring test aims at a pid far
 * above any pid_max, so a missing guard yields a harmless ESRCH, not a signal.
 */
describe('signal guard', () => {
  const spawned = new Set([4242]);

  it('refuses the broadcast and own-group targets whatever was spawned', () => {
    expect(signalVerdict(-1, 'SIGTERM', spawned)).toMatch(/refused/);
    expect(signalVerdict(0, 'SIGTERM', spawned)).toMatch(/refused/);
  });

  it('refuses a pid or group this worker did not spawn', () => {
    expect(signalVerdict(1, 'SIGTERM', spawned)).toMatch(/refused/);
    expect(signalVerdict(-4243, 'SIGKILL', spawned)).toMatch(/refused/);
  });

  it('allows a spawned child and its group, and any probe with signal 0', () => {
    expect(signalVerdict(4242, 'SIGTERM', spawned)).toBeNull();
    expect(signalVerdict(-4242, 'SIGKILL', spawned)).toBeNull();
    expect(signalVerdict(1, 0, spawned)).toBeNull();
  });

  it('is installed: a real process.kill on a foreign pid is intercepted', () => {
    // Without the guard this is ESRCH (no such pid) — harmless by construction.
    expect(() => process.kill(-9_999_999, 'SIGTERM')).toThrow(/signal-guard/);
    expect(takeViolations()).toHaveLength(1);
  });

  it('is registered for every suite in package.json', () => {
    const jest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).jest;
    expect(jest.setupFilesAfterEnv).toContain('<rootDir>/support/signal-guard.ts');
  });

  it('src/ builds a negative pid in exactly one place, and only from a SignalTarget', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'templates') walk(path);
        } else if (path.endsWith('.ts')) {
          readFileSync(path, 'utf-8')
            .split('\n')
            .forEach((line, i) => {
              if (/process\.kill\(\s*-/.test(line) || /\bsend\(\s*-/.test(line)) offenders.push(`${path}:${i + 1}`);
            });
        }
      }
    };
    walk(join(__dirname, '..', 'src'));
    // The one allowed site is `signalGroup`, whose parameter is a `SignalTarget`.
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatch(/src[\\/]lib[\\/]dev-process\.ts:\d+$/);
  });
});
