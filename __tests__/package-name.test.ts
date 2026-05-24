import { setPackageName } from '../src/lib/package-name';

const { filesystem } = require('gluegun');

describe('setPackageName', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-pkgname-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  const writeJson = (path: string, data: unknown): void => {
    filesystem.write(path, JSON.stringify(data, null, 2) + '\n');
  };

  const readJson = (path: string): any => JSON.parse(filesystem.read(path) || '{}');

  it('renames the `name` field and keeps the file valid JSON', () => {
    const pkgPath = `${tempDir}/package.json`;
    writeJson(pkgPath, { name: 'lt-monorepo', private: true, version: '1.0.0' });

    const changed = setPackageName({ filesystem, name: 'my-project', packageJsonPath: pkgPath });

    expect(changed).toBe(true);
    const pkg = readJson(pkgPath);
    expect(pkg.name).toBe('my-project');
    // other fields survive
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.private).toBe(true);
  });

  it('is a no-op when the name is already correct', () => {
    const pkgPath = `${tempDir}/package.json`;
    writeJson(pkgPath, { name: 'my-project', version: '1.0.0' });
    const before = filesystem.read(pkgPath);

    const changed = setPackageName({ filesystem, name: 'my-project', packageJsonPath: pkgPath });

    expect(changed).toBe(false);
    // file content byte-for-byte unchanged
    expect(filesystem.read(pkgPath)).toBe(before);
  });

  it('adds a `name` field when the package.json has none', () => {
    const pkgPath = `${tempDir}/package.json`;
    writeJson(pkgPath, { version: '1.0.0' });

    const changed = setPackageName({ filesystem, name: 'my-project', packageJsonPath: pkgPath });

    expect(changed).toBe(true);
    expect(readJson(pkgPath).name).toBe('my-project');
  });

  it('returns false for a missing file without throwing', () => {
    expect(() =>
      setPackageName({ filesystem, name: 'x', packageJsonPath: `${tempDir}/does-not-exist.json` }),
    ).not.toThrow();
    expect(setPackageName({ filesystem, name: 'x', packageJsonPath: `${tempDir}/does-not-exist.json` })).toBe(false);
  });

  // Regression guard for the original bug: the inline implementation ran a
  // String `.replace()` through `patching.update`, but gluegun hands the
  // callback a *parsed object* for `.json` files, so it threw
  // `content.replace is not a function` at runtime. A realistic lt-monorepo
  // root package.json must rename cleanly and stay parseable.
  it('renames a realistic lt-monorepo root package.json (regression)', () => {
    const pkgPath = `${tempDir}/package.json`;
    writeJson(pkgPath, {
      name: 'lt-monorepo',
      packageManager: 'pnpm@10.0.0',
      pnpm: { overrides: { handlebars: '4.7.9' } },
      private: true,
      scripts: { start: 'pnpm -r start' },
      version: '1.0.0',
      workspaces: ['projects/*'],
    });

    const changed = setPackageName({ filesystem, name: 'crm', packageJsonPath: pkgPath });

    expect(changed).toBe(true);
    const pkg = readJson(pkgPath);
    expect(pkg.name).toBe('crm');
    // nested + sibling structures untouched
    expect(pkg.pnpm.overrides).toEqual({ handlebars: '4.7.9' });
    expect(pkg.workspaces).toEqual(['projects/*']);
    expect(pkg.packageManager).toBe('pnpm@10.0.0');
  });
});
