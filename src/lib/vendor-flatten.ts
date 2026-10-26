/**
 * The flatten-fix for the one core file that imports the framework root.
 *
 * Upstream, `src/core/common/interfaces/core-persistence-model.interface.ts` imports
 * `src/index.ts` three levels up. The vendor copy moves `src/index.ts` to `src/core/index.ts`,
 * one level closer, so the specifier loses one `../`. nest-server 11 writes the directory form
 * `'../../..'`; nest-server 12 writes `'../../../index.js'` (every relative specifier carries
 * its extension, for ESM). The fix used to match only the first spelling, so a 12 core kept
 * `'../../../index.js'`, which points one level above `src/` and fails `tsc` with TS2307.
 *
 * Returns the rewritten specifier, or `undefined` for one that does not target the root.
 */
export function flattenRootIndexSpecifier(specifier: string): string | undefined {
  const match = /^\.\.\/\.\.\/\.\.(\/index(?:\.js)?)?$/.exec(specifier);
  return match ? `../..${match[1] ?? ''}` : undefined;
}

/**
 * True for a `package.json` that is nothing but nest-server 12's format marker,
 * `{ "type": "commonjs" }` (`bin/package.json`, `core/modules/migrate/helpers/package.json`).
 * The npm conversion removes such a file together with the vendored file it scopes; any other
 * content belongs to the project and stays.
 */
export function isCommonJsScopeMarker(content: string | undefined): boolean {
  if (!content) return false;
  try {
    const parsed = JSON.parse(content);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      parsed.type === 'commonjs'
    );
  } catch {
    return false;
  }
}
