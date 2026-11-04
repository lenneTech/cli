/**
 * Installs the check wrapper of the REAL newest lt-monorepo release into a throwaway project and
 * loads it in Node. Needs network access to GitHub, hence `*.manual.ts` (`npm run test:manual`).
 *
 * The unit suites run against fixture repositories. This one asks the question they cannot: does
 * the release `lt fullstack update` would install today arrive complete, with every module its
 * wrapper imports, and does the installed wrapper load? A wrapper whose first import resolves to
 * nothing dies with ERR_MODULE_NOT_FOUND before running a single step.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

import { CHECK_WRAPPER_REPOSITORY, fetchCheckWrapperRelease } from '../src/lib/check-wrapper-release';
import { healCheckWrapper, readWrapperVersion } from '../src/lib/heal-check-wrapper';
import { evalInNodeEsm } from './check-template-esm';

describe('check wrapper of the newest lt-monorepo release (network)', () => {
  it('installs completely and loads in Node', () => {
    // Explicit source: the test setup points LT_CHECK_WRAPPER_SOURCE at a path that does not exist.
    const { error, release } = fetchCheckWrapperRelease({ source: `https://github.com/${CHECK_WRAPPER_REPOSITORY}.git` });
    expect(error).toBeNull();
    const project = mkdtempSync(join(tmpdir(), 'lt-wrapper-e2e-'));
    try {
      writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { check: 'pnpm -r run check' } }));

      const changed = healCheckWrapper(project, release!.assetPath);

      expect(changed).toEqual(expect.arrayContaining(['package.json', 'scripts/check.mjs']));
      expect(readWrapperVersion(join(project, 'scripts', 'check.mjs'))).toBe(release!.version);
      const url = pathToFileURL(join(project, 'scripts', 'check.mjs')).href;
      const loaded = evalInNodeEsm<boolean>(`const m = await import(${JSON.stringify(url)});\nreport(typeof m.buildGroups === 'function');`);
      expect(loaded).toBe(true);
    } finally {
      release?.dispose();
      rmSync(project, { force: true, recursive: true });
    }
  }, 120_000);
});
