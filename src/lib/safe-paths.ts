/**
 * Path checks for values that arrive from CLI flags or `lt.config` files. Those values can come
 * from a repository the user cloned (a config file in a parent directory counts too) or from an
 * AI agent running `lt` under a global permission rule, so they must not reach outside the
 * project the command was asked to work on, and must not be handed to a shell.
 */
import { execFile } from 'child_process';
import { isAbsolute, relative, resolve } from 'path';

/**
 * The program and arguments that open a file with its default application, without a shell.
 * Windows uses `explorer.exe`: `start` is a `cmd.exe` builtin, and `cmd.exe` re-parses its
 * command line, where `&` in a file name (legal on Windows) would start a second command.
 * @param platform - `process.platform`
 * @param filePath - File to open
 * @returns Program and argument list
 */
export function fileOpener(platform: NodeJS.Platform, filePath: string): { args: string[]; command: string } {
  if (platform === 'darwin') return { args: [filePath], command: 'open' };
  if (platform === 'win32') return { args: [filePath], command: 'explorer.exe' };
  return { args: [filePath], command: 'xdg-open' };
}

/**
 * Whether `target` lies inside `base` (or is `base` itself), after resolving `..` segments.
 * @param base - Directory the target must stay in
 * @param target - Path to check
 * @returns true if the target does not escape the base
 */
export function isPathInside(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Whether a name can be used as a single directory segment (a module or object name): no
 * separators, not `.` or `..`, no NUL. `join(dir, name)` with anything else leaves `dir`.
 * @param name - Name from a flag or a prompt
 * @returns true if the name stays one segment below its parent
 */
export function isSafePathSegment(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

/**
 * Open a file with its default application. Fire and forget, like before; `explorer.exe` exits
 * with 1 even on success, so errors are ignored.
 * @param filePath - File to open
 */
export function openFileWithDefaultApp(filePath: string): void {
  const { args, command } = fileOpener(process.platform, filePath);
  execFile(command, args, () => undefined);
}

/**
 * Where a path from a flag or a config file points, read against `base`, when that place lies
 * inside `base`. A relative value is taken from `base`, an absolute one as it is.
 *
 * `resolve`, never `join`: `join(base, '/tmp/x')` gives `<base>/tmp/x`, which always reads as
 * inside, so an absolute value outside the project was written somewhere under it instead of
 * being refused, and an absolute value inside it landed at `<base>/<base>/…`.
 * @param base - Directory the target must stay in
 * @param target - Relative or absolute path from a flag or a config file
 * @returns The absolute target, or null when it leaves `base`
 */
export function resolveInside(base: string, target: string): null | string {
  const resolved = resolve(base, target);
  return isPathInside(base, resolved) ? resolved : null;
}
