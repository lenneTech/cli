import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { importCaddyRootIntoWindows, rootThumbprint, windowsTrustsCaddyRoot, WslRunner } from '../src/lib/dev-wsl-ca';

/** A throwaway self-signed root (no key kept); its SHA-1 was computed with `openssl x509 -fingerprint -sha1`. */
const PEM = `-----BEGIN CERTIFICATE-----
MIIBYzCCAQigAwIBAgIUZH/buGNTzcMAl8z3EpvSrKdVAZwwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMbHQgdGVzdCByb290MB4XDTI2MTEwNzA2MzYxMFoXDTM2MTEw
NDA2MzYxMFowFzEVMBMGA1UEAwwMbHQgdGVzdCByb290MFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAE9wfpr6nl+odfiU25KdUeO6Udnu9OZuhLj1GjgpT+790DbplS
8Q7NeHa/hIuSII9zCblJsWi02sSStt2YzwODH6MyMDAwHQYDVR0OBBYEFJWRs++3
EKeIRU6mSEWZJYoHwkLXMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSQAw
RgIhALatzzhJNEg44RluE4ABY7eM3vkoMB75xi/CGH5eyQ+SAiEAsV00t5ED3e8l
4nE8WybhEh6ya4Zob5JEe/wmL+F/zdE=
-----END CERTIFICATE-----
`;
const THUMBPRINT = '21F5B52C5909F847EA162F8141E9A39396CCD9E8';

/** A runner that records calls and answers per program. */
function runner(answers: Record<string, (args: readonly string[]) => string>): { calls: string[][]; run: WslRunner } {
  const calls: string[][] = [];
  const run: WslRunner = async (command, args) => {
    calls.push([command, ...args]);
    const answer = answers[command];
    if (!answer) throw Object.assign(new Error(`${command}: not found`), { code: 'ENOENT' });
    return answer(args);
  };
  return { calls, run };
}

const failing = (): string => {
  throw Object.assign(new Error('Command failed'), { code: 1 });
};

describe('Caddy root CA in the Windows store (WSL)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-wsl-ca-'));
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test('the thumbprint is the SHA-1 certutil uses', () => {
    expect(rootThumbprint(PEM)).toBe(THUMBPRINT);
  });

  test('asks certutil for exactly that thumbprint', async () => {
    const yes = runner({ 'certutil.exe': () => 'found' });
    expect(await windowsTrustsCaddyRoot({ rootPem: async () => PEM, run: yes.run })).toBe('yes');
    expect(yes.calls).toEqual([['certutil.exe', '-user', '-store', 'Root', THUMBPRINT]]);
    const no = runner({ 'certutil.exe': failing });
    expect(await windowsTrustsCaddyRoot({ rootPem: async () => PEM, run: no.run })).toBe('no');
  });

  test('without interop, or without a CA yet, the answer is unknown, never "trusted"', async () => {
    const noInterop = runner({});
    expect(await windowsTrustsCaddyRoot({ rootPem: async () => PEM, run: noInterop.run })).toBe('unknown');
    expect(await windowsTrustsCaddyRoot({ rootPem: async () => null, run: noInterop.run })).toBe('unknown');
  });

  test('prepare only: writes the copy, prints the command, runs no certutil', async () => {
    const { calls, run } = runner({ wslpath: () => '\\\\wsl.localhost\\Ubuntu\\home\\kai\\.lenneTech\\caddy-local-root.crt\n' });
    const result = await importCaddyRootIntoWindows({ dir, rootPem: async () => PEM, run }, { prepareOnly: true });
    expect(result.ok).toBe(true);
    // Single-quoted, so a WSL shell keeps the leading `\\\\` of the UNC path.
    expect(result.command).toBe(
      "certutil.exe -user -addstore Root '\\\\wsl.localhost\\Ubuntu\\home\\kai\\.lenneTech\\caddy-local-root.crt'",
    );
    expect(calls.map((call) => call[0])).toEqual(['wslpath']);
    expect(readFileSync(join(dir, 'caddy-local-root.crt'), 'utf8')).toBe(PEM);
  });

  test('imports into the CURRENT USER root store (no admin rights) and reports a refusal', async () => {
    const ok = runner({ 'certutil.exe': () => 'CertUtil: -addstore command completed successfully.', wslpath: () => 'C:\\x.crt' });
    expect((await importCaddyRootIntoWindows({ dir, rootPem: async () => PEM, run: ok.run })).ok).toBe(true);
    expect(ok.calls[1]).toEqual(['certutil.exe', '-user', '-addstore', 'Root', 'C:\\x.crt']);

    const declined = runner({ 'certutil.exe': failing, wslpath: () => 'C:\\x.crt' });
    const refused = await importCaddyRootIntoWindows({ dir, rootPem: async () => PEM, run: declined.run });
    expect(refused.ok).toBe(false);
    expect(refused.command).toContain('certutil.exe -user -addstore Root');

    const noInterop = runner({ wslpath: () => 'C:\\x.crt' });
    expect((await importCaddyRootIntoWindows({ dir, rootPem: async () => PEM, run: noInterop.run })).message).toContain(
      'interop',
    );
  });

  test('no CA yet: nothing is written or run', async () => {
    const { calls, run } = runner({});
    const result = await importCaddyRootIntoWindows({ dir, rootPem: async () => null, run });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
