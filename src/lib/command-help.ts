/**
 * Generic `--help` / `-h` support for **every** lt command.
 *
 * Problem this solves: gluegun's built-in `.help()` only handles the top-level
 * `lt --help` (the command list). For a subcommand, `lt fullstack convert-mode
 * --help` simply *runs* the command — so a user who only wanted to read about a
 * command accidentally triggers it. {@link installHelpInterceptor} wraps every
 * loaded command so that, when help is requested, the command prints rich help
 * and returns **without executing**.
 *
 * Two levels of detail:
 *   1. Generic (always available) — usage, aliases and description from the
 *      command metadata gluegun already has.
 *   2. Rich (opt-in) — a command module may `export const help: CommandHelp`
 *      describing options, features, examples and configuration. The interceptor
 *      loads it from `command.file` without running the command.
 */

/** Rich help definition a command may export as `export const help`. */
export interface CommandHelp {
  aliases?: string[];
  /** lt.config keys / configuration notes for this command. */
  configuration?: string;
  description?: string;
  /** Concrete example invocations (without leading `lt`). */
  examples?: string[];
  /** Short bullet points describing what the command can do. */
  features?: string[];
  name?: string;
  options?: CommandHelpOption[];
}

/** A single documented option/flag of a command. */
export interface CommandHelpOption {
  default?: unknown;
  description: string;
  /** e.g. `--to`, `--noConfirm`, `--name` */
  flag: string;
  required?: boolean;
  /** e.g. `string`, `boolean`, `number` */
  type?: string;
  /** allowed values, e.g. `['vendor', 'npm']` */
  values?: string[];
}

/** Minimal shape of a gluegun command needed for help rendering. */
export interface HelpableCommand {
  alias?: string[];
  aliases?: string[];
  commandPath?: string[];
  description?: string;
  file?: null | string;
  name?: string;
}

/** Parameters surface — compatible with gluegun's `toolbox.parameters`. */
export interface HelpParameters {
  array?: string[];
  first?: string;
  options?: Record<string, unknown>;
}

/** Minimal print surface — compatible with gluegun's `toolbox.print`. */
export interface HelpPrint {
  colors: {
    bold: (s: string) => string;
    cyan: (s: string) => string;
    dim: (s: string) => string;
    yellow: (s: string) => string;
  };
  info: (s: string) => void;
}

/** A loaded gluegun command whose `run` can be wrapped. */
export interface InterceptableCommand extends HelpableCommand {
  __helpWrapped?: boolean;
  run?: (toolbox: { parameters?: HelpParameters; print?: HelpPrint }) => unknown;
}

/**
 * Wrap every command's `run` so that `--help` / `-h` prints help and returns
 * without executing. Call once after `build().create()`, before `cli.run()`.
 *
 * Idempotent per command (guarded by `__helpWrapped`), so a command is never
 * double-wrapped if this runs more than once in the same process (e.g. tests).
 */
export function installHelpInterceptor(
  commands: InterceptableCommand[] | undefined,
  defaultCommand?: InterceptableCommand,
): void {
  for (const command of commands || []) {
    if (typeof command.run !== 'function' || command.__helpWrapped) {
      continue;
    }
    // Leave the top-level/default command and gluegun's preloaded builtins
    // (`help`, `version` — they have `file === null`) to gluegun's own
    // `.help()`, so that `lt --help` keeps printing the brand banner + full
    // command list. Real file-backed subcommands (incl. `lt config help`) are
    // still wrapped.
    if (command === defaultCommand || !command.file || !(command.commandPath && command.commandPath.length)) {
      continue;
    }
    const originalRun = command.run;
    command.run = (toolbox) => {
      if (toolbox?.print && isHelpRequested(toolbox.parameters)) {
        renderCommandHelp(toolbox.print, command, loadCommandHelp(command.file));
        return undefined;
      }
      return originalRun(toolbox);
    };
    command.__helpWrapped = true;
  }
}

