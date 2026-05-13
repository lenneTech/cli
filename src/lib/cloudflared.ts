/**
 * Cloudflare Tunnel integration for `lt dev tunnel`.
 *
 * Quick tunnels (no Cloudflare account, ephemeral URL) are the only
 * mode supported here. Named tunnels would require multi-step Cloudflare
 * setup (auth, DNS routing) which belongs in a separate command and is
 * intentionally out of scope for this lib.
 *
 * The Caddy upstream stays unchanged: cloudflared connects to Caddy's
 * HTTPS endpoint and rewrites the `Host` header to the configured
 * `*.localhost` so Caddy's per-project block matches. Without that
 * rewrite Cloudflare's edge would forward the random `*.trycloudflare.com`
 * hostname which Caddy doesn't know.
 */
import { ChildProcess, spawn } from 'child_process';

/** Result of `cloudflared --version` probe. */
export interface CloudflaredAvailability {
  /** Absolute binary path when present. */
  binary?: string;
  /** True if `cloudflared` resolves on PATH. */
  installed: boolean;
  /** Version string, e.g. `2026.3.0`. */
  version?: string;
}

/** Live handle to a running quick tunnel. */
export interface QuickTunnel {
  /** Child process; the caller is responsible for `kill()` on shutdown. */
  child: ChildProcess;
  /** Promise that resolves once the public URL is observed in cloudflared output. */
  publicUrl: Promise<string>;
}

/** Arguments for a quick-tunnel spawn. */
export interface QuickTunnelOptions {
  /** Hostname for the `Host:` header rewrite (e.g. `regiokonnex.localhost`). */
  hostHeader: string;
  /** Local upstream URL (e.g. `https://regiokonnex.localhost`). */
  upstreamUrl: string;
}

/**
 * Match the trycloudflare URL anywhere in cloudflared's log output.
 *
 * cloudflared prints it in an ASCII-box on stderr (Linux/macOS) — exported
 * here so tests can assert the exact pattern without spawning the binary.
 */
export const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

/**
 * Build the argv list for `cloudflared tunnel --url ...`. Pure helper.
 *
 * Why each flag:
 *   --url             : the local upstream (Caddy's HTTPS endpoint)
 *   --http-host-header: tells cloudflared to rewrite Host before forwarding,
 *                       so Caddy's vhost match works for the public URL
 *   --no-tls-verify   : Caddy serves a locally-signed cert that cloudflared
 *                       cannot validate from outside the local trust store;
 *                       disabling the check is safe because the upstream
 *                       hop never leaves localhost
 */
export function buildQuickTunnelArgs(opts: QuickTunnelOptions): string[] {
  return [
    'tunnel',
    '--no-autoupdate',
    '--no-tls-verify',
    '--http-host-header',
    opts.hostHeader,
    '--url',
    opts.upstreamUrl,
  ];
}

/** Detect whether `cloudflared` is on PATH. */
export async function cloudflaredAvailable(): Promise<CloudflaredAvailability> {
  return new Promise((resolve) => {
    const child = spawn('cloudflared', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout?.on('data', (b) => (stdout += String(b)));
    child.on('error', () => resolve({ installed: false }));
    child.on('close', (code) => {
      if (code !== 0) return resolve({ installed: false });
      const match = stdout.match(/version\s+(\S+)/i);
      resolve({ binary: 'cloudflared', installed: true, version: match?.[1] });
    });
  });
}

/**
 * Extract the trycloudflare URL from a chunk of cloudflared output.
 * Returns the first match (cloudflared logs the URL exactly once).
 */
export function extractTrycloudflareUrl(output: string): null | string {
  const match = output.match(TRYCLOUDFLARE_URL_PATTERN);
  return match ? match[0] : null;
}

/**
 * Spawn a quick tunnel and resolve the public URL once cloudflared logs it.
 *
 * The returned `publicUrl` promise rejects if the child exits before
 * surfacing a URL (timeout: ~30s, then cloudflared usually emits an
 * error message and exits). The caller is expected to keep the
 * process alive (foreground command) and `child.kill()` on Ctrl-C.
 */
export function spawnQuickTunnel(opts: QuickTunnelOptions): QuickTunnel {
  const args = buildQuickTunnelArgs(opts);
  const child = spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const publicUrl: Promise<string> = new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const onChunk = (chunk: Buffer): void => {
      if (settled) return;
      buffer += String(chunk);
      const url = extractTrycloudflareUrl(buffer);
      if (url) {
        settled = true;
        resolve(url);
      }
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`cloudflared exited (code ${code}) before publishing a tunnel URL.\n${buffer.slice(-500)}`));
    });
  });

  return { child, publicUrl };
}
