import { symlinkSync } from 'fs';

import { removeNestedLockfiles } from '../src/lib/remove-nested-lockfiles';

const { filesystem } = require('gluegun');

/**
 * Inside a pnpm workspace only the root pnpm-lock.yaml is read and refreshed.
 * The starters bring their standalone lockfile along, where it silently rots —
 * anything installing from the sub-project context then resolves a stale tree.
 */
describe('removeNestedLockfiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-lockfiles-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  const makeWorkspace = (): void => {
    filesystem.write(`${tempDir}/pnpm-workspace.yaml`, "packages:\n  - 'projects/*'\n");
    filesystem.write(`${tempDir}/pnpm-lock.yaml`, "lockfileVersion: '9.0'\n");
  };
  const seedSub = (sub: string): void => {
    filesystem.dir(`${tempDir}/${sub}`);
    filesystem.write(`${tempDir}/${sub}/pnpm-lock.yaml`, "lockfileVersion: '9.0'\n");
  };
  const exists = (p: string): boolean => Boolean(filesystem.exists(`${tempDir}/${p}`));

  it('removes nested pnpm lockfiles and keeps the root one', () => {
    makeWorkspace();
    seedSub('projects/api');
    seedSub('projects/app');

    const result = removeNestedLockfiles({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(result.removed.sort()).toEqual(['projects/api', 'projects/app']);
    expect(exists('projects/api/pnpm-lock.yaml')).toBe(false);
    expect(exists('projects/app/pnpm-lock.yaml')).toBe(false);
    expect(exists('pnpm-lock.yaml')).toBe(true);
  });

  it('does nothing outside a pnpm workspace — the nested lockfile may be the only one', () => {
    seedSub('projects/app');

    const result = removeNestedLockfiles({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(result.removed).toEqual([]);
    expect(exists('projects/app/pnpm-lock.yaml')).toBe(true);
  });

  it('never touches a symlinked sub-project (link mode points at the user checkout)', () => {
    makeWorkspace();
    const source = filesystem.path(tempDir, 'external-checkout');
    filesystem.dir(source);
    filesystem.write(`${source}/pnpm-lock.yaml`, "lockfileVersion: '9.0'\n");
    filesystem.dir(`${tempDir}/projects`);
    symlinkSync(source, filesystem.path(tempDir, 'projects', 'app'));

    const result = removeNestedLockfiles({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(result.removed).toEqual([]);
    expect(filesystem.exists(`${source}/pnpm-lock.yaml`)).toBeTruthy();
  });

  it('leaves yarn.lock and package-lock.json alone — lt dev reads them to pick the binary', () => {
    makeWorkspace();
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(`${tempDir}/projects/app/package-lock.json`, '{}\n');
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(`${tempDir}/projects/api/yarn.lock`, '# yarn\n');

    const result = removeNestedLockfiles({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(result.removed).toEqual([]);
    expect(exists('projects/app/package-lock.json')).toBe(true);
    expect(exists('projects/api/yarn.lock')).toBe(true);
  });

  it('skips missing sub-projects and is idempotent', () => {
    makeWorkspace();
    seedSub('projects/app');

    const first = removeNestedLockfiles({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });
    const second = removeNestedLockfiles({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(first.removed).toEqual(['projects/app']);
    expect(second.removed).toEqual([]);
  });
});
