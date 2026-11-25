import { join, resolve } from 'path';

import { fileOpener, isPathInside, isSafePathSegment, resolveInside } from '../src/lib/safe-paths';

describe('isPathInside', () => {
  const base = join('/', 'work', 'project');

  test.each(['permissions.md', 'docs/permissions.html', './x.json', 'a/../b.md'])('accepts %s', (rel) => {
    expect(isPathInside(base, join(base, rel))).toBe(true);
  });

  test('accepts the base itself', () => {
    expect(isPathInside(base, base)).toBe(true);
  });

  test.each(['../x.md', '../../etc/passwd', 'a/../../x.md'])('refuses %s, which leaves the project', (rel) => {
    expect(isPathInside(base, join(base, rel))).toBe(false);
  });

  test('refuses a sibling whose name only starts like the base', () => {
    expect(isPathInside(base, join('/', 'work', 'project-other', 'x.md'))).toBe(false);
  });
});

// `lt server permissions --output` runs its value through this. With `join` instead of
// `resolve`, an absolute value outside the project ended up under it and was never refused.
describe('resolveInside', () => {
  // `resolve`, not `join`: on Windows `join('/', …)` has no drive letter, while the
  // function under test returns `resolve` output, which always carries one.
  const base = resolve('/', 'work', 'project');

  test.each([
    ['permissions.md', join(base, 'permissions.md')],
    ['docs/permissions.html', join(base, 'docs', 'permissions.html')],
    ['a/../b.md', join(base, 'b.md')],
  ])('takes the relative %s from the project', (target, expected) => {
    expect(resolveInside(base, target)).toBe(expected);
  });

  test('takes an absolute path inside the project as it is', () => {
    const target = join(base, 'reports', 'permissions.json');
    expect(resolveInside(base, target)).toBe(target);
  });

  test.each([join('/', 'tmp', 'x.md'), join('/', 'work', 'project-other', 'x.md')])(
    'refuses the absolute %s outside the project',
    (target) => {
      expect(resolveInside(base, target)).toBeNull();
    },
  );

  test.each(['../x.md', '../../etc/passwd', 'a/../../x.md'])('refuses %s, which leaves the project', (target) => {
    expect(resolveInside(base, target)).toBeNull();
  });
});

describe('isSafePathSegment', () => {
  test.each(['user', 'file-info', 'order_item', 'v2'])('accepts %s', (name) => {
    expect(isSafePathSegment(name)).toBe(true);
  });

  test.each(['', '.', '..', '../other', 'a/b', 'a\\b', 'x\0y'])('refuses %j', (name) => {
    expect(isSafePathSegment(name)).toBe(false);
  });
});

describe('fileOpener', () => {
  // A file name with shell syntax in it, as `--output 'x";touch PWNED;".html'` produced it.
  const evil = '/p/x";touch PWNED;".html';

  test.each([
    ['darwin', 'open'],
    ['linux', 'xdg-open'],
    ['win32', 'explorer.exe'],
  ] as const)('%s: one argument, no shell, file name unchanged', (platform, command) => {
    expect(fileOpener(platform, evil)).toEqual({ args: [evil], command });
  });
});
