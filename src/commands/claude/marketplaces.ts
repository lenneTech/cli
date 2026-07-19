import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import {
  findClaudeCli,
  listKnownMarketplaceNames,
  readKnownMarketplaces,
  runClaudeCommand,
} from '../../lib/claude-cli';
import {
  ConfiguredMarketplace,
  getMarketplaceConfigPath,
  readConfiguredMarketplaces,
  removeConfiguredMarketplace,
  upsertConfiguredMarketplace,
} from '../../lib/marketplace-config';

/**
 * Print the configured marketplaces.
 */
function printConfigured(toolbox: ExtendedGluegunToolbox): void {
  const {
    print: { info },
  } = toolbox;
  const configured = readConfiguredMarketplaces();

  info('');
  info(`Configured marketplaces (${getMarketplaceConfigPath()}):`);
  if (configured.length === 0) {
    info('  (none yet — add one with: lt claude marketplaces add)');
    info('');
    return;
  }
  for (const m of configured) {
    const flags = [
      m.private ? 'private' : 'public',
      `provider=${m.provider ?? 'git'}`,
      `autoInstall=${m.autoInstall ?? true}`,
    ];
    info(`  ${m.name}`);
    info(`      source: ${m.source}`);
    info(`      ${flags.join(', ')}${m.description ? ` — ${m.description}` : ''}`);
  }
  info('');
}

/**
 * Resolve the marketplace name that a `claude plugin marketplace add` produced,
 * by diffing the Claude registry before/after and falling back to a source match.
 */
function resolveAddedName(source: string, before: string[]): null | string {
  const known = readKnownMarketplaces();
  const after = Object.keys(known);
  const added = after.filter((n) => !before.includes(n));
  if (added.length === 1) {
    return added[0];
  }
  // Already present (or ambiguous): match by source (repo/url contains the input).
  const needle = source.trim().replace(/\.git$/, '');
  const ownerRepo = needle.match(/[:/]([^/\s]+\/[^/\s]+)$/)?.[1] ?? needle;
  for (const [name, entry] of Object.entries(known)) {
    const src = `${entry.source?.repo ?? ''} ${entry.source?.url ?? ''}`;
    if (src.includes(ownerRepo) || src.includes(needle)) {
      return name;
    }
  }
  return null;
}

/**
 * Add (or update) a configured marketplace.
 */
async function runAdd(toolbox: ExtendedGluegunToolbox, sourceArg?: string): Promise<void> {
  const {
    parameters,
    print: { error, info, spin, success },
    prompt: { ask, confirm },
  } = toolbox;

  const cli = findClaudeCli();
  if (!cli) {
    error('Claude CLI not found. Please install Claude Code first.');
    return;
  }

  // Resolve the source (Git URL or owner/repo).
  let source = (sourceArg || (parameters.options.source as string) || '').trim();
  if (!source) {
    const answer = await ask([
      {
        message: 'Marketplace source (Git URL or owner/repo):',
        name: 'source',
        type: 'input',
      },
    ]);
    source = (answer.source || '').trim();
  }
  if (!source) {
    error('No source provided.');
    return;
  }

  // Add via the Claude CLI (this clones the repo locally, honoring the user's Git
  // access) and determine the resulting marketplace name from the registry.
  const before = listKnownMarketplaceNames();
  const addSpinner = spin(`Adding marketplace from ${source}`);
  const addResult = runClaudeCommand(cli, `plugin marketplace add ${source}`);
  if (!addResult.success && !addResult.output.includes('already')) {
    addSpinner.fail('Failed to add marketplace');
    error(addResult.output.trim());
    info('');
    info('Make sure you have access to the repository (SSH key / permissions).');
    return;
  }

  const name = resolveAddedName(source, before);
  if (!name) {
    addSpinner.fail('Could not determine the marketplace name');
    info('The repository was added to Claude, but its name could not be resolved.');
    info('Check: claude plugin marketplace list');
    return;
  }
  addSpinner.succeed(`Marketplace "${name}" available`);

  // Gather options (defaults geared towards a private internal marketplace).
  const isPrivate = await confirm('Is this a private / access-restricted repository?', true);
  const autoInstall = await confirm('Auto-install all its plugins on `lt claude plugins`?', true);
  const descAnswer = await ask([
    {
      message: 'Description (optional):',
      name: 'description',
      type: 'input',
    },
  ]);

  const entry: ConfiguredMarketplace = {
    autoInstall,
    name,
    private: isPrivate,
    provider: 'git',
    source,
  };
  const description = (descAnswer.description || '').trim();
  if (description) {
    entry.description = description;
  }

  upsertConfiguredMarketplace(entry);
  info('');
  success(`Saved marketplace "${name}" to ${getMarketplaceConfigPath()}`);
  info('It will be used automatically on the next `lt claude plugins` run.');
}

