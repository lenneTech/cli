import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { execArgs } from '../src/lib/exec-args';
import {
  checkGitIdentity,
  findMissingTools,
  gitInstallHint,
  pnpmInstallHint,
  pnpmMajorIssue,
} from '../src/lib/toolchain-preflight';

/** PATH lookup backed by a fixed set of tool names. */
const onPath =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name) ? `/bin/${name}` : null;

describe('findMissingTools', () => {
  it('reports nothing when git and pnpm are on PATH', () => {
    expect(findMissingTools({ pnpm: true }, { findExecutable: onPath('git', 'pnpm') })).toEqual([]);
  });

  it('reports git and pnpm together, so a machine at zero sees both at once', () => {
    const issues = findMissingTools({ pnpm: true }, { findExecutable: onPath(), platform: 'win32' });
    expect(issues.map((i) => i.id)).toEqual(['git-missing', 'pnpm-missing']);
    expect(issues[0].fix).toEqual(['winget install --id Git.Git -e --source winget']);
    expect(issues[1].fix).toEqual(['npm install -g pnpm@11']);
    expect(issues[1].message).toContain('lt fullstack init');
  });

  it('does not ask for pnpm when the flow does not install (--next)', () => {
    expect(findMissingTools({ pnpm: false }, { findExecutable: onPath('git') })).toEqual([]);
  });
});

describe('install hints', () => {
  it('names a command per platform, never brew on Windows or Linux', () => {
    expect(gitInstallHint('win32')).toContain('winget');
    expect(gitInstallHint('darwin')).toBe('xcode-select --install');
    expect(gitInstallHint('linux')).not.toContain('brew');
    expect(gitInstallHint('win32')).not.toContain('brew');
  });

  it('installs pnpm 11 without admin rights (no corepack, which writes next to node.exe)', () => {
    expect(pnpmInstallHint()).toBe('npm install -g pnpm@11');
  });
});

describe('pnpmMajorIssue', () => {
  it('accepts the pinned major', () => {
    expect(pnpmMajorIssue('11.28.10\n', 'win32')).toBeNull();
  });

  it('explains another major (pnpm 12 downloads the pinned version as a native binary)', () => {
    expect(pnpmMajorIssue('12.15.0', 'win32')).toContain('Smart App Control');
    expect(pnpmMajorIssue('10.33.0', 'win32')).toContain('not pnpm 11');
  });

  it('stays silent when the version cannot be read', () => {
    expect(pnpmMajorIssue('', 'win32')).toBeNull();
    expect(pnpmMajorIssue('error', 'win32')).toBeNull();
  });

  it('says nothing on macOS and Linux, where a version switch is harmless', () => {
    expect(pnpmMajorIssue('12.15.0', 'darwin')).toBeNull();
    expect(pnpmMajorIssue('10.30.2', 'linux')).toBeNull();
  });
});

