import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  applyAgentNotesIgnorePolicy,
  findAgentNotesIgnores,
  removeAgentNotesIgnores,
  resolveAgentNotesIgnore,
  stripAgentNotesIgnore,
} from '../src/lib/agent-notes-ignore';

const { parseParams } = require('gluegun/build/toolbox/parameter-tools');

// The three shapes the templates ship (2026-11-03), trimmed to the lines around the rule.
const LT_MONOREPO = [
  '# lt dev session state (ports, PIDs, env bridge, logs)',
  '.lt-dev/',
  '',
  "# Review agents' notes stay out of this repository: it is public, and the notes record findings",
  '# and internals that do not belong in it (decided 2026-11-01).',
  '# otherwise, so a private project decides for itself whether to share the notes (decided 2026-11-03).',
  '**/.claude/agent-memory',
  '',
].join('\n');

const NEST_SERVER_STARTER = [
  '# Ignore txt files in tests directory',
  'tests/**/*.txt',
  '',
  "# Review agents' notes stay on the developer's machine (decided 2026-11-01 for the public lenne.Tech base",
  '# repositories): they record findings and internals that do not belong in a public repository.',
  '# No trailing slash: the path may be a symlink, and a directory-only pattern does not match one.',
  '**/.claude/agent-memory',
  '',
].join('\n');

const NUXT_BASE_STARTER = [
  'node_modules',
  '',
  '# Claude Code agent working notes + local settings — repo-local tooling, not part of the release.',
  '**/.claude/agent-memory',
  '.claude/settings.local.json',
  '',
].join('\n');

describe('stripAgentNotesIgnore', () => {
  it('removes a paragraph that only explains the rule, with the blank line before it', () => {
    expect(stripAgentNotesIgnore(LT_MONOREPO)).toBe(
      ['# lt dev session state (ports, PIDs, env bridge, logs)', '.lt-dev/', ''].join('\n'),
    );
    expect(stripAgentNotesIgnore(NEST_SERVER_STARTER)).toBe(
      ['# Ignore txt files in tests directory', 'tests/**/*.txt', ''].join('\n'),
    );
  });

  it('keeps the comment and the other entries of a paragraph that ignores more than the notes', () => {
    expect(stripAgentNotesIgnore(NUXT_BASE_STARTER)).toBe(
      [
        'node_modules',
        '',
        '# Claude Code agent working notes + local settings — repo-local tooling, not part of the release.',
        '.claude/settings.local.json',
        '',
      ].join('\n'),
    );
  });

  it('covers nest-server plans and the trailing-slash spelling', () => {
    const content = ['dist', '', '# notes', '**/.claude/agent-memory/', '**/.claude/plans', ''].join('\n');
    expect(stripAgentNotesIgnore(content)).toBe('dist\n');
  });

  it('closes the gap when the paragraph sits between two others', () => {
    const content = ['a', '', '# notes', '**/.claude/agent-memory', '', 'b', ''].join('\n');
    expect(stripAgentNotesIgnore(content)).toBe(['a', '', 'b', ''].join('\n'));
  });

  it('keeps CRLF line endings and a missing final newline', () => {
    expect(stripAgentNotesIgnore('a\r\n\r\n# notes\r\n**/.claude/agent-memory\r\n')).toBe('a\r\n');
    expect(stripAgentNotesIgnore('a\n\n**/.claude/agent-memory')).toBe('a');
  });

  it("leaves a project's own spellings alone", () => {
    expect(stripAgentNotesIgnore('.claude/agent-memory/\n')).toBeNull();
    expect(stripAgentNotesIgnore('# **/.claude/agent-memory\nnode_modules\n')).toBeNull();
    expect(stripAgentNotesIgnore('node_modules\n')).toBeNull();
  });
});

describe('resolveAgentNotesIgnore', () => {
  // gluegun parses argv with yargs-parser and declares no booleans, so test what it really hands over.
  const flag = (...argv: string[]): unknown => parseParams(['fullstack', 'init', ...argv]).options.public;

  it('reads any spelling of --public as public', () => {
    for (const argv of [['--public'], ['--public=true'], ['--public=1'], ['--public', 'true']]) {
      expect(resolveAgentNotesIgnore(flag(...argv), true)).toBe('keep');
    }
  });

  it('reads an explicit negation as private', () => {
    for (const argv of [['--no-public'], ['--public=false'], ['--public=0']]) {
      expect(resolveAgentNotesIgnore(flag(...argv), false)).toBe('remove');
    }
  });

  it('asks interactively and removes non-interactively when the flag is absent', () => {
    expect(resolveAgentNotesIgnore(flag(), false)).toBe('ask');
    expect(resolveAgentNotesIgnore(flag(), true)).toBe('remove');
  });

  it('refuses a value the flag swallowed instead of guessing', () => {
    expect(resolveAgentNotesIgnore(flag('--public', 'my-app'), true)).toEqual({
      error: expect.stringContaining('"my-app"'),
    });
  });
});

