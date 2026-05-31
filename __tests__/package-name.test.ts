import { isUnmodifiedTemplateName, renameUnmodifiedTemplatePackage, setPackageName } from '../src/lib/package-name';

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

describe('isUnmodifiedTemplateName', () => {
  it('matches known starter-template defaults', () => {
    expect(isUnmodifiedTemplateName('lt-monorepo')).toBe(true);
  });

  it('rejects custom names and falsy values', () => {
    expect(isUnmodifiedTemplateName('crm')).toBe(false);
    expect(isUnmodifiedTemplateName('my-project')).toBe(false);
    expect(isUnmodifiedTemplateName('')).toBe(false);
    expect(isUnmodifiedTemplateName(null)).toBe(false);
    expect(isUnmodifiedTemplateName(undefined)).toBe(false);
  });
});

// Auto-rename for projects that bypassed `lt fullstack init` and still
// carry the template's placeholder `name`. Covers the kit-style flow
// where the user `git clone`d lt-monorepo into a project folder and
// then runs `lt dev init`.
describe('renameUnmodifiedTemplatePackage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-rename-' + Date.now() + '-' + Math.random().toString(36).slice(2),
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

  it('rewrites lt-monorepo name to the directory basename', () => {
    const projectRoot = `${tempDir}/kit`;
    filesystem.dir(projectRoot);
    writeJson(`${projectRoot}/package.json`, { name: 'lt-monorepo', version: '1.0.0' });

    const result = renameUnmodifiedTemplatePackage({ filesystem, projectRoot });

    expect(result).toBe('kit');
    expect(readJson(`${projectRoot}/package.json`).name).toBe('kit');
  });

  it('leaves a customized name untouched', () => {
    const projectRoot = `${tempDir}/my-project`;
    filesystem.dir(projectRoot);
    writeJson(`${projectRoot}/package.json`, { name: 'something-custom', version: '1.0.0' });
    const before = filesystem.read(`${projectRoot}/package.json`);

    const result = renameUnmodifiedTemplatePackage({ filesystem, projectRoot });

    expect(result).toBeNull();
    expect(filesystem.read(`${projectRoot}/package.json`)).toBe(before);
  });

  it('returns null when no package.json is present', () => {
    const projectRoot = `${tempDir}/no-pkg`;
    filesystem.dir(projectRoot);

    expect(renameUnmodifiedTemplatePackage({ filesystem, projectRoot })).toBeNull();
  });

  it('does not rewrite when the directory basename is itself a template default', () => {
    // Pathological case: user cloned into a folder literally named `lt-monorepo`.
    // Rewriting to the same name would be a no-op anyway; the guard keeps the
    // function from claiming a rename happened when nothing was useful.
    const projectRoot = `${tempDir}/lt-monorepo`;
    filesystem.dir(projectRoot);
    writeJson(`${projectRoot}/package.json`, { name: 'lt-monorepo', version: '1.0.0' });

    expect(renameUnmodifiedTemplatePackage({ filesystem, projectRoot })).toBeNull();
    expect(readJson(`${projectRoot}/package.json`).name).toBe('lt-monorepo');
  });

  // Realistic shape mirrors what `git clone lenneTech/lt-monorepo kit` lands
  // on disk (root package, pnpm overrides, workspaces). The rename must
  // preserve the rest of the manifest verbatim.
  it('preserves the rest of a realistic lt-monorepo manifest', () => {
    const projectRoot = `${tempDir}/kit`;
    filesystem.dir(projectRoot);
    writeJson(`${projectRoot}/package.json`, {
      name: 'lt-monorepo',
      packageManager: 'pnpm@10.0.0',
      pnpm: { overrides: { handlebars: '4.7.9' } },
      private: true,
      scripts: { start: 'pnpm -r start' },
      version: '1.0.0',
      workspaces: ['projects/*'],
    });

    expect(renameUnmodifiedTemplatePackage({ filesystem, projectRoot })).toBe('kit');
    const pkg = readJson(`${projectRoot}/package.json`);
    expect(pkg.name).toBe('kit');
    expect(pkg.pnpm.overrides).toEqual({ handlebars: '4.7.9' });
    expect(pkg.workspaces).toEqual(['projects/*']);
    expect(pkg.packageManager).toBe('pnpm@10.0.0');
  });
});
