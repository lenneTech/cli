/**
 * `--git-link` on the command line has to win over lt.config in every branch of the push
 * decision in `lt fullstack init`.
 *
 * Until 2026-11-03 two branches read only the config: with `--noConfirm` (and no `--git true`)
 * the flag was dropped and the workspace stayed local without a word, and interactively the
 * user was asked for the very link they had just passed. Found while preparing the Windows
 * workshop test (DEV-3320): `lt fullstack init --name x --git-link <url> --noConfirm` is the
 * call participants are told to use.
 *
 * Structural, like the neighbouring `fullstack-init-*` specs. The end-to-end check (init
 * against a local bare repository, `dev` arrives there) is in the PR.
 */
describe('lt fullstack init: --git-link', () => {
  const nodeFs = require('fs');
  const nodePath = require('path');
  const source: string = nodeFs.readFileSync(
    nodePath.join(__dirname, '..', 'src', 'commands', 'fullstack', 'init.ts'),
    'utf8',
  );

  /** Every right-hand side assigned to `gitLink`, up to the end of the statement. */
  const assignments = (): string[] =>
    [...source.matchAll(/\bgitLink =([\s\S]*?);/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());

  it('finds the assignments it checks', () => {
    expect(assignments().length).toBeGreaterThanOrEqual(4);
  });

  it('never takes the config link without trying the flag first', () => {
    const configOnly = assignments().filter((rhs) => rhs.includes('configGitLink') && !/^cliGitLink \|\|/.test(rhs));
    expect(configOnly).toEqual([]);
  });
});
