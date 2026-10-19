import { spawnSync } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { parseParams } from 'gluegun/build/toolbox/parameter-tools';
import { tmpdir } from 'os';
import { join } from 'path';

import { findUnknownOptions, formatUnknownOptions } from '../src/lib/unknown-options';

const options = (...argv: string[]) => parseParams(['fullstack', 'convert-mode', ...argv], {}).options;
const DECLARED = ['--to', '--skip-backend', '--skip-frontend', '--dry-run', '--noConfirm'];

describe('findUnknownOptions', () => {
  test('accepts declared flags in every spelling yargs-parser produces, plus the global ones', () => {
    expect(
      findUnknownOptions(
        options('--to', 'npm', '--skip-frontend', '--dry-run', '--noConfirm', '--help-json', '--compiled-build'),
        DECLARED,
      ),
    ).toEqual([]);
  });

  test('reports a misspelt flag once, as typed, although yargs-parser stores it twice', () => {
    expect(findUnknownOptions(options('--to', 'npm', '--skip-app', '--noConfirm'), DECLARED)).toEqual(['skip-app']);
  });

  test('names the right flag for a known misspelling', () => {
    expect(formatUnknownOptions(['skip-app', 'foo'], DECLARED, { 'skip-app': 'skip-frontend' })).toBe(
      'Unknown options: --skip-app (use --skip-frontend), --foo. Nothing was changed.\n' +
        'Known options: --to, --skip-backend, --skip-frontend, --dry-run, --noConfirm',
    );
  });
});

describe('convert-mode commands', () => {
  // Each command reads its flags from parameters.options and declares them in `help`; the unknown-
  // flag check is built from `help`. A flag read but not declared would be refused by its own command.
  test.each(['fullstack', 'frontend', 'server'])('%s convert-mode declares every flag it reads', (cmd) => {
    const source = readFileSync(join(__dirname, '..', 'src', 'commands', cmd, 'convert-mode.ts'), 'utf8');
    const helpBlock = source.slice(source.indexOf('export const help'), source.indexOf('\n};', source.indexOf('export const help')));
    const declared = [...helpBlock.matchAll(/flag: '--([^']+)'/g)].map((m) => m[1]);
    const read = [...source.matchAll(/\bparameters\.options(?:\.([a-zA-Z]+)|\['([a-z-]+)'\])/g)]
      .map((m) => m[1] ?? m[2])
      .filter((name) => name !== 'fromGluegunMenu');
    expect(read.length).toBeGreaterThan(2);
    expect(findUnknownOptions(Object.fromEntries(read.map((name) => [name, true])), declared)).toEqual([]);
  });

  test('lt fullstack convert-mode --skip-app exits 1 and changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-convert-flags-'));
    try {
      const result = spawnSync(
        process.execPath,
        [join(__dirname, '..', 'bin', 'lt'), 'fullstack', 'convert-mode', '--to', 'npm', '--skip-app', '--noConfirm'],
        { cwd: dir, encoding: 'utf8', timeout: 120000 },
      );
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain('--skip-app (use --skip-frontend)');
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
