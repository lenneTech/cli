/**
 * The Caddy root CA in the WINDOWS certificate store, for `lt dev` inside WSL2.
 *
 * In WSL2 the browser runs on Windows. `caddy trust` reaches only the Linux trust store (for curl
 * and Node inside WSL), so Edge and Chrome on Windows rejected every `https://*.localhost` page
 * until the root certificate was imported there. WSL can run Windows programs (interop), so lt
 * dev does that itself: `certutil.exe -user -addstore Root <file>` adds it to the CURRENT USER's
 * trusted roots, which needs no admin rights; Windows shows one confirmation dialog.
 *
 * Unverified without a real WSL2 (test points for the first run there): that `certutil.exe`
 * reads the certificate through the `\\wsl.localhost\…` path `wslpath -w` prints, and that
 * Firefox, which keeps its own store, picks the root up from Windows.
 */
import { randomBytes, X509Certificate } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { caddyAdminGet } from './caddy';
import { detectCaddyRootCa } from './dev-env-bridge';
import { execArgs } from './exec-args';

/** Whether Windows trusts lt dev's Caddy root: `unknown` when Windows cannot be asked (no interop). */
export type WindowsTrust = 'no' | 'unknown' | 'yes';

/** Injection points. */
export interface WslCaDeps {
  /** Where the copy for Windows goes (default `~/.lenneTech`; tests). */
  dir?: string;
  /** The root certificate as PEM, or null when Caddy has none yet and its admin API does not answer. */
  rootPem?: () => Promise<null | string>;
  run?: WslRunner;
}

/** Runs a program with an argument list, no shell, like `execArgs`. Injectable for tests. */
export type WslRunner = (command: string, args: readonly string[]) => Promise<string>;

/**
 * The command a person runs in WSL to import the root by hand, when lt dev cannot. Single quotes:
 * the path `wslpath -w` prints starts with `\\\\wsl.localhost\\`, and inside double quotes bash and
 * zsh turn `\\\\` into `\\`, so certutil would get a path that does not exist.
 * @param windowsPath - The certificate file as Windows sees it (`wslpath -w`)
 */
export function certutilImportCommand(windowsPath: string): string {
  return `certutil.exe -user -addstore Root '${windowsPath.replace(/'/g, `'\\''`)}'`;
}

/**
 * Imports the Caddy root into the current Windows user's trusted roots. Windows asks the user to
 * confirm in a dialog; declining there makes certutil fail, which is reported.
 * @param deps - Injection points (tests)
 * @param options - `prepareOnly`: write the copy for Windows and return the command, run nothing
 */
export async function importCaddyRootIntoWindows(
  deps: WslCaDeps = {},
  options: { prepareOnly?: boolean } = {},
): Promise<{ command?: string; message: string; ok: boolean }> {
  const run = deps.run ?? execArgs;
  const pem = await (deps.rootPem ?? caddyRootPem)();
  if (!pem) return { message: 'Caddy has no local CA yet: start it with `lt dev install` first.', ok: false };
  const file = writeRootForWindows(pem, deps.dir);
  let windowsPath: string;
  try {
    windowsPath = (await run('wslpath', ['-w', file])).trim();
  } catch {
    return { message: `wslpath could not translate ${file} into a Windows path.`, ok: false };
  }
  const command = certutilImportCommand(windowsPath);
  if (options.prepareOnly)
    return { command, message: 'Run this in WSL to import the Caddy root CA into Windows.', ok: true };
  try {
    await run('certutil.exe', ['-user', '-addstore', 'Root', windowsPath]);
  } catch (err) {
    const missing = (err as { code?: string }).code === 'ENOENT';
    return {
      command,
      message: missing
        ? 'certutil.exe is not reachable from WSL (Windows interop is off). Import the certificate on Windows.'
        : 'certutil.exe did not import the certificate (declined in the Windows dialog?).',
      ok: false,
    };
  }
  return {
    command,
    message: 'Imported the Caddy root CA into the Windows certificate store (current user).',
    ok: true,
  };
}

/**
 * SHA-1 thumbprint of a PEM certificate in the form certutil prints and accepts (hex, no colons).
 * @param pem - The certificate
 */
export function rootThumbprint(pem: string): string {
  return new X509Certificate(pem).fingerprint.replace(/:/g, '').toUpperCase();
}

/**
 * Whether the current Windows user trusts lt dev's Caddy root (`certutil.exe -user -store Root
 * <thumbprint>` finds it).
 * @param deps - Injection points (tests)
 */
export async function windowsTrustsCaddyRoot(deps: WslCaDeps = {}): Promise<WindowsTrust> {
  const pem = await (deps.rootPem ?? caddyRootPem)();
  if (!pem) return 'unknown';
  let thumbprint: string;
  try {
    thumbprint = rootThumbprint(pem);
  } catch {
    return 'unknown';
  }
  try {
    await (deps.run ?? execArgs)('certutil.exe', ['-user', '-store', 'Root', thumbprint]);
    return 'yes';
  } catch (err) {
    return (err as { code?: string }).code === 'ENOENT' ? 'unknown' : 'no';
  }
}

/**
 * The root certificate lt dev's Caddy signs with: Caddy's data directory, else its admin API
 * (`GET /pki/ca/local`, which creates the CA when none exists yet, as `caddy trust` does).
 */
async function caddyRootPem(): Promise<null | string> {
  const file = detectCaddyRootCa();
  if (file) return readFileSync(file, 'utf8');
  const answer = await caddyAdminGet('/pki/ca/local', 5000);
  if (answer?.status !== 200) return null;
  try {
    const pem = (JSON.parse(answer.body) as { root_certificate?: string }).root_certificate;
    return pem && pem.includes('BEGIN CERTIFICATE') ? pem : null;
  } catch {
    return null;
  }
}

/** A copy of the root next to lt dev's other per-user files, for Windows to read. */
function writeRootForWindows(pem: string, dir = join(process.env.HOME || homedir(), '.lenneTech')): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, 'caddy-local-root.crt');
  // Never through a symlink: a fresh file (`wx` refuses an existing name), renamed over the target,
  // replaces a link instead of writing to wherever it points.
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, pem, { encoding: 'utf8', flag: 'wx' });
  renameSync(tmp, file);
  return file;
}
