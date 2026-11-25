import { filesystem } from 'gluegun';
import * as semver from 'semver';

/**
 * The entries of `runtimeHelpers` the promotion can never reach in the given
 * nest-server `package.json`: it matches upstream `devDependencies` only.
 *
 * An entry with a `runtimeHelpersSince` version is not judged while the checkout
 * is older than that release. It names a package a later nest-server release
 * adds, and a checkout from before it (a teammate's, or `origin/develop` before
 * the publish) would otherwise fail `npm test` over a package the CLI lists
 * correctly. A checkout without a readable version is judged: fail closed.
 */
function unreachableRuntimeHelpers(
  helpers: string[],
  since: Record<string, string>,
  upstream: { devDependencies?: Record<string, string>; version?: string },
): string[] {
  const devDeps = upstream.devDependencies || {};
  const upstreamVersion = semver.valid(upstream.version || '');
  return helpers.filter((name) => {
    if (name in devDeps) {
      return false;
    }
    const introducedIn = since[name];
    return !(introducedIn && upstreamVersion && semver.lt(upstreamVersion, introducedIn));
  });
}

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
  const since: Record<string, string> = config.runtimeHelpersSince || {};

  it('is a readable list of non-empty package names', () => {
    expect(Array.isArray(config.runtimeHelpers)).toBe(true);
    expect(helpers.length).toBeGreaterThan(0);
    for (const name of helpers) {
      expect(typeof name).toBe('string');
      expect(name).toMatch(/^(?:@[\w.~-]+\/)?[\w.~-]+$/);
    }
  });

  it('dates only listed entries, each with an exact nest-server version', () => {
    for (const [name, version] of Object.entries(since)) {
      expect(helpers).toContain(name);
      expect(semver.valid(version)).toBe(version);
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

    expect(unreachableRuntimeHelpers(helpers, since, upstream)).toEqual([]);
  });

  describe('reachability against a nest-server checkout', () => {
    const released = { devDependencies: { 'better-auth': '1.7.23' }, version: '12.9.4' };

    it('does not judge an entry the checkout predates', () => {
      // The state of every checkout at origin/develop while nest-server 12.10.0 is unreleased.
      expect(unreachableRuntimeHelpers(['ai', 'better-auth'], { ai: '12.10.0' }, released)).toEqual([]);
    });

    it('judges the entry once the checkout reaches its release', () => {
      const shipped = { ...released, version: '12.10.0' };
      expect(unreachableRuntimeHelpers(['ai', 'better-auth'], { ai: '12.10.0' }, shipped)).toEqual(['ai']);
    });

    it('accepts the entry where the release ships it', () => {
      const shipped = { devDependencies: { ...released.devDependencies, ai: '7.0.173' }, version: '12.10.0' };
      expect(unreachableRuntimeHelpers(['ai', 'better-auth'], { ai: '12.10.0' }, shipped)).toEqual([]);
    });

    it('judges an undated entry the checkout lacks', () => {
      expect(unreachableRuntimeHelpers(['find-file-up', 'better-auth'], {}, released)).toEqual(['find-file-up']);
    });

    it('judges a dated entry when the checkout has no readable version', () => {
      expect(unreachableRuntimeHelpers(['ai'], { ai: '12.10.0' }, { devDependencies: {} })).toEqual(['ai']);
    });
  });
});
