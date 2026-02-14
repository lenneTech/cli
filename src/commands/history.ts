import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * View and manage command history
 */
const HistoryCommand: GluegunCommand = {
  alias: ['hist', 'h'],
  description: 'View command history',
  hidden: false,
  name: 'history',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      history,
      parameters,
      print: { colors, info, success },
      prompt,
    } = toolbox;

    const action = parameters.first?.toLowerCase();
    const count = parseInt(parameters.second || '20', 10);

    // Clear history
    if (action === 'clear') {
      const confirmed = parameters.options.noConfirm || (await prompt.confirm('Clear command history?'));
      if (confirmed) {
        history.clear();
        success('History cleared.');
      }
      return 'history: clear';
    }

    // Search history
    if (action === 'search' && parameters.second) {
      const results = history.search(parameters.second);
      if (results.length === 0) {
        info(`No matches for "${parameters.second}"`);
        return 'history: search empty';
      }

      info('');
      info(colors.bold(`Search results for "${parameters.second}":`));
      info(colors.dim('─'.repeat(60)));

      const entries = history.getHistory();
      results.forEach((entry) => {
        const index = entries.indexOf(entry) + 1;
        info(history.formatEntry(entry, index));
      });

      info('');
      return 'history: search';
    }

    // Show last N entries (default)
    const entries = history.getLast(isNaN(count) ? 20 : count);

    if (entries.length === 0) {
      info('No command history yet.');
      info(colors.dim('Commands will be recorded as you use lt.'));
      return 'history: empty';
    }

    info('');
    info(colors.bold('Command History'));
    info(colors.dim('─'.repeat(60)));

    const allEntries = history.getHistory();
    const startIndex = allEntries.length - entries.length + 1;

    entries.forEach((entry, i) => {
      info(history.formatEntry(entry, startIndex + i));
    });

    info('');
    info(colors.dim(`Showing last ${entries.length} of ${allEntries.length} commands`));
    info(colors.dim('Usage: lt history [count] | lt history search <pattern> | lt history clear'));
    info('');

    return 'history: list';
  },
};

export default HistoryCommand;
