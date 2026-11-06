/**
 * WSL (Windows Subsystem for Linux) detection.
 *
 * `lt dev up` has never been verified in WSL2 with a Windows browser: Caddy needs systemd in WSL
 * and a binary allowed to bind port 443, its root CA lands in the Linux trust store only, and the
 * loopback guard in every site block (`@lt_remote not remote_ip 127.0.0.0/8 ::1`) may drop
 * requests WSL forwards from Windows. In WSL the URL block therefore names the classic start
 * (`pnpm start`, API on :3000, App on :3001, both forwarded to Windows) as the way to run a
 * project, and `lt dev up` as an option (see `dev-patches.ts#patchClaudeMd`).
 */
import { readFileSync } from 'fs';

/**
 * Whether this process runs inside WSL (1 or 2).
 * @param read - Reads a file as text (tests)
 * @param platform - `process.platform` (tests)
 * @returns true when the kernel identifies itself as Microsoft's
 */
export function isWsl(
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'linux') return false;
  // WSL2 kernels report e.g. `6.6.87.2-microsoft-standard-WSL2`, WSL1 `4.4.0-19041-Microsoft`.
  for (const file of ['/proc/sys/kernel/osrelease', '/proc/version']) {
    try {
      if (/microsoft/i.test(read(file))) return true;
    } catch {
      // Not readable: not a decision either way, try the next file.
    }
  }
  return false;
}
