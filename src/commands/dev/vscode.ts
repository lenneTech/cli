import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { CommandHelp } from '../../lib/command-help';
import {
  detectVariants,
  EXCLUDED_FROM_PROFILE,
  formatChange,
  isEnablingFlagSet,
  isPreventingFlagSet,
  MEMORY_PROFILE,
  selectVariants,
  tuneSettingsFile,
  VsCodeVariant,
} from '../../lib/vscode-settings';

/**
 * Tune VS Code's USER settings for machines that keep many lt monorepos open.
 *
 * Each open workspace root spawns its own pair of TypeScript servers, and the
 * "semantic" one of each pair is what actually holds the memory. Eight open
 * monorepos (api + app root each) therefore means 16 semantic servers — enough
 * to push a 32 GB machine deep into swap. This command applies the verified
 * profile in `lib/vscode-settings.ts` to every detected installation.
 *
 * Safety properties, all load-bearing:
 *   - JSONC-aware, so comments and formatting in a hand-maintained
 *     settings.json survive (a JSON.parse round-trip would delete them).
 *   - Refuses to write into a settings.json it cannot parse.
 *   - Backs up to `settings.json.bak` before the first write.
 *   - Merges the object-valued exclude maps, so hand-added entries are kept —
 *     and `--revert` SUBTRACTS only those same entries again, so an undo never
 *     takes a hand-maintained exclusion with it.
 *   - Keeps the FIRST `.bak`, so a later run (including the revert) cannot
 *     overwrite the record of the pre-tuning state.
 *   - No-op on re-run.
 *
 * `--revert` restores VS Code's default for the scalar keys rather than any
 * explicit value that preceded them; the `.bak` is the recovery path for those.
 */
