import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { resolveLayout } from '../../lib/local-project';
import {
  isPidAlive,
  listenSnapshot,
  loadLocalState,
  loadRegistry,
  portsForSlot,
  projectSlug,
} from '../../lib/port-registry';

/**
 * Show what is running for the current project.
 */
const StatusCommand: GluegunCommand = {
  alias: ['s'],
  description: 'Show local status',
  hidden: false,
  name: 'status',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, warning },
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    const slug = projectSlug(layout.root);
    const registry = loadRegistry();
    const entry = registry.projects[slug];

    info('');
    info(colors.bold(`Local status: ${slug}`));
    info(colors.dim('─'.repeat(50)));

    if (!entry) {
      warning('Not registered. Run `lt local init` first.');
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'local status: not registered';
    }

    const ports = portsForSlot(entry.slot);
    info(`  slot:  ${entry.slot}`);
    info(`  api:   http://localhost:${ports.api}`);
    info(`  app:   http://localhost:${ports.app}`);
    if (entry.dbName) info(`  db:    mongodb://127.0.0.1/${entry.dbName}`);

    const state = loadLocalState(layout.root);
    info('');
    if (!state || (!state.pids.api && !state.pids.app)) {
      info(colors.dim('  no `lt local up` session active'));
    } else {
      const apiAlive = state.pids.api ? isPidAlive(state.pids.api) : false;
      const appAlive = state.pids.app ? isPidAlive(state.pids.app) : false;
      info(`  api: ${apiAlive ? colors.green('running') : colors.red('dead')} (pid ${state.pids.api ?? '-'})`);
      info(`  app: ${appAlive ? colors.green('running') : colors.red('dead')} (pid ${state.pids.app ?? '-'})`);
      info(colors.dim(`  started: ${state.startedAt}`));
    }

    info('');
    info(colors.bold('Live port state'));
    const liveSnapshot = await listenSnapshot([ports.api, ports.app]);
    for (const port of [ports.api, ports.app]) {
      const r = liveSnapshot.get(port);
      info(`  ${port}: ${r ? colors.green(`bound to ${r.command} (pid ${r.pid})`) : colors.dim('free')}`);
    }
    info('');

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `local status ${slug}`;
  },
};

module.exports = StatusCommand;
