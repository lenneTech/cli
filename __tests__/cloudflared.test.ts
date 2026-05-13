/**
 * Tests for `src/lib/cloudflared.ts`.
 *
 * Strategy: keep the pure helpers (`buildQuickTunnelArgs`,
 * `extractTrycloudflareUrl`) under tight unit coverage. The spawn-based
 * functions are mocked via a fake child-process emitter so we never
 * shell out to the real cloudflared during CI.
 */
import { EventEmitter } from 'events';
import { Readable } from 'stream';

import {
  buildQuickTunnelArgs,
  extractTrycloudflareUrl,
  spawnQuickTunnel,
  TRYCLOUDFLARE_URL_PATTERN,
} from '../src/lib/cloudflared';

/** Minimal child-process stub that emits scripted stdout/stderr/close. */
function fakeChild(): {
  child: EventEmitter & { kill: jest.Mock; stderr: Readable; stdout: Readable };
  emitClose: (code: number) => void;
  emitErr: (chunk: string) => void;
  emitOut: (chunk: string) => void;
} {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const child = Object.assign(new EventEmitter(), { kill: jest.fn(), stderr, stdout });
  return {
    child,
    emitClose: (code) => child.emit('close', code),
    emitErr: (chunk) => stderr.push(chunk),
    emitOut: (chunk) => stdout.push(chunk),
  };
}

describe('cloudflared', () => {
  describe('buildQuickTunnelArgs', () => {
    test('passes upstream URL and host-header rewrite + disables TLS verify', () => {
      const args = buildQuickTunnelArgs({
        hostHeader: 'regiokonnex.localhost',
        upstreamUrl: 'https://regiokonnex.localhost',
      });
      // Order doesn't matter for cloudflared, but stable order helps tests
      // and lets users copy-paste the equivalent invocation.
      expect(args).toEqual([
        'tunnel',
        '--no-autoupdate',
        '--no-tls-verify',
        '--http-host-header',
        'regiokonnex.localhost',
        '--url',
        'https://regiokonnex.localhost',
      ]);
    });

    test('does not leak credentials or extra flags (regression guard)', () => {
      // If a future contributor adds --token or --credentials-file it
      // would silently leak through. Lock the argv shape explicitly.
      const args = buildQuickTunnelArgs({ hostHeader: 'x.localhost', upstreamUrl: 'https://x.localhost' });
      expect(args).not.toContain('--token');
      expect(args).not.toContain('--credentials-file');
      expect(args).not.toContain('--config');
    });
  });

  describe('extractTrycloudflareUrl', () => {
    test('finds the URL in a typical box-formatted log', () => {
      const log = [
        '2026-05-13T07:00:00Z INF +-----------------------------+',
        '2026-05-13T07:00:00Z INF |  Your quick Tunnel has been created!  |',
        '2026-05-13T07:00:00Z INF |  https://gentle-river-1234-foo.trycloudflare.com  |',
        '2026-05-13T07:00:00Z INF +-----------------------------+',
      ].join('\n');
      expect(extractTrycloudflareUrl(log)).toBe('https://gentle-river-1234-foo.trycloudflare.com');
    });

    test('returns null when no URL present', () => {
      expect(extractTrycloudflareUrl('starting cloudflared ...')).toBeNull();
    });

    test('matches first occurrence only', () => {
      const log =
        'https://first-tunnel-abc.trycloudflare.com\nhttps://second-tunnel-def.trycloudflare.com';
      expect(extractTrycloudflareUrl(log)).toBe('https://first-tunnel-abc.trycloudflare.com');
    });

    test('pattern is case-insensitive but always preserves the matched casing', () => {
      // Hypothetical future cloudflared output with HTTPS in caps —
      // unlikely but a robust regex shouldn't reject it.
      expect(TRYCLOUDFLARE_URL_PATTERN.test('HTTPS://abc-def.TRYCLOUDFLARE.com')).toBe(true);
    });
  });

  describe('spawnQuickTunnel', () => {
    let fake: ReturnType<typeof fakeChild>;
    let originalSpawn: typeof import('child_process').spawn;
    let cp: typeof import('child_process');

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cp = require('child_process');
      originalSpawn = cp.spawn;
      fake = fakeChild();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cp as any).spawn = jest.fn(() => fake.child as any);
    });
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cp as any).spawn = originalSpawn;
    });

    test('resolves publicUrl once cloudflared logs the trycloudflare URL', async () => {
      const tunnel = spawnQuickTunnel({
        hostHeader: 'crm.localhost',
        upstreamUrl: 'https://crm.localhost',
      });
      // Simulate cloudflared streaming a startup banner then the URL.
      fake.emitErr('INF starting tunnel\n');
      fake.emitErr('INF Your quick Tunnel: https://gentle-river-9999.trycloudflare.com\n');

      const url = await tunnel.publicUrl;
      expect(url).toBe('https://gentle-river-9999.trycloudflare.com');
    });

    test('rejects publicUrl when cloudflared exits before publishing a URL', async () => {
      const tunnel = spawnQuickTunnel({
        hostHeader: 'crm.localhost',
        upstreamUrl: 'https://crm.localhost',
      });
      fake.emitErr('ERR failed to open tunnel\n');
      fake.emitClose(1);
      await expect(tunnel.publicUrl).rejects.toThrow(/exited.*before publishing/i);
    });

    test('returned handle exposes the child process for kill on shutdown', () => {
      const tunnel = spawnQuickTunnel({
        hostHeader: 'crm.localhost',
        upstreamUrl: 'https://crm.localhost',
      });
      expect(tunnel.child).toBe(fake.child);
      // Caller should be able to terminate the process. Use the
      // injected fake's `kill` mock as the assertion target.
      tunnel.child.kill();
      expect(fake.child.kill).toHaveBeenCalled();
    });
  });
});
