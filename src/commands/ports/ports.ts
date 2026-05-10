import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import {
  checkPortInUse,
  listenSnapshot,
  loadRegistry,
  portsForSlot,
  SLOT_BASE_API,
  SLOT_PORT_RANGE_END,
} from '../../lib/port-registry';

/**
 * Show port registry overview + live `lsof` state.
 *
 * `lt ports`              → list all reserved + currently bound dev ports
 * `lt ports check 3030`   → exit-coded check (0 = free, 1 = in use)
 * `lt ports scan <dir>`   → rebuild registry from filesystem (subcommand)
 *
 * The default action issues a single `lsof` call (via {@link listenSnapshot})
 * and filters in memory rather than spawning lsof per port — see
 * `port-registry.ts` for the rationale.
 */
const PortsCommand: GluegunCommand = {
  alias: ['p'],
  description: 'Inspect port allocation',
  hidden: false,
  name: 'ports',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { colors, info, success, warning },
    } = toolbox;

    // Sub-command "check": fast exit-coded port probe.
    if (parameters.first === 'check') {
      const port = Number(parameters.second);
      const fromMenu = Boolean(parameters.options.fromGluegunMenu);
      if (!Number.isFinite(port)) {
        warning('Usage: lt ports check <port>');
        if (!fromMenu) process.exit(2);
        return 'ports check missing-port';
      }
      const result = await checkPortInUse(port);
      if (result === null) {
        warning('lsof not available on this system.');
        if (!fromMenu) process.exit(2);
        return 'ports check no-lsof';
      }
      if (result.inUse) {
        info(`port ${port}: in use by ${result.command} (pid ${result.pid})`);
        if (!fromMenu) process.exit(1);
        return 'ports check in-use';
      }
      success(`port ${port}: free`);
      if (!fromMenu) process.exit(0);
      return 'ports check free';
    }

    // Default action: combined list. Single lsof call covers the entire slot
    // range plus all registry-allocated ports.
    const registry = loadRegistry();
    const projects = Object.entries(registry.projects);
    const wanted = new Set<number>();
    for (let p = SLOT_BASE_API; p < SLOT_PORT_RANGE_END; p++) wanted.add(p);
    for (const [, entry] of projects) {
      const ports = portsForSlot(entry.slot);
      wanted.add(ports.api);
      wanted.add(ports.app);
    }
    const snapshot = await listenSnapshot(wanted);

    info('');
    info(colors.bold('Reserved ports (registry)'));
    info(colors.dim('─'.repeat(60)));
    if (projects.length === 0) {
      info(colors.dim('  (none yet — run `lt local init` in a project)'));
    } else {
      for (const [name, entry] of projects.sort((a, b) => a[1].slot - b[1].slot)) {
        const ports = portsForSlot(entry.slot);
        const apiTag = snapshot.has(ports.api) ? colors.green('●') : colors.dim('○');
        const appTag = snapshot.has(ports.app) ? colors.green('●') : colors.dim('○');
        info(
          `  ${name.padEnd(28)} api ${apiTag} ${ports.api}   app ${appTag} ${ports.app}   ${colors.dim(entry.path)}`,
        );
      }
    }

    info('');
    info(colors.bold(`Currently bound dev ports (${SLOT_BASE_API}-${SLOT_PORT_RANGE_END - 1})`));
    info(colors.dim('─'.repeat(60)));
    let anyBound = false;
    for (let p = SLOT_BASE_API; p < SLOT_PORT_RANGE_END; p++) {
      const r = snapshot.get(p);
      if (!r) continue;
      anyBound = true;
      const owner = registryOwner(registry, p);
      info(
        `  ${String(p).padEnd(6)} ${r.command?.padEnd(12) ?? ''} pid ${r.pid}${owner ? `   ${colors.dim(owner)}` : ''}`,
      );
    }
    if (!anyBound) info(colors.dim(`  (no ports in ${SLOT_BASE_API}-${SLOT_PORT_RANGE_END - 1} range bound)`));
    info('');

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return 'ports list';
  },
};

function registryOwner(registry: ReturnType<typeof loadRegistry>, port: number): null | string {
  for (const [name, entry] of Object.entries(registry.projects)) {
    const ports = portsForSlot(entry.slot);
    if (ports.api === port) return `→ ${name} (api)`;
    if (ports.app === port) return `→ ${name} (app)`;
  }
  return null;
}

module.exports = PortsCommand;