describe('findAgentNotesIgnores / removeAgentNotesIgnores', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-notes-ignore-'));
    outside = mkdtempSync(join(tmpdir(), 'lt-notes-ignore-outside-'));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });

  it('finds and rewrites the root and the sub-project files, nothing else', () => {
    writeFileSync(join(root, '.gitignore'), LT_MONOREPO);
    mkdirSync(join(root, 'projects', 'api'), { recursive: true });
    writeFileSync(join(root, 'projects', 'api', '.gitignore'), NEST_SERVER_STARTER);
    mkdirSync(join(root, 'projects', 'app'), { recursive: true });
    writeFileSync(join(root, 'projects', 'app', '.gitignore'), 'node_modules\n');

    expect(findAgentNotesIgnores(root)).toEqual(['.gitignore', 'projects/api/.gitignore']);
    expect(removeAgentNotesIgnores(root)).toEqual(['.gitignore', 'projects/api/.gitignore']);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).not.toContain('agent-memory');
    expect(readFileSync(join(root, 'projects', 'app', '.gitignore'), 'utf8')).toBe('node_modules\n');
    expect(findAgentNotesIgnores(root)).toEqual([]);
  });

  it('never writes behind a symlink or into node_modules', () => {
    // A `--*-link` sub-project is the developer's own checkout.
    const linked = join(outside, 'checkout');
    mkdirSync(linked);
    writeFileSync(join(linked, '.gitignore'), NEST_SERVER_STARTER);
    mkdirSync(join(root, 'projects'));
    symlinkSync(linked, join(root, 'projects', 'api'));
    writeFileSync(join(outside, 'target.gitignore'), NEST_SERVER_STARTER);
    symlinkSync(join(outside, 'target.gitignore'), join(root, '.gitignore'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', '.gitignore'), NEST_SERVER_STARTER);

    expect(removeAgentNotesIgnores(root)).toEqual([]);
    expect(readFileSync(join(linked, '.gitignore'), 'utf8')).toBe(NEST_SERVER_STARTER);
    expect(readFileSync(join(outside, 'target.gitignore'), 'utf8')).toBe(NEST_SERVER_STARTER);
    expect(removeAgentNotesIgnores(join(root, 'projects', 'api'))).toEqual([]);
  });
});

describe('applyAgentNotesIgnorePolicy', () => {
  let root: string;

  const toolboxFor = (argv: string[]) => {
    const confirm = vi.fn(async () => false);
    const error = vi.fn();
    const info = vi.fn();
    const toolbox = { parameters: parseParams(['fullstack', 'init', ...argv]), print: { error, info }, prompt: { confirm } };
    return { confirm, error, info, toolbox: toolbox as never };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-notes-policy-'));
    writeFileSync(join(root, '.gitignore'), LT_MONOREPO);
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('keeps the rule for a public project', async () => {
    const { confirm, toolbox } = toolboxFor(['--public']);
    expect(await applyAgentNotesIgnorePolicy(toolbox, root, { noConfirm: true })).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(LT_MONOREPO);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('removes it without asking in a non-interactive run', async () => {
    const { confirm, toolbox } = toolboxFor([]);
    expect(await applyAgentNotesIgnorePolicy(toolbox, root, { noConfirm: true })).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).not.toContain('agent-memory');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('fails on a swallowed value and changes nothing', async () => {
    const { error, toolbox } = toolboxFor(['--public', 'my-app']);
    expect(await applyAgentNotesIgnorePolicy(toolbox, root, { noConfirm: true })).toBe(false);
    expect(error).toHaveBeenCalled();
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(LT_MONOREPO);
  });

  it('asks nothing when no file carries the rule', async () => {
    writeFileSync(join(root, '.gitignore'), 'node_modules\n');
    const { confirm, error, info, toolbox } = toolboxFor(['--public', 'my-app']);
    expect(await applyAgentNotesIgnorePolicy(toolbox, root, { noConfirm: false })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(existsSync(join(root, '.gitignore'))).toBe(true);
  });
});
