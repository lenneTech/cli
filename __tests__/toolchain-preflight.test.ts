import { readFileSync } from 'fs';
import { join } from 'path';

import {
  findMissingTools,
  gitInstallHint,
  packageManagerProbes,
  PNPM_MAJOR,
  pnpmInstallHint,
  pnpmMajorIssue,
} from '../src/lib/toolchain-preflight';

/** PATH lookup backed by a fixed set of tool names. */
const onPath =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name) ? `/bin/${name}` : null;

describe('findMissingTools', () => {
  test('reports nothing when git and pnpm are on PATH', () => {
    expect(findMissingTools({ pnpm: true }, { findExecutable: onPath('git', 'pnpm') })).toEqual([]);
  });

  test('reports git and pnpm together, so a machine at zero sees both at once', () => {
    const issues = findMissingTools({ pnpm: true }, { findExecutable: onPath(), platform: 'win32' });
    expect(issues.map((i) => i.id)).toEqual(['git-missing', 'pnpm-missing']);
    expect(issues[0].fix).toEqual(['winget install --id Git.Git -e --source winget']);
    expect(issues[1].fix).toEqual(['npm install -g pnpm@11']);
    expect(issues[1].message).toContain('lt fullstack init');
  });

  test('does not ask for pnpm when the flow does not install (--next)', () => {
    expect(findMissingTools({ pnpm: false }, { findExecutable: onPath('git') })).toEqual([]);
  });
});

describe('install hints', () => {
  test('names a command per platform, never brew on Windows or Linux', () => {
    expect(gitInstallHint('win32')).toContain('winget');
    expect(gitInstallHint('darwin')).toBe('xcode-select --install');
    expect(gitInstallHint('linux')).not.toContain('brew');
    expect(gitInstallHint('win32')).not.toContain('brew');
  });

  test('installs pnpm 11 without admin rights (no corepack, which writes next to node.exe)', () => {
    expect(pnpmInstallHint()).toBe('npm install -g pnpm@11');
  });

  test('PNPM_MAJOR is the major lt-monorepo pins', () => {
    // lt-monorepo is not a dependency of this repo; the sibling checkout is read when present.
    const sibling = join(__dirname, '..', '..', 'lt-monorepo', 'package.json');
    let packageManager: string | undefined;
    try {
      packageManager = JSON.parse(readFileSync(sibling, 'utf8')).packageManager;
    } catch {
      packageManager = `pnpm@${PNPM_MAJOR}.0.0`;
    }
    expect(packageManager).toMatch(new RegExp(`^pnpm@${PNPM_MAJOR}\\.`));
  });
});

describe('pnpmMajorIssue', () => {
  test('accepts the pinned major', () => {
    expect(pnpmMajorIssue('11.28.10\n', 'win32')).toBeNull();
  });

  test('explains another major (pnpm 12 downloads the pinned version as a native binary)', () => {
    expect(pnpmMajorIssue('12.15.0', 'win32')).toContain('Smart App Control');
    expect(pnpmMajorIssue('10.33.0', 'win32')).toContain('not pnpm 11');
  });

  test('stays silent when the version cannot be read', () => {
    expect(pnpmMajorIssue('', 'win32')).toBeNull();
    expect(pnpmMajorIssue('error', 'win32')).toBeNull();
  });

  test('says nothing on macOS and Linux, where a version switch is harmless', () => {
    expect(pnpmMajorIssue('12.15.0', 'darwin')).toBeNull();
    expect(pnpmMajorIssue('10.30.2', 'linux')).toBeNull();
  });
});

describe('packageManagerProbes (lt doctor)', () => {
  test('asks pnpm outside a project that uses another manager', () => {
    // corepack's pnpm exits 1 inside a project whose packageManager names npm or yarn; doctor
    // reported that working pnpm as "failed to start".
    expect(packageManagerProbes('npm', '/work/app', '/tmp')).toEqual([
      { cwd: '/work/app', manager: 'npm' },
      { cwd: '/tmp', manager: 'pnpm' },
    ]);
    expect(packageManagerProbes('yarn', '/work/app', '/tmp')[1]).toEqual({ cwd: '/tmp', manager: 'pnpm' });
  });

  test('asks pnpm in place in a pnpm project, where a blocked version switch has to show', () => {
    expect(packageManagerProbes('pnpm', '/work/app', '/tmp')).toEqual([{ cwd: '/work/app', manager: 'pnpm' }]);
  });

  test('doctor runs every version check in the directory the probe names', () => {
    const doctor = readFileSync(join(__dirname, '..', 'src', 'commands', 'doctor.ts'), 'utf8');
    expect(doctor).toContain('packageManagerProbes(');
    expect(doctor).toMatch(/spawnArgs\(manager, \['--version'\], \{ cwd: probeCwd \}\)/);
  });
});

describe('lt fullstack init wiring', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'commands', 'fullstack', 'init.ts'), 'utf8');

  test('checks the tools before the first prompt and before delegating to add-api / add-app', () => {
    const toolCheck = source.indexOf('findMissingTools(');
    expect(toolCheck).toBeGreaterThan(-1);
    expect(toolCheck).toBeLessThan(source.indexOf('helper.getInput('));
    expect(toolCheck).toBeLessThan(source.indexOf('await ask('));
    expect(toolCheck).toBeLessThan(source.indexOf('detectWorkspaceLayout('));
  });
});
