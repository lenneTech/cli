import { join } from 'path';

import { fileOpener, isPathInside, isSafePathSegment } from '../src/lib/safe-paths';

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
