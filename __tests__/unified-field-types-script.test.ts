/**
 * nest-server 12.8.7 ships `bin/check-unified-field-types.js` (package bin
 * `nest-check-unified-field-types`), and nest-server-starter runs it as
 * `check:unified-field-types` in `check:raw`, and with `-- --fix` in `check:fix` and `check:naf`.
 * A vendored project has no package bin, so the conversion points the script at the copied file;
 * with a core that does not ship the file (before 12.8.7) the script and its calls go.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  UNIFIED_FIELD_TYPES_NPM_COMMAND,
  UNIFIED_FIELD_TYPES_VENDOR_COMMAND,
  unifiedFieldTypesScriptsForNpm,
  unifiedFieldTypesScriptsForVendor,
} from '../src/lib/unified-field-types-script';

/** The shape nest-server-starter ships with the 12.8.7 lock-step (agreed with nest-server-8b). */
const starterScripts = (): Record<string, string> => ({
  'check:fix': 'pnpm run lint:fix && pnpm run check:unified-field-types -- --fix && pnpm run format && pnpm test',
  'check:naf': 'pnpm run lint:fix && pnpm run check:unified-field-types -- --fix && pnpm run format && pnpm run build',
  'check:raw': 'pnpm run lint && pnpm run check:unified-field-types && pnpm test && pnpm run build',
  'check:unified-field-types': 'nest-check-unified-field-types',
  test: 'vitest run',
});

describe('unifiedFieldTypesScriptsForVendor', () => {
  test('with the bin shipped, only the script value changes; the chains call it by name', () => {
    const scripts = starterScripts();
    unifiedFieldTypesScriptsForVendor(scripts, true);

    expect(scripts['check:unified-field-types']).toBe(UNIFIED_FIELD_TYPES_VENDOR_COMMAND);
    expect(UNIFIED_FIELD_TYPES_VENDOR_COMMAND).toBe('node ./bin/check-unified-field-types.js');
    expect({ ...scripts, 'check:unified-field-types': 'x' }).toEqual({
      ...starterScripts(),
      'check:unified-field-types': 'x',
    });
  });

  test('without the bin (core < 12.8.7), the script and every call of it go, the rest of each chain stays', () => {
    const scripts = starterScripts();
    unifiedFieldTypesScriptsForVendor(scripts, false);

    expect(scripts['check:unified-field-types']).toBeUndefined();
    expect(scripts['check:raw']).toBe('pnpm run lint && pnpm test && pnpm run build');
    expect(scripts['check:fix']).toBe('pnpm run lint:fix && pnpm run format && pnpm test');
    expect(scripts['check:naf']).toBe('pnpm run lint:fix && pnpm run format && pnpm run build');
    expect(scripts.test).toBe('vitest run');
  });

  test('a call at the start or end of a chain is removed cleanly, other package managers too', () => {
    const scripts: Record<string, string> = {
      a: 'npm run check:unified-field-types && npm test',
      b: 'yarn lint && yarn run check:unified-field-types -- --fix',
      'check:unified-field-types': 'nest-check-unified-field-types',
    };
    unifiedFieldTypesScriptsForVendor(scripts, false);

    expect(scripts).toEqual({ a: 'npm test', b: 'yarn lint' });
  });

  test('a starter without the script is left as it is, with or without the bin', () => {
    const scripts: Record<string, string> = { 'check:raw': 'pnpm run lint && pnpm test' };
    unifiedFieldTypesScriptsForVendor(scripts, true);
    unifiedFieldTypesScriptsForVendor(scripts, false);

    expect(scripts).toEqual({ 'check:raw': 'pnpm run lint && pnpm test' });
  });

  test('a project that changed the script keeps its own value', () => {
    const scripts: Record<string, string> = { 'check:unified-field-types': 'node ./tools/my-check.js' };
    unifiedFieldTypesScriptsForVendor(scripts, true);

    expect(scripts['check:unified-field-types']).toBe('node ./tools/my-check.js');
  });
});

describe('unifiedFieldTypesScriptsForNpm', () => {
  test('the vendored value goes back to the package bin; anything else stays', () => {
    const scripts = starterScripts();
    unifiedFieldTypesScriptsForVendor(scripts, true);
    unifiedFieldTypesScriptsForNpm(scripts);
    expect(scripts['check:unified-field-types']).toBe(UNIFIED_FIELD_TYPES_NPM_COMMAND);
    expect(scripts).toEqual(starterScripts());

    const own: Record<string, string> = { 'check:unified-field-types': 'node ./tools/my-check.js' };
    unifiedFieldTypesScriptsForNpm(own);
    expect(own['check:unified-field-types']).toBe('node ./tools/my-check.js');
  });
});

describe('the conversion wires it (server.ts has no harness for a full clone)', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'extensions', 'server.ts'), 'utf8');

  test('convertCloneToVendored copies the bin next to migrate.js and rewrites the scripts', () => {
    expect(source).toMatch(/filesystem\.copy\(`\$\{tmpClone\}\/\$\{UNIFIED_FIELD_TYPES_BIN\}`/);
    expect(source).toMatch(/unifiedFieldTypesScriptsForVendor\(scripts, unifiedFieldTypesBinShipped\)/);
  });

  test('convertToNpmMode removes the copied bin and restores the package bin', () => {
    expect(source).toMatch(/unifiedFieldTypesScriptsForNpm\(scripts\)/);
    expect(source).toMatch(/filesystem\.remove\(`\$\{dest\}\/\$\{UNIFIED_FIELD_TYPES_BIN\}`\)/);
  });
});
