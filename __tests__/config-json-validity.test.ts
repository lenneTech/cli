// `export {}` keeps this file a TypeScript module so its top-level
// `filesystem` does not collide with neighbouring test files that
// use the same name (TS2451 under ts-jest's shared program).
export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

/**
 * Regression guard: every JSON file under src/config/ and schemas/ MUST
 * parse as valid JSON and contain no agent tool-call artifact tags.
 * Prevents recurrence of accidental corruption (e.g. stray `</content>`
 * or `</invoke>` appended by an agent write) that would otherwise slip
 * past lint/compile and only surface as a prettier format error deep
 * inside `npm run check`.
 */
describe('JSON config file validity', () => {
  const repoRoot: string = filesystem.path(__dirname, '..');

  const collectJsonFiles = (dir: string): string[] => {
    const abs = filesystem.path(repoRoot, dir);
    if (!filesystem.exists(abs)) return [];
    return filesystem
      .list(abs)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => filesystem.path(abs, f));
  };

  const jsonFiles: string[] = [...collectJsonFiles('src/config'), ...collectJsonFiles('schemas')];

  it('discovers JSON files to validate', () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  it.each(jsonFiles)('%s parses as valid JSON', (file: string) => {
    const content = filesystem.read(file);
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it.each(jsonFiles)('%s has no stray agent tool-call artifact tags', (file: string) => {
    const content: string = filesystem.read(file);
    // Agent tool-call leakage patterns. Plain `</…>` is legitimate inside
    // JSON string values, so we only flag the specific artifact tags.
    expect(content).not.toMatch(/<\/content>|<\/invoke>|<\/function_calls>|<\/parameter>/);
  });
});
