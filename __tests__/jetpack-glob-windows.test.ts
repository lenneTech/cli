/**
 * Guard against a whole class of silent Windows breakage: `filesystem.find()`
 * with a glob that contains a slash.
 *
 * gluegun's `filesystem.find` is fs-jetpack, which builds its matcher by
 * string-concatenating the RESOLVED ABSOLUTE base directory in front of the
 * pattern (`fs-jetpack/lib/utils/matcher.js` -> `convertPatternToAbsolutePath`).
 * On Windows that base is backslash-separated, and minimatch treats a backslash
 * inside a PATTERN as an escape character — it normalises separators on the file
 * side only. So `C:\ws\src` + `**\/*.ts` collapses to a literal that matches
 * nothing, `find()` returns `[]`, and the caller reports success having done
 * nothing at all.
 *
 * That silence is what makes it worth a guard. Three real defects shipped this
 * way: `lt fullstack init` left every api-mode marker and wrong-mode file in
 * place, `stripVendorSchemaAugmentation` never patched the vendored core, and
 * `findStaleImports` gave a conversion a clean bill of health it had not earned.
 * None of them errored; they all just quietly did nothing.
 *
 * Why it regressed at all: fs-jetpack declares `minimatch: ^3.0.2`, and
 * minimatch 3 DID normalise a pattern's separators via `path.sep`. This repo
 * pins `minimatch` as a direct dependency, so the hoisted 10.x wins — and 10.x
 * dropped that normalisation. Anyone re-introducing a slash-bearing
 * `filesystem.find` would therefore be writing code that works on their Mac and
 * fails, without a word, for every Windows user.
 *
 * The fix in every case is `globSync(pattern, { absolute: true, cwd: baseDir })`
 * from `glob` (already a direct runtime dependency), which keeps base and
 * pattern apart and normalises separators itself.
 */
import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { join } from 'path';

/** Source files to scan — the whole shipped tree, minus the templates we only copy. */
const sourceFiles = globSync('**/*.ts', {
  absolute: true,
  cwd: join(__dirname, '..', 'src'),
  ignore: ['templates/**'],
  nodir: true,
});

describe('filesystem.find must not be used with a slash-bearing glob (Windows)', () => {
  test('the scan actually sees the source tree', () => {
    // A guard that silently matches nothing is the same failure mode it exists
    // to catch, so prove the corpus is real before asserting anything about it.
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  test('no call site pairs filesystem.find with a pattern containing "/"', () => {
    // Matches `filesystem.find(<anything>)` across line breaks, then looks for a
    // `matching:` whose literal contains a slash. Deliberately textual: the point
    // is to be unmissable in review, not to type-check the argument.
    const findCall = /\.find\(\s*[\s\S]{0,200}?matching:\s*(['"`])([^'"`]*)\1/g;
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      for (const [, , pattern] of source.matchAll(findCall)) {
        if (pattern.includes('/')) offenders.push(`${file}: matching: '${pattern}'`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
