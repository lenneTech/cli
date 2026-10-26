/**
 * The vendor copy moves upstream `src/index.ts` to `src/core/index.ts`, so the one core file that
 * imports the framework root needs one `../` less. nest-server 12 spells that import with its
 * extension, which the old exact-match rewrite missed: a 12 core failed `tsc` with TS2307 on
 * `'../../../index.js'` (measured 2026-10-26 in `scripts/test-vendor-init.sh vendor-both`).
 */
import { flattenRootIndexSpecifier, isCommonJsScopeMarker } from '../src/lib/vendor-flatten';

describe('flattenRootIndexSpecifier', () => {
  it('nest-server 11: directory form', () => {
    expect(flattenRootIndexSpecifier('../../..')).toBe('../..');
  });

  it('nest-server 12: explicit index with extension (ESM-ready core)', () => {
    expect(flattenRootIndexSpecifier('../../../index.js')).toBe('../../index.js');
  });

  it('explicit index without extension', () => {
    expect(flattenRootIndexSpecifier('../../../index')).toBe('../../index');
  });

  it('leaves every other specifier alone', () => {
    for (const spec of ['../..', '../../../core.module.js', '../../../../index.js', './index.js', 'mongoose']) {
      expect(flattenRootIndexSpecifier(spec)).toBeUndefined();
    }
  });
});

describe('isCommonJsScopeMarker', () => {
  it("recognises nest-server 12's marker, in any formatting", () => {
    expect(isCommonJsScopeMarker('{ "type": "commonjs" }\n')).toBe(true);
    expect(isCommonJsScopeMarker('{\n  "type": "commonjs"\n}')).toBe(true);
  });

  it('never claims a file the project wrote itself', () => {
    for (const content of [
      '{ "type": "commonjs", "name": "own-tooling" }',
      '{ "type": "module" }',
      '[]',
      'null',
      'not json',
      '',
      undefined,
    ]) {
      expect(isCommonJsScopeMarker(content)).toBe(false);
    }
  });
});
