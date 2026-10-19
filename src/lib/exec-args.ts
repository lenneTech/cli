/**
 * Run a program with an argument list, without a shell.
 *
 * gluegun's `system.run` hands its whole string to `child_process.exec`, i.e. to `/bin/sh` or
 * `cmd.exe`. Every value interpolated into that string is shell syntax there: a branch named
 * `main;curl …|sh`, a remote URL, a commit message, a value from a repository's `lt.config.json`.
 * Quoting does not fix it portably (`cmd.exe` has no single quotes), and validation cannot cover
 * free text. Git itself allows `;`, `|`, `$`, `(` and backticks in ref names, so even a name read
 * back from git output is not safe to interpolate. With an argument list nothing is parsed.
 */
import { execFile } from 'child_process';

import { spawnCmd } from './platform';

/**
 * Options of {@link execArgs}
 */
export interface ExecArgsOptions {
  /** Working directory (replaces the `cd <dir> &&` prefix of the shell form) */
  cwd?: string;
  /** Environment, defaults to the current one */
  env?: NodeJS.ProcessEnv;
  /** Trim the returned stdout, like gluegun's `{ trim: true }` */
  trim?: boolean;
}

/**
 * Run `command` with `args` and resolve with its stdout. Rejects like gluegun's `system.run`:
 * with the child_process error (message `Command failed: …` plus stderr) carrying `stdout`
 * and `stderr`, so existing error handling keeps working unchanged.
 * @param command - Program to run, looked up on PATH (no shell, so no `.cmd` shims on Windows)
 * @param args - Arguments, passed through verbatim
 * @param options - Working directory, environment, trimming
 * @returns stdout of the program
 */
export function execArgs(command: string, args: readonly string[], options: ExecArgsOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { cwd: options.cwd, env: options.env ?? process.env, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stderr, stdout });
          reject(error);
          return;
        }
        const out = String(stdout ?? '');
        resolve(options.trim ? out.trim() : out);
      },
    );
  });
}

/**
 * Whether a value is unsafe as an argument to {@link spawnArgs} on Windows. cross-spawn runs a
 * `.cmd` shim through `cmd.exe` with escaped arguments, but the shim re-parses its `%*`: a `"`
 * ends the quoting, `%` expands variables and a line break ends the command. On macOS and
 * Linux there is no shell and every value is safe.
 * @param value - Argument from a flag or a config file
 * @param platform - `process.platform`
 * @returns true if the value must be refused before it reaches a Windows shim
 */
export function hasCmdShimHazard(value: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && /["%\r\n]/.test(value);
}

/**
 * Whether a value can be passed to git as a ref argument (see {@link safeRef}). Surrounding
 * whitespace is ignored: values read back from git output end in a newline.
 * @param ref - Ref name from a flag, a config file or git output
 * @returns false if the ref is empty, starts with `-`, or contains whitespace or control characters
 */
export function isSafeRef(ref: string): boolean {
  // String(): gluegun hands a digits-only value over as a number (`lt git create 2314 main`).
  const value = String(ref ?? '').trim();
  const hasControlChar = [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
  return Boolean(value) && !value.startsWith('-') && !/\s/.test(value) && !hasControlChar;
}

/**
 * Guard a git ref (branch, tag, base) that is passed as a positional argument. Without a shell
 * the value cannot run a command, but git would still read a leading `-` as an option
 * (`git checkout --orphan=x`). Git refuses such branch names itself, as it refuses whitespace
 * and control characters, so no legitimate ref is rejected.
 * @param ref - Ref name from a flag, a config file or git output
 * @returns The ref without surrounding whitespace (git output ends in a newline, which the
 *   former shell strings silently treated as the end of the command)
 * @throws If the ref is empty, starts with `-`, or contains whitespace or control characters
 */
export function safeRef(ref: string): string {
  if (!isSafeRef(ref)) {
    throw new Error(`Refusing "${ref}" as a git ref: it is empty, starts with "-", or contains whitespace`);
  }
  return String(ref).trim();
}

/**
 * {@link execArgs} for programs that are npm `.cmd` shims on Windows (npm, pnpm, npx, a `bun`
 * or any CLI installed with `npm i -g`): `execFile` cannot start a `.cmd`. Delegates to
 * cross-spawn, which uses no shell on macOS/Linux and escaped `cmd.exe` arguments on Windows,
 * where callers must refuse values that {@link hasCmdShimHazard} reports. Asynchronous on
 * purpose: a synchronous spawn under a running spinner blocks Ctrl+C until the child exits.
 * @param command - Program to run
 * @param args - Arguments, passed through verbatim
 * @param options - Working directory and environment
 * @returns stdout of the program
 */
export function spawnArgs(
  command: string,
  args: readonly string[],
  options: Pick<ExecArgsOptions, 'cwd' | 'env'> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCmd(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const error = new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`);
      reject(Object.assign(error, { code, stderr, stdout }));
    });
  });
}
