/**
 * `scripts/windows/setup.ps1` sets up a Windows machine from zero, `docs/windows.md` documents the same
 * steps by hand. The script is fetched from GitHub by `irm … | iex`, so nothing here can run it: these
 * checks pin the properties a review would otherwise have to remember. The PowerShell parse check
 * (syntax, no PowerShell 7-only operators) needs pwsh and runs outside this suite; see the PR.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const script = readFileSync(join(root, 'scripts', 'windows', 'setup.ps1'), 'utf8');
const guide = readFileSync(join(root, 'docs', 'windows.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

/** Script lines without comments, so a rule is not satisfied or broken by prose. */
const code = script
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

describe('scripts/windows/setup.ps1', () => {
  it('is ASCII only: PowerShell 5.1 reads a downloaded .ps1 without BOM as ANSI', () => {
    const offending = [...script].filter((char) => char.charCodeAt(0) > 127);
    expect(offending).toEqual([]);
  });

  it('never calls exit: under `irm | iex` it would close the user window', () => {
    // An exit STATEMENT: at the start of a line or after `;` / `{`, optionally with a code.
    const exitStatement = /(^|[;{])\s*exit\b(\s+(\d+|\$\w+))?\s*($|[;}])/m;
    for (const sample of ['exit', '  exit 1', 'if ($x) { exit }', 'foo; exit $code']) {
      expect(sample).toMatch(exitStatement);
    }
    expect('Write-Fail "winget exit code $code"').not.toMatch(exitStatement);
    expect(code).not.toMatch(exitStatement);
  });

  it('documents every winget package it installs in docs/windows.md', () => {
    const ids = [...code.matchAll(/Install-WingetPackage '([^']+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['Git.Git', 'OpenJS.NodeJS.LTS', 'CaddyServer.Caddy', 'MongoDB.Server']);
    for (const id of ids) {
      expect(guide).toContain(`winget install --id ${id} -e`);
    }
  });

  it('sets the line-ending setting the guide recommends', () => {
    expect(code).toContain('git config --global core.autocrlf input');
    expect(guide).toContain('git config --global core.autocrlf input');
  });

  it('quotes the scoped package name (PowerShell reads a bare @ as an operator)', () => {
    expect(code).toMatch(/install -g '@lenne\.tech\/cli/);
    expect(guide).toContain('npm install -g "@lenne.tech/cli"');
  });

  it('is published under the URL that the README and the guide print', () => {
    const oneLiner =
      'irm https://raw.githubusercontent.com/lenneTech/cli/main/scripts/windows/setup.ps1 | iex';
    expect(script).toContain(oneLiner);
    expect(guide).toContain(oneLiner);
    expect(readme).toContain(oneLiner);
  });
});
