/**
 * Without `--framework-upstream-branch`, the vendor conversion used to clone nest-server's
 * default branch (`develop`: pushed, unpublished work) while npm mode installs the version the
 * starter pins. Both modes now start from the starter's pin.
 */
import {
  isMissingCloneRef,
  pinnedNuxtExtensionsVersion,
  starterPinnedFrameworkVersion,
} from '../src/lib/vendor-upstream-ref';

describe('starterPinnedFrameworkVersion', () => {
  it('returns the exact version the starter pins — the tag to vendor (no "v" prefix)', () => {
    expect(starterPinnedFrameworkVersion({ dependencies: { '@lenne.tech/nest-server': '11.43.3' } })).toBe('11.43.3');
  });

  it('also reads a devDependency pin', () => {
    expect(starterPinnedFrameworkVersion({ devDependencies: { '@lenne.tech/nest-server': '12.0.0' } })).toBe('12.0.0');
  });

  it('ignores a range, a tag name or a link — none of them names one release', () => {
    for (const pin of ['^11.43.0', '~12.0.0', 'latest', 'file:../nest-server', 'link:../nest-server']) {
      expect(starterPinnedFrameworkVersion({ dependencies: { '@lenne.tech/nest-server': pin } })).toBeUndefined();
    }
  });

  it('returns undefined for a manifest without the framework, or no manifest at all', () => {
    expect(starterPinnedFrameworkVersion({ dependencies: { express: '5.3.0' } })).toBeUndefined();
    expect(starterPinnedFrameworkVersion(null)).toBeUndefined();
    expect(starterPinnedFrameworkVersion('not a manifest')).toBeUndefined();
  });
});

describe('pinnedNuxtExtensionsVersion', () => {
  it('returns the version the app pins — the tag to vendor (no "v" prefix)', () => {
    expect(pinnedNuxtExtensionsVersion({ dependencies: { '@lenne.tech/nuxt-extensions': '4.0.0' } })).toBe('4.0.0');
    expect(pinnedNuxtExtensionsVersion({ devDependencies: { '@lenne.tech/nuxt-extensions': '1.28.0' } })).toBe(
      '1.28.0',
    );
  });

  it('reads a caret or tilde range as its lowest release, like the ng-base pin', () => {
    expect(pinnedNuxtExtensionsVersion({ dependencies: { '@lenne.tech/nuxt-extensions': '^4.0.0' } })).toBe('4.0.0');
    expect(pinnedNuxtExtensionsVersion({ dependencies: { '@lenne.tech/nuxt-extensions': '~4.1.2' } })).toBe('4.1.2');
  });

  it('returns undefined for a spec that names no release, or no manifest', () => {
    for (const spec of ['latest', 'workspace:*', 'file:../nuxt-extensions', '>=4.0.0 <5', '4.x']) {
      expect(pinnedNuxtExtensionsVersion({ dependencies: { '@lenne.tech/nuxt-extensions': spec } })).toBeUndefined();
    }
    expect(pinnedNuxtExtensionsVersion({ dependencies: { nuxt: '4.2.0' } })).toBeUndefined();
    expect(pinnedNuxtExtensionsVersion(null)).toBeUndefined();
  });
});

describe('isMissingCloneRef', () => {
  it("recognises git's message for an unknown branch or tag", () => {
    expect(
      isMissingCloneRef(
        'Cloning into x...\nwarning: Could not find remote branch 12.0.0 to clone.\nfatal: Remote branch 12.0.0 not found in upstream origin',
      ),
    ).toBe(true);
  });

  it('does not mistake a network or auth failure for a missing ref', () => {
    expect(isMissingCloneRef("fatal: unable to access 'https://github.com/x/': Could not resolve host: github.com")).toBe(
      false,
    );
    expect(isMissingCloneRef('fatal: Authentication failed')).toBe(false);
  });
});
