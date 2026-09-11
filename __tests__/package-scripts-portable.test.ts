import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * npm runs package.json scripts through cmd.exe on Windows. cmd.exe knows no
 * /dev/null, no `true`, no POSIX env prefixes, and passes single quotes through
 * literally — so each of these silently breaks `npm i -g @lenne.tech/cli` (the
 * postinstall) or the build on native Windows while working fine on macOS.
 *
 * `bash scripts/*.sh` entries are a known, separate gap (contributor tooling that
 * needs Git Bash) and are not covered here.
 */
describe('package.json scripts stay portable to cmd.exe', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  const scripts: Record<string, string> = pkg.scripts;

  const rules: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\/dev\/null/, reason: 'cmd.exe has no /dev/null' },
    { pattern: /\|\|\s*true\b/, reason: '`true` is not a cmd.exe command — use `|| exit 0`' },
    { pattern: /'/, reason: 'cmd.exe passes single quotes literally — use escaped double quotes' },
    { pattern: /(^|[\s;&|])[A-Z_][A-Z0-9_]*=\S/, reason: 'POSIX env prefix — pass env via cross-env or code' },
  ];

  it('contains no cmd.exe-incompatible syntax', () => {
    const violations = Object.entries(scripts).flatMap(([name, command]) =>
      rules.filter(({ pattern }) => pattern.test(command)).map(({ reason }) => `${name}: ${reason}`),
    );
    expect(violations).toEqual([]);
  });
});
