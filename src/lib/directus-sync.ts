/**
 * Policy layer for `lt directus sync`, a thin wrapper around the official
 * Directus CLI (`@directus/cli`, binary `d6s`).
 *
 * `d6s sync` moves schema AND configuration (roles, policies, permissions,
 * flows, dashboards, translations, settings) between instances through JSON
 * files in the project repo. The wrapper adds no sync logic of its own; it
 * forwards every d6s option unchanged and enforces three decisions from the
 * DEV-3113 evaluation:
 *
 * - `diff` and `push` default to `--mode merge` (creates and updates, never
 *   deletes), so a change of d6s' own default cannot widen what a push does.
 * - A non-interactive push (CI, AI agent, `--noConfirm`) never deletes:
 *   `--mode mirror` and `--dangerously-allow-delete` are refused. Columns
 *   without Directus metadata are absent from a snapshot, so a mirror push
 *   would drop them on the target — measured, it planned to drop a primary
 *   key. Deletions stay a human decision at an interactive prompt.
 * - Non-interactive runs pass `--no-interactive` (and `--yes` for push), so
 *   d6s fails instead of waiting on a prompt nobody can answer.
 *
 * Tokens never travel through this layer: d6s reads them from
 * `DIRECTUS_<PROFILE>_TOKEN` or its own credential store.
 */
import { join } from 'path';

import { findExecutable, FindExecutableOptions } from './platform';

/**
 * `@directus/cli` version run via npx when the project has no local install.
 * The CLI is versioned independently of Directus and needs Directus >= 12.2.0.
 */
export const DIRECTUS_CLI_VERSION = '12.3.1';

export const DIRECTUS_SYNC_ACTIONS = ['diff', 'pull', 'push'] as const;

export type DirectusSyncAction = (typeof DIRECTUS_SYNC_ACTIONS)[number];

export type DirectusSyncPlan = { args: string[] } | { error: string };

/** Flags that belong to lt itself and must not reach d6s. */
const LT_ONLY_FLAGS = ['--fromGluegunMenu', '--noConfirm'];

/**
 * Build the d6s argument list for one sync action.
 *
 * @param action - pull, diff or push
 * @param passthrough - options the user gave after the action, forwarded verbatim
 * @param nonInteractive - true for CI, AI agents and `--noConfirm`
 */
export function buildDirectusSyncArgs(
  action: DirectusSyncAction,
  passthrough: string[],
  nonInteractive: boolean,
): DirectusSyncPlan {
  const args = stripLtFlags(passthrough);
  const mode = flagValue(args, '--mode')?.toLowerCase();

  // Fail closed: any spelling of a deleting push is refused, not only `=== true`
  if (action === 'push' && nonInteractive) {
    if (mode === 'mirror' || hasFlag(args, '--dangerously-allow-delete')) {
      return {
        error:
          'Refusing a deleting push in a non-interactive run. Use --mode merge, or run the mirror push interactively.',
      };
    }
  }

  if (action !== 'pull' && !hasFlag(args, '--mode')) {
    args.push('--mode', 'merge');
  }

  if (nonInteractive && action === 'push' && !hasFlag(args, '--yes')) {
    args.push('--yes');
  }

  return { args: [...(nonInteractive ? ['--no-interactive'] : []), 'sync', action, ...args] };
}

/**
 * Value of `--name value` or `--name=value`, or undefined.
 */
export function flagValue(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`${name}=`)) {
      return args[i].slice(name.length + 1);
    }
    if (args[i] === name) {
      return args[i + 1];
    }
  }
  return undefined;
}

/**
 * True when `--name` is present in any spelling (`--name`, `--name=…`).
 */
export function hasFlag(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

export function isDirectusSyncAction(value: unknown): value is DirectusSyncAction {
  return typeof value === 'string' && (DIRECTUS_SYNC_ACTIONS as readonly string[]).includes(value);
}

/**
 * The raw arguments after `lt directus sync`, without the action itself.
 *
 * Taken from argv rather than gluegun's parsed options, because yargs-parser
 * rewrites d6s flags (`--no-flows` becomes `flows: false`) and d6s needs them
 * exactly as typed.
 *
 * @param argv - `process.argv.slice(2)`, e.g. `['directus', 'sync', 'push', '--to', 'prod']`
 */
export function passthroughArgs(argv: string[], action: string): string[] {
  const commandIndex = argv.findIndex((arg) => arg === 'sync' || arg === 's');
  if (commandIndex < 0) {
    return [];
  }
  const tail = argv.slice(commandIndex + 1);
  const actionIndex = tail.indexOf(action);
  if (actionIndex >= 0) {
    tail.splice(actionIndex, 1);
  }
  return tail;
}

/**
 * How to start d6s: a local install (`node_modules/.bin`) or a global one wins,
 * otherwise npx runs the pinned `@directus/cli` version.
 */
export function resolveDirectusCli(
  cwd: string,
  options: Omit<FindExecutableOptions, 'candidates'> = {},
): { args: string[]; command: string } {
  const binDir = join(cwd, 'node_modules', '.bin');
  const local = findExecutable('d6s', { ...options, candidates: [join(binDir, 'd6s'), join(binDir, 'd6s.cmd')] });
  if (local) {
    return { args: [], command: local };
  }
  return { args: ['--yes', `--package=@directus/cli@${DIRECTUS_CLI_VERSION}`, 'd6s'], command: 'npx' };
}

/**
 * Remove lt's own flags, including a separate `true`/`false` value
 * (`--noConfirm true`), so d6s never sees them.
 */
export function stripLtFlags(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const flag = LT_ONLY_FLAGS.find((name) => args[i] === name || args[i].startsWith(`${name}=`));
    if (!flag) {
      result.push(args[i]);
      continue;
    }
    if (args[i] === flag && (args[i + 1] === 'true' || args[i + 1] === 'false')) {
      i++;
    }
  }
  return result;
}
