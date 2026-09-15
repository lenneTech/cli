/**
 * ANSI helpers, shared by `check.mjs` and the audit-report renderer.
 *
 * Extracted so `audit-report.mjs` can be imported by a test without pulling in
 * `check.mjs`, which runs `main()` at module scope.
 */

export const C = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

// Matching ESC is the entire point of this function: it removes the SGR sequences `C` above
// writes, so tests can assert on the text and `fail()` can print captured child output without
// escape noise. Rewriting it to dodge the rule (a RegExp built from `String.fromCharCode(27)`)
// would hide that intent from the reader in order to satisfy a linter.
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
