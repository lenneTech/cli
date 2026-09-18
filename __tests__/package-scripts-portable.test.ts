import { readFileSync } from 'fs';
import { join } from 'path';

import { bareEnvPrefixes } from '../src/lib/cross-env';

/**
 * npm runs package.json scripts through cmd.exe on Windows. cmd.exe knows no
 * /dev/null, no `true`, no POSIX env prefixes, and passes single quotes through
 * literally — so each of these silently breaks `npm i -g @lenne.tech/cli` (the
 * postinstall) or the build on native Windows while working fine on macOS.
 *
 * `bash scripts/*.sh` entries are a known, separate gap (contributor tooling that
 * needs Git Bash) and are not covered here.
 *
 * The env-prefix rule runs through `bareEnvPrefixes`, which ignores the
 * assignments `cross-env` carries. A plain expression would report
 * `cross-env NODE_ENV=x cmd` — the very fix this rule's reason recommends — as a
 * violation, and the next script converted for Windows would turn it red.
 */
describe('package.json scripts stay portable to cmd.exe', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  const scripts: Record<string, string> = pkg.scripts;

  const violationsIn = (command: string): string[] => {
    const rules: Array<{ hit: boolean; reason: string }> = [
      { hit: /\/dev\/null/.test(command), reason: 'cmd.exe has no /dev/null' },
      { hit: /\|\|\s*true\b/.test(command), reason: '`true` is not a cmd.exe command — use `|| exit 0`' },
      { hit: /'/.test(command), reason: 'cmd.exe passes single quotes literally — use escaped double quotes' },
      {
        hit: bareEnvPrefixes(command).length > 0,
        reason: `POSIX env prefix (${bareEnvPrefixes(command).join(', ')}) — wrap the command in cross-env`,
      },
    ];
    return rules.filter(({ hit }) => hit).map(({ reason }) => reason);
  };

  it('contains no cmd.exe-incompatible syntax', () => {
    const violations = Object.entries(scripts).flatMap(([name, command]) =>
      violationsIn(command).map((reason) => `${name}: ${reason}`),
    );
    expect(violations).toEqual([]);
  });

  it('still reports what it is meant to catch — including a half-converted chain', () => {
    // Without this the suite would stay green if the rules stopped matching.
    expect(violationsIn('node x 2>/dev/null')).toEqual(['cmd.exe has no /dev/null']);
    expect(violationsIn('node x || true')).toEqual(['`true` is not a cmd.exe command — use `|| exit 0`']);
    expect(violationsIn("eslint 'src/**/*.ts'")).toEqual([
      'cmd.exe passes single quotes literally — use escaped double quotes',
    ]);
    expect(violationsIn('NODE_ENV=test jest')).toEqual(['POSIX env prefix (NODE_ENV=test) — wrap the command in cross-env']);
    expect(violationsIn('cross-env NODE_ENV=test jest && NODE_ENV=test tsc')).toEqual([
      'POSIX env prefix (NODE_ENV=test) — wrap the command in cross-env',
    ]);
  });

  it('accepts a fully converted command', () => {
    expect(violationsIn('cross-env NODE_ENV=test jest --runInBand')).toEqual([]);
    expect(violationsIn('cross-env A=1 B=2 node x && cross-env A=1 node y')).toEqual([]);
  });
});
