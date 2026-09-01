import { filesystem } from 'gluegun';

/**
 * `src/config/vendor-runtime-deps.json` decides which upstream packages get
 * promoted into a VENDORED project's production `dependencies`. Until now
 * nothing asserted any of it — not the new better-auth trio, and not the
 * `find-file-up` entry that has been there since the feature shipped. A wrong
 * entry here does not fail a build in this repo; it fails at import time inside
 * someone else's generated project, in production, after `pnpm prune`.
 *
 * The two properties worth pinning are exactly the two that can silently rot:
 * the file stays machine-readable, and every entry is a package the promotion
 * can actually reach.
 */
describe('vendor runtime deps config', () => {
  const configPath = filesystem.path(filesystem.cwd(), 'src', 'config', 'vendor-runtime-deps.json');
  const config = JSON.parse(filesystem.read(configPath) || '{}');
  const helpers: string[] = config.runtimeHelpers || [];

  it('is a readable list of non-empty package names', () => {
    expect(Array.isArray(config.runtimeHelpers)).toBe(true);
    expect(helpers.length).toBeGreaterThan(0);
    for (const name of helpers) {
      expect(typeof name).toBe('string');
      expect(name).toMatch(/^(?:@[\w.~-]+\/)?[\w.~-]+$/);
    }
  });

  it('carries no dangling `$schema` pointer', () => {
    // The file used to reference `./vendor-runtime-deps.schema.json`, which has
    // never existed in this repo — so nothing validated it and no editor could
    // complete it, while the pointer implied both. If a schema is added later,
    // this test should be replaced by one that actually validates against it.
    if (config.$schema) {
      expect(filesystem.exists(filesystem.path(filesystem.cwd(), 'src', 'config', config.$schema))).toBe('file');
    }
  });

  it('lists only packages the promotion can actually reach', () => {
    // `isVendorRuntimeDep` is consulted in ONE place: the loop over upstream
    // `devDependencies` in `convertCloneToVendored`. A package that upstream
    // declares only as a peer (or not at all) can never match, so listing it is
    // a silent no-op — the exact failure the file's own $comment warns about.
    //
    // Checked against the local nest-server checkout when present. Skipping when
    // it is absent keeps CI hermetic, and the assertion is the point: this is a
    // cross-repo contract that nothing else in either repo states.
    const upstreamPkgPath = filesystem.path(filesystem.cwd(), '..', 'nest-server', 'package.json');
    if (filesystem.exists(upstreamPkgPath) !== 'file') {
      expect(helpers.length).toBeGreaterThan(0);
      return;
    }

    const upstream = JSON.parse(filesystem.read(upstreamPkgPath) || '{}');
    const devDeps: Record<string, string> = upstream.devDependencies || {};
    const unreachable = helpers.filter((name) => !(name in devDeps));

    expect(unreachable).toEqual([]);
  });
});
