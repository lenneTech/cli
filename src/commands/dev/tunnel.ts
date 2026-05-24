import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyDaemonRunning } from '../../lib/caddy';
import { cloudflaredAvailable, spawnQuickTunnel } from '../../lib/cloudflared';
import { buildIdentity } from '../../lib/dev-identity';
import { resolveLayout } from '../../lib/dev-project';
import { loadRegistry } from '../../lib/dev-state';

/**
 * Expose a running `lt dev up` project to the public internet via a
 * Cloudflare Quick Tunnel.
 *
 * Quick tunnel = no Cloudflare account, ephemeral `*.trycloudflare.com`
 * URL, runs in the foreground until Ctrl-C. Designed for ad-hoc work:
 *   - mobile / tablet preview from outside the LAN
 *   - sharing a feature with a teammate during review
 *   - landing webhooks from external services
 *
 * Caveats (printed at runtime):
 *   - Auth cookies set on `<slug>.localhost` are NOT valid on the
 *     `*.trycloudflare.com` domain — log in again on the public URL.
 *   - The default tunnel exposes ONLY the App subdomain (the API stays
 *     on `*.localhost`). Use `--api` to tunnel the API instead, or
 *     start a second `lt dev tunnel --api` in parallel.
 *   - Better-Auth's `trustedOrigins` won't include the random tunnel
 *     URL — login flows that validate the origin will reject the
 *     request unless you add the URL explicitly to your API config.
 *
 * Not yet supported (deliberate, separate command if needed later):
 *   - named tunnels with persistent URL (`cloudflared tunnel create`)
 *   - parallel multi-host tunnels in one process
 *   - background/detached mode (use a separate shell for now)
 */
const TunnelCommand: GluegunCommand = {
  alias: ['tun'],
  description: 'Cloudflare quick-tunnel to a running app',
  hidden: false,
  name: 'tunnel',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (!layout.apiDir && !layout.appDir) {
      error('No API or App project detected at this path. Run `lt dev init` first.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev tunnel: not a project';
    }

    const apiMode = Boolean(parameters.options.api);
    const identity = buildIdentity(layout.root);
    const targetSub = apiMode ? identity.subdomains.api : identity.subdomains.app;
    if (!targetSub) {
      error(`No ${apiMode ? 'API' : 'App'} subdomain configured for "${identity.slug}".`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev tunnel: no target';
    }

    // Pre-flight: cloudflared installed
    const available = await cloudflaredAvailable();
    if (!available.installed) {
      error('cloudflared is not installed.');
      info(`  → ${colors.cyan('brew install cloudflared')} (macOS)`);
      info(
        `  → ${colors.cyan('https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')} (Linux/Windows)`,
      );
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev tunnel: cloudflared missing';
    }

    // Pre-flight: Caddy must be up — without it cloudflared would forward
    // to a dead upstream and the public URL would 502.
    if (!(await caddyDaemonRunning())) {
      error('Caddy daemon is not running — run `lt dev install` first.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev tunnel: caddy down';
    }
    const registry = loadRegistry();
    if (!registry.projects[identity.slug]) {
      warning(`Project "${identity.slug}" is not in the lt-dev registry. Run \`lt dev up\` first.`);
      info('  (Continuing anyway — Caddy may have a stale block.)');
    }

    const upstreamUrl = `https://${targetSub.hostname}`;
    info('');
    info(colors.bold(`lt dev tunnel — Cloudflare Quick Tunnel`));
    info(colors.dim('─'.repeat(60)));
    info(`  Upstream: ${colors.cyan(upstreamUrl)}`);
    info(colors.dim(`  cloudflared ${available.version || 'unknown'}`));
    info('');
    info(colors.dim('Starting tunnel — this typically takes 5-10 seconds ...'));

    const tunnel = spawnQuickTunnel({ hostHeader: targetSub.hostname, upstreamUrl });

    // Wire stderr through so users see cloudflared progress / errors.
    tunnel.child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(String(chunk));
    });

    let publicUrl: string;
    try {
      publicUrl = await tunnel.publicUrl;
    } catch (err) {
      error(`Tunnel failed to start: ${(err as Error).message}`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev tunnel: failed';
    }

    info('');
    success(`Public URL: ${colors.cyan(publicUrl)}`);
    info('');
    info(colors.bold('Heads up:'));
    info('  • Auth cookies set on the localhost domain are NOT valid on the tunnel URL.');
    info(`  • Better-Auth's trustedOrigins must include ${colors.cyan(publicUrl)} for login to succeed.`);
    if (!apiMode) {
      info(`  • This tunnel exposes ONLY the App. The API stays on \`${identity.subdomains.api?.hostname || '—'}\`.`);
      info('    For full external usage, start a second `lt dev tunnel --api` in another shell.');
    }
    info('');
    info(colors.dim('Stop with Ctrl-C.'));

    // Keep the foreground alive until the child exits (Ctrl-C → SIGINT
    // is forwarded to the child by the terminal, child exits, we exit).
    const exitCode = await new Promise<null | number>((resolve) => {
      tunnel.child.on('close', resolve);
      const forward = (sig: NodeJS.Signals): void => {
        if (!tunnel.child.killed) tunnel.child.kill(sig);
      };
      process.on('SIGINT', forward);
      process.on('SIGTERM', forward);
    });

    info('');
    info(colors.dim(`cloudflared exited (code ${exitCode ?? 'unknown'}).`));
    if (!parameters.options.fromGluegunMenu) process.exit(exitCode ?? 0);
    return `dev tunnel: exit=${exitCode}`;
  },
};

module.exports = TunnelCommand;
