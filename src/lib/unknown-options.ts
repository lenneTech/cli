/**
 * Flags a command did not declare.
 *
 * gluegun parses argv with yargs-parser and no schema, so a misspelt flag is silently ignored.
 * For `lt fullstack convert-mode` that converted more than asked: the plugin docs said
 * `--skip-app`, the CLI only knows `--skip-frontend`, and with `--noConfirm` the frontend was
 * converted although the caller had asked to skip it. A command that changes a project should
 * refuse a flag it does not know rather than guess.
 */

/** Flags every command accepts: gluegun's menu, `bin/lt`, the help interceptor, confirmations. */
const GLOBAL_OPTIONS = ['compiled-build', 'fromGluegunMenu', 'h', 'help', 'help-json', 'noConfirm'];

/**
 * Options in `options` that are neither declared nor global. yargs-parser reports a kebab-case
 * flag twice (`skip-app` and `skipApp`); it is reported once, in the spelling that was typed.
 * @param options - `parameters.options` of the command
 * @param declaredFlags - The command's flags, with or without leading dashes (e.g. from its `help`)
 * @returns Unknown option names, without dashes
 */
export function findUnknownOptions(options: Record<string, unknown>, declaredFlags: readonly string[]): string[] {
  const accepted = new Set([...declaredFlags.map((flag) => flag.replace(/^-+/, '')), ...GLOBAL_OPTIONS].map(toCamel));
  const unknown = new Map<string, string>();
  for (const key of Object.keys(options)) {
    const camel = toCamel(key);
    if (!accepted.has(camel) && !unknown.has(camel)) {
      unknown.set(camel, key);
    }
  }
  return [...unknown.values()];
}

/**
 * Error text for unknown options, with the right name where a known misspelling has one.
 * @param unknown - Result of {@link findUnknownOptions}
 * @param declaredFlags - The command's flags
 * @param renamed - Known wrong name → right flag, without dashes (e.g. `skip-app` → `skip-frontend`)
 * @returns Message naming each unknown flag and listing the known ones
 */
export function formatUnknownOptions(
  unknown: readonly string[],
  declaredFlags: readonly string[],
  renamed: Readonly<Record<string, string>> = {},
): string {
  const listed = unknown.map((name) => (renamed[name] ? `--${name} (use --${renamed[name]})` : `--${name}`));
  const known = declaredFlags.map((flag) => `--${flag.replace(/^-+/, '')}`).join(', ');
  return `Unknown option${unknown.length > 1 ? 's' : ''}: ${listed.join(', ')}. Nothing was changed.\nKnown options: ${known}`;
}

/**
 * `skip-app` → `skipApp`, as yargs-parser expands it
 * @param name - Option name
 * @returns camelCase form
 */
function toCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}