/**
 * True when the invocation asks for help (`--help` or `-h`) — but NOT for
 * `--help-json` (handled separately by `tools.helpJson`).
 */
export function isHelpRequested(parameters: HelpParameters | undefined): boolean {
  const options = parameters?.options || {};
  if (options['help-json'] === true || options.helpJson === true) {
    return false;
  }
  return options.help === true || options.h === true;
}

/** Best-effort load of a command's rich `help` export from its file. */
export function loadCommandHelp(file: null | string | undefined): CommandHelp | undefined {
  if (!file) {
    return undefined;
  }
  try {
    const mod = require(file);
    const help = (mod && (mod.help || (mod.default && mod.default.help))) as CommandHelp | undefined;
    return help && typeof help === 'object' ? help : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Render human-readable help for a command to `print`. Uses the rich `help`
 * definition when available, otherwise a useful generic fallback. Never runs
 * the command.
 */
export function renderCommandHelp(print: HelpPrint, command: HelpableCommand, help?: CommandHelp): void {
  const { bold, cyan, dim, yellow } = print.colors;
  const usage = usagePath(command);
  const description = help?.description || command.description || '(no description)';

  print.info('');
  print.info(`${bold(usage)} — ${description}`);

  const aliases = aliasList(command, help);
  if (aliases.length) {
    print.info(dim(`Aliases: ${aliases.join(', ')}`));
  }

  if (help?.features?.length) {
    print.info('');
    print.info(bold('What it does:'));
    for (const feature of help.features) {
      print.info(`  • ${feature}`);
    }
  }

  print.info('');
  print.info(bold('Usage:'));
  print.info(`  ${usage} [options]`);
  if (help?.examples?.length) {
    print.info('');
    print.info(bold('Examples:'));
    for (const example of help.examples) {
      print.info(`  ${cyan(example.startsWith('lt ') ? example : `lt ${example}`)}`);
    }
  }

  print.info('');
  print.info(bold('Options:'));
  const options = [...(help?.options || [])];
  for (const option of options) {
    const meta: string[] = [];
    if (option.required) {
      meta.push('required');
    }
    if (option.values?.length) {
      meta.push(option.values.join('|'));
    } else if (option.type) {
      meta.push(option.type);
    }
    if (option.default !== undefined) {
      meta.push(`default: ${String(option.default)}`);
    }
    const metaText = meta.length ? dim(` (${meta.join(', ')})`) : '';
    print.info(`  ${option.flag.padEnd(28)} ${option.description}${metaText}`);
  }
  // Always-present global flags
  print.info(`  ${'--help, -h'.padEnd(28)} Show this help and exit (does not run the command)`);
  print.info(`  ${'--help-json'.padEnd(28)} Machine-readable help as JSON (where provided)`);
  if (!options.some((o) => o.flag === '--noConfirm')) {
    print.info(`  ${'--noConfirm'.padEnd(28)} Skip confirmation prompts (where supported)`);
  }

  if (help?.configuration) {
    print.info('');
    print.info(bold('Configuration (lt.config.json / lt.config.yaml):'));
    for (const line of help.configuration.split('\n')) {
      print.info(`  ${line}`);
    }
  }

  if (!help) {
    print.info('');
    print.info(dim('Tip: see docs/commands.md and docs/lt.config.md for full reference.'));
  }

  print.info('');
  print.info(yellow('This is help output — the command was NOT executed.'));
  print.info('');
}

function aliasList(command: HelpableCommand, help?: CommandHelp): string[] {
  return help?.aliases || command.aliases || command.alias || [];
}

/** Resolve the user-facing invocation, e.g. `lt fullstack convert-mode`. */
function usagePath(command: HelpableCommand): string {
  const path = command.commandPath && command.commandPath.length ? command.commandPath : [command.name || ''];
  return `lt ${path.filter(Boolean).join(' ')}`.trim();
}
