/**
 * The non-interactive git environment, and the repo-wide guarantee that it is
 * the ONLY place `GIT_SSH_COMMAND` gets a value.
 *
 * Both halves matter. The behaviour tests pin what the helper promises; the
 * static guard keeps a future call site from quietly reintroducing either of the
 * two defects this helper was extracted to kill — an unconditional
 * `GIT_SSH_COMMAND=` that overrides a deliberately configured ssh, and a POSIX
 * `VAR=value cmd` prefix that cmd.exe reads as a command name.
 */
import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { join } from 'path';

import { nonInteractiveGitEnv } from '../src/lib/git-env';

describe('nonInteractiveGitEnv', () => {
  test('disables the credential prompt', () => {
    // A prompt in a detached or CI child is not a question anyone can answer.
    expect(nonInteractiveGitEnv({}).GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('supplies an ssh default only when the caller has none', () => {
    expect(nonInteractiveGitEnv({}).GIT_SSH_COMMAND).toBe('ssh -o ConnectTimeout=5 -o BatchMode=yes');
  });

  test('never overrides an ssh command the caller configured', () => {
    // The whole reason this is a default and not an assignment: overriding cost
    // ~61s per fetch on a machine whose ssh agent needs interactive approval.
    const mine = 'ssh -i ~/.ssh/work_key';
    expect(nonInteractiveGitEnv({ GIT_SSH_COMMAND: mine }).GIT_SSH_COMMAND).toBe(mine);
  });

  test('treats an empty ssh command as unset', () => {
    // An empty string would make git exec "" — worse than having no value.
    expect(nonInteractiveGitEnv({ GIT_SSH_COMMAND: '' }).GIT_SSH_COMMAND).toContain('BatchMode=yes');
  });

  test('carries the rest of the environment forward', () => {
    // The child still needs PATH, HOME, SSH_AUTH_SOCK and friends.
    expect(nonInteractiveGitEnv({ PATH: '/usr/bin', SSH_AUTH_SOCK: '/tmp/agent' })).toMatchObject({
      PATH: '/usr/bin',
      SSH_AUTH_SOCK: '/tmp/agent',
    });
  });

  test('defaults to the real process environment', () => {
    // Looked up case-insensitively on purpose. Windows spells it `Path`, and
    // `process.env` there is a case-insensitive proxy — spreading it into a plain
    // object keeps the VALUE but loses that lookup, so `result.PATH` is undefined
    // on Windows while `process.env.PATH` works. Harmless for the helper's actual
    // use (the object goes to `spawn` wholesale, and Windows resolves `Path`
    // fine), but it makes a naive `.PATH` assertion a platform trap.
    const env = nonInteractiveGitEnv();
    const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1];
    expect(path).toBe(process.env.PATH);
  });
});

describe('no source assigns GIT_SSH_COMMAND outside the helper', () => {
  const SRC = join(__dirname, '..', 'src');
  const sources = globSync('**/*.ts', { absolute: true, cwd: SRC, ignore: ['templates/**'], nodir: true });

  test('the scan actually sees the source tree', () => {
    // A guard that matches nothing is the failure it exists to catch.
    expect(sources.length).toBeGreaterThan(50);
  });

  test('git-env.ts is the single definition point', () => {
    // Anywhere else, an assignment is either an override of the caller's ssh
    // config or a `VAR=value cmd` shell prefix that cmd.exe cannot parse.
    // Comments and the contract test may mention the name; only assignments count.
    const assigns = /GIT_SSH_COMMAND["']?\s*[:=][^:=]/;
    const offenders: string[] = [];

    for (const file of sources) {
      if (file.endsWith(join('lib', 'git-env.ts'))) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith('*') || code.startsWith('//')) return;
          if (assigns.test(code)) offenders.push(`${file}:${i + 1}  ${code}`);
        });
    }

    expect(offenders).toEqual([]);
  });
});
