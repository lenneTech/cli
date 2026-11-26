import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

/**
 * An environment whose PATH starts with a directory holding a do-nothing `pnpm`.
 *
 * `lt fullstack init` refuses before its first prompt when pnpm is not on PATH
 * (`src/lib/toolchain-preflight.ts`). A test that starts the real CLI to reach a LATER refusal
 * (an existing folder, a complete workspace) would otherwise depend on the host: GitHub's
 * runners have no pnpm, a developer machine usually has one. The stub answers `--version` and
 * nothing else; these tests never get as far as an install. `pnpm.cmd` is the Windows variant
 * (`findExecutable` matches PATHEXT names only there).
 */
export function envWithStubPnpm(): { cleanup: () => void; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), 'lt-stub-pnpm-'));
  writeFileSync(join(dir, 'pnpm'), '#!/bin/sh\necho 11.0.0\n');
  chmodSync(join(dir, 'pnpm'), 0o755);
  writeFileSync(join(dir, 'pnpm.cmd'), '@echo 11.0.0\r\n');
  // Windows spells the variable `Path`; a second `PATH` key next to it would be ignored.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  return {
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
    env: { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey] ?? ''}` },
  };
}
