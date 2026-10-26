/**
 * Without `--framework-upstream-branch`, the vendor conversion used to clone nest-server's
 * default branch (`develop`: pushed, unpublished work) while npm mode installs the version the
 * starter pins. Both modes now start from the starter's pin.
 */
import { isMissingCloneRef, starterPinnedFrameworkVersion } from '../src/lib/vendor-upstream-ref';

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