const VsCodeCommand: GluegunCommand = {
  alias: ['vsc'],
  description: 'Tune VS Code memory settings',
  hidden: false,
  name: 'vscode',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { colors, info },
      prompt: { confirm },
    } = toolbox;

    // `--dry-run` PREVENTS a write, so it reads presence-as-intent: `--dry-run=1`
    // must not fall through and write. `--revert` / `--explain` merely enable
    // something, so the usual `=== true || === 'true'` is safe there.
    const dryRun = isPreventingFlagSet(parameters.options, 'dry-run', 'dryRun');
    const revert = isEnablingFlagSet(parameters.options.revert);
    const explain = isEnablingFlagSet(parameters.options.explain);

    // This command writes OUTSIDE the project, into the user's global editor
    // settings. A `defaults.noConfirm` in a repo-local `lt.config.json` — which
    // is discovered by walking up from cwd, i.e. can come from a cloned repo —
    // must not be able to silence that prompt. Only an explicit CLI flag does.
    const noConfirm = isEnablingFlagSet(parameters.options.noConfirm);

    info('');
    info(colors.bold(`lt dev vscode${revert ? ' --revert' : ''}${dryRun ? ' (dry run)' : ''}`));
    info(colors.dim('─'.repeat(64)));

    if (explain) {
      info(colors.bold('\nProfile:'));
      for (const [key, entry] of Object.entries(MEMORY_PROFILE)) {
        info(`  ${colors.cyan(key)}`);
        info(`    ${colors.dim(entry.reason)}`);
      }
      info(colors.bold('\nDeliberately NOT set:'));
      for (const item of EXCLUDED_FROM_PROFILE) {
        info(`  ${colors.yellow(item.key)}`);
        info(`    ${colors.dim(item.why)}`);
      }
      info('');
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev vscode: explained';
    }

    const all = detectVariants();
    const { targets, unknownFilter } = selectVariants(all, parameters.options.variant);

    // A bare `--variant` parses to boolean `true` and matches no id. Reporting
    // that as "no installation found" told users their editor was missing while
    // it was installed — two different problems deserve two different messages.
    if (unknownFilter) {
      info(colors.yellow(`  Unknown --variant "${unknownFilter}".`));
      info(colors.dim(`  Valid values: ${all.map((v: VsCodeVariant) => v.id).join(' | ')}`));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev vscode: unknown variant';
    }

    if (targets.length === 0) {
      info(colors.yellow('  No VS Code installation with a user settings.json found.'));
      info(colors.dim(`  Looked for: ${all.map((v: VsCodeVariant) => v.label).join(', ')}`));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev vscode: no installation found';
    }

    // Preview first — the user sees the exact before/after per key before
    // anything is written.
    let pending = 0;
    for (const target of targets) {
      const preview = tuneSettingsFile(target.settingsPath, { dryRun: true, remove: revert });
      info(`\n  ${colors.bold(target.label)} ${colors.dim(target.settingsPath)}`);
      if (preview.error) {
        info(`    ${colors.red('skipped')} — ${preview.error}`);
        continue;
      }
      for (const change of preview.changes) {
        info(`    ${formatChange(change, colors)}`);
        if (change.action !== 'unchanged') pending++;
      }
    }

    if (pending === 0) {
      info(colors.green('\n✓ already up to date — nothing to do\n'));
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev vscode: no changes needed';
    }

    if (dryRun) {
      info(colors.dim(`\n${pending} change(s) would be applied. Re-run without --dry-run to apply.\n`));
      if (!parameters.options.fromGluegunMenu) process.exit();
      return `dev vscode: dry run, ${pending} pending change(s)`;
    }

    if (!noConfirm && !(await confirm(`Apply ${pending} change(s)?`, true))) {
      info(colors.dim('\nAborted — nothing written.\n'));
      if (!parameters.options.fromGluegunMenu) process.exit();
      return 'dev vscode: aborted';
    }

    let applied = 0;
    for (const target of targets) {
      const result = tuneSettingsFile(target.settingsPath, { remove: revert });
      if (result.error) {
        info(`  ${colors.red('✗')} ${target.label}: ${result.error}`);
        continue;
      }
      if (!result.written) continue;
      applied += result.changes.filter((c) => c.action !== 'unchanged').length;
      info(`  ${colors.green('✓')} ${target.label} updated ${colors.dim(`(backup: ${result.backupPath})`)}`);
    }

    info(colors.dim('\n  Restart VS Code (or run "Developer: Reload Window") for the TS servers to pick this up.\n'));

    if (!parameters.options.fromGluegunMenu) process.exit();
    return `dev vscode: applied ${applied} change(s)`;
  },
};

export const help: CommandHelp = {
  aliases: ['vsc'],
  configuration: 'none (writes global editor settings — --noConfirm must be passed explicitly)',
  description:
    "Apply a verified low-memory profile to VS Code's user settings. Targets the per-workspace TypeScript servers, which dominate memory when many monorepos are open at once.",
  examples: ['dev vscode', 'dev vscode --dry-run', 'dev vscode --explain', 'dev vscode --revert'],
  features: [
    'JSONC-aware — preserves comments and formatting; refuses to write an unparseable file or a symlink.',
    'Backs up to settings.json.bak (the first one is kept) and merges object-valued keys, keeping hand-added entries.',
    'Detects VS Code, Insiders, Cursor and VSCodium; idempotent, with --revert subtracting only its own entries.',
  ],
  name: 'vscode',
  options: [
    { description: 'Show what would change without writing', flag: '--dry-run', type: 'boolean' },
    { description: 'Remove the profile keys again', flag: '--revert', type: 'boolean' },
    {
      description: 'Print the profile with reasons, plus the keys deliberately left out',
      flag: '--explain',
      type: 'boolean',
    },
    {
      description: 'Limit to one installation: code | insiders | cursor | vscodium',
      flag: '--variant',
      type: 'string',
    },
    { description: 'Skip the confirmation prompt', flag: '--noConfirm', type: 'boolean' },
  ],
};

module.exports = Object.assign(VsCodeCommand, { help });