describe('checkGitIdentity', () => {
  it('passes when git can produce both idents', async () => {
    const git = jest.fn(async () => 'Jane <jane@example.com> 0 +0000');
    expect(await checkGitIdentity('/repo', { git })).toBeNull();
    expect(git.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      ['var', 'GIT_COMMITTER_IDENT'],
      ['var', 'GIT_AUTHOR_IDENT'],
    ]);
    expect(git.mock.calls.every((c) => (c as unknown[])[1] === '/repo')).toBe(true);
  });

  it("returns the fix and git's own reason when git cannot commit", async () => {
    const git = jest.fn(async () => {
      throw Object.assign(new Error('Command failed: git var GIT_COMMITTER_IDENT'), {
        stderr:
          '*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"\n\nfatal: no email was given and auto-detection is disabled\n',
      });
    });
    const issue = await checkGitIdentity('/repo', { git });
    expect(issue?.id).toBe('git-identity');
    expect(issue?.fix).toEqual([
      'git config --global user.name "Your Name"',
      'git config --global user.email "you@example.com"',
    ]);
    expect(issue?.message).toContain('git config --global user.email');
  });

  /**
   * Against the real git binary, with a throwaway HOME and no system config. `user.useConfigOnly`
   * switches git's hostname-based auto-detection off, so the result does not depend on how the
   * test machine is named (on macOS `user@host.local` would otherwise let git commit).
   */
  describe('with real git', () => {
    let root: string;
    let env: NodeJS.ProcessEnv;
    const realGit = (args: string[], cwd: string) => execArgs('git', args, { cwd, env });

    beforeEach(() => {
      // realpath: on macOS tmpdir() is /var/…, a symlink to /private/var/…, and git matches
      // `includeIf "gitdir:…"` against the resolved path (measured: exit 128 vs 0).
      root = realpathSync(mkdtempSync(join(tmpdir(), 'lt-identity-')));
      mkdirSync(join(root, 'home'));
      env = {
        GIT_CONFIG_NOSYSTEM: '1',
        HOME: join(root, 'home'),
        PATH: process.env.PATH,
        USERPROFILE: join(root, 'home'),
        XDG_CONFIG_HOME: join(root, 'home', '.config'),
      };
    });

    afterEach(() => rmSync(root, { force: true, recursive: true }));

    const writeGlobalConfig = (content: string) => writeFileSync(join(root, 'home', '.gitconfig'), content);
    const initRepo = (dir: string) => {
      mkdirSync(dir, { recursive: true });
      execFileSync('git', ['init', '-q', dir], { env });
      return dir;
    };

    it('reports a machine without identity', async () => {
      writeGlobalConfig('[user]\n\tuseConfigOnly = true\n');
      const repo = initRepo(join(root, 'fresh'));
      const issue = await checkGitIdentity(repo, { git: realGit });
      expect(issue?.id).toBe('git-identity');
    });

    it('accepts an identity from the global config', async () => {
      writeGlobalConfig('[user]\n\tuseConfigOnly = true\n\tname = Jane\n\temail = jane@example.com\n');
      const repo = initRepo(join(root, 'fresh'));
      expect(await checkGitIdentity(repo, { git: realGit })).toBeNull();
    });

    it('accepts an identity that only an includeIf for the new repository supplies', async () => {
      const workConfig = join(root, 'home', 'work.gitconfig');
      writeFileSync(workConfig, '[user]\n\tname = Jane\n\temail = jane@work.example\n');
      writeGlobalConfig(
        `[user]\n\tuseConfigOnly = true\n[includeIf "gitdir:${join(root, 'work').replace(/\\/g, '/')}/"]\n\tpath = ${workConfig.replace(/\\/g, '/')}\n`,
      );
      const repo = initRepo(join(root, 'work', 'project'));

      expect(await checkGitIdentity(repo, { git: realGit })).toBeNull();

      // Counter-check: the naive question ("is user.email set?") asked outside the new
      // repository says no for the same machine. That is the false alarm this check avoids.
      await expect(realGit(['config', '--get', 'user.email'], join(root, 'work'))).rejects.toThrow();
      expect(readFileSync(workConfig, 'utf8')).toContain('jane@work.example');
    });
  });
});

describe('lt fullstack init wiring', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'commands', 'fullstack', 'init.ts'), 'utf8');

  it('checks the tools before the first prompt', () => {
    const toolCheck = source.indexOf('findMissingTools(');
    expect(toolCheck).toBeGreaterThan(-1);
    expect(toolCheck).toBeLessThan(source.indexOf('helper.getInput('));
    expect(toolCheck).toBeLessThan(source.indexOf('await ask('));
  });

  it('checks the identity right after git init, before any project is set up', () => {
    const gitInit = source.indexOf("['init', '--initial-branch=dev']");
    const identity = source.indexOf('checkGitIdentity(projectDir)');
    expect(gitInit).toBeGreaterThan(-1);
    expect(identity).toBeGreaterThan(gitInit);
    expect(identity).toBeLessThan(source.indexOf('frontendHelper.setupNuxt('));
    expect(identity).toBeLessThan(source.indexOf('server.setupServerForFullstack('));
  });
});