/**
 * Interactive menu when no action is given.
 */
async function runMenu(toolbox: ExtendedGluegunToolbox): Promise<void> {
  const {
    prompt: { ask },
  } = toolbox;

  printConfigured(toolbox);

  const answer = await ask([
    {
      choices: ['List', 'Add', 'Remove', 'Exit'],
      message: 'Manage Claude marketplaces',
      name: 'action',
      type: 'select',
    },
  ]);

  switch (answer.action) {
    case 'Add':
      await runAdd(toolbox);
      break;
    case 'List':
      printConfigured(toolbox);
      break;
    case 'Remove':
      await runRemove(toolbox);
      break;
    default:
      break;
  }
}

/**
 * Remove a configured marketplace.
 */
async function runRemove(toolbox: ExtendedGluegunToolbox, nameArg?: string): Promise<void> {
  const {
    print: { error, info, success, warning },
    prompt: { ask, confirm },
  } = toolbox;

  const configured = readConfiguredMarketplaces();
  if (configured.length === 0) {
    warning('No configured marketplaces to remove.');
    return;
  }

  let name = (nameArg || '').trim();
  if (!name) {
    const answer = await ask([
      {
        choices: configured.map((m) => m.name),
        message: 'Which marketplace do you want to remove?',
        name: 'name',
        type: 'select',
      },
    ]);
    name = (answer.name || '').trim();
  }

  const { removed } = removeConfiguredMarketplace(name);
  if (!removed) {
    error(`Marketplace "${name}" is not in the configuration.`);
    return;
  }
  success(`Removed "${name}" from the lt configuration.`);

  // Offer to also detach it from the Claude CLI.
  const cli = findClaudeCli();
  if (cli) {
    const alsoClaude = await confirm(`Also remove it from Claude (claude plugin marketplace remove ${name})?`, false);
    if (alsoClaude) {
      const result = runClaudeCommand(cli, `plugin marketplace remove ${name}`);
      if (result.success || result.output.includes('not found')) {
        info(`Detached "${name}" from Claude.`);
      } else {
        warning(`Could not detach from Claude: ${result.output.trim()}`);
      }
    }
  }
}

/**
 * Manage additional Claude Code plugin marketplaces (GitLab, GitHub or any Git host).
 * The configuration is stored locally so internal/private repositories never end
 * up in the (public) CLI source, and it is used on every `lt claude plugins` run.
 */
const MarketplacesCommand: GluegunCommand = {
  alias: ['mp'],
  description: 'Manage additional Claude plugin marketplaces',
  name: 'marketplaces',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { parameters } = toolbox;

    const action = (parameters.first || '').toLowerCase();
    const arg = parameters.array?.[1];

    if (action === 'list' || action === 'ls' || parameters.options.list) {
      printConfigured(toolbox);
    } else if (action === 'add' || parameters.options.add) {
      await runAdd(toolbox, action === 'add' ? arg : undefined);
    } else if (action === 'remove' || action === 'rm' || parameters.options.remove) {
      const removeName = typeof parameters.options.remove === 'string' ? parameters.options.remove : arg;
      await runRemove(toolbox, removeName);
    } else {
      await runMenu(toolbox);
    }

    if (!parameters.options.fromGluegunMenu) {
      process.exit(0);
    }
    return 'claude marketplaces';
  },
};

export default MarketplacesCommand;
