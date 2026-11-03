import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { filesystem } from 'gluegun';
import { tmpdir } from 'os';
import { join } from 'path';

import { TemplateHelper } from '../src/extensions/template';
import { removeTemplateAgentMemory } from '../src/lib/template-agent-memory';

describe('removeTemplateAgentMemory', () => {
  let root: string;
  let outside: string;

  const note = (dir: string): string => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'MEMORY.md');
    writeFileSync(file, '- [note](note.md) — about the TEMPLATE repo\n');
    return file;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-agent-memory-'));
    outside = mkdtempSync(join(tmpdir(), 'lt-agent-memory-outside-'));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });

  it('removes the root scope and keeps the rest of .claude', () => {
    note(join(root, '.claude', 'agent-memory', 'lt-dev-security-reviewer'));
    writeFileSync(join(root, '.claude', 'upstream.json'), '{}');

    expect(removeTemplateAgentMemory(root)).toEqual(['.claude/agent-memory']);
    expect(existsSync(join(root, '.claude', 'agent-memory'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'upstream.json'))).toBe(true);
  });

  it('removes a sub-project scope too (nuxt-base-starter ships one in nuxt-base-template/)', () => {
    note(join(root, '.claude', 'agent-memory', 'a'));
    note(join(root, 'nuxt-base-template', '.claude', 'agent-memory', 'b'));

    expect(removeTemplateAgentMemory(root)).toEqual([
      '.claude/agent-memory',
      'nuxt-base-template/.claude/agent-memory',
    ]);
    expect(existsSync(join(root, 'nuxt-base-template', '.claude'))).toBe(true);
    expect(existsSync(join(root, 'nuxt-base-template', '.claude', 'agent-memory'))).toBe(false);
  });

  it('does not descend into node_modules or .git', () => {
    const inDeps = note(join(root, 'node_modules', 'pkg', '.claude', 'agent-memory'));
    const inGit = note(join(root, '.git', '.claude', 'agent-memory'));

    expect(removeTemplateAgentMemory(root)).toEqual([]);
    expect(existsSync(inDeps)).toBe(true);
    expect(existsSync(inGit)).toBe(true);
  });

  it('never deletes through a symlink', () => {
    // A symlinked directory and a symlinked .claude both lead outside the project.
    const viaDir = note(join(outside, 'shared', '.claude', 'agent-memory'));
    symlinkSync(join(outside, 'shared'), join(root, 'shared'));
    const viaClaude = note(join(outside, 'claude', 'agent-memory'));
    symlinkSync(join(outside, 'claude'), join(root, '.claude'));

    expect(removeTemplateAgentMemory(root)).toEqual([]);
    expect(existsSync(viaDir)).toBe(true);
    expect(existsSync(viaClaude)).toBe(true);
  });

  it('removes a symlinked agent-memory as a link, never its target', () => {
    const target = note(join(outside, 'memory'));
    mkdirSync(join(root, '.claude'));
    symlinkSync(join(outside, 'memory'), join(root, '.claude', 'agent-memory'));

    expect(removeTemplateAgentMemory(root)).toEqual(['.claude/agent-memory']);
    expect(() => lstatSync(join(root, '.claude', 'agent-memory'))).toThrow();
    expect(existsSync(target)).toBe(true);
  });

  it('returns nothing for a missing root', () => {
    expect(removeTemplateAgentMemory(join(root, 'missing'))).toEqual([]);
  });

  it('never walks a linked root', () => {
    // A root that is itself a link leads wherever the link points, so nothing
    // below it belongs to the project being scaffolded.
    const target = note(join(outside, 'checkout', '.claude', 'agent-memory'));
    symlinkSync(join(outside, 'checkout'), join(root, 'api'));

    expect(removeTemplateAgentMemory(join(root, 'api'))).toEqual([]);
    expect(existsSync(target)).toBe(true);
  });
});

describe('TemplateHelper.copyLocal', () => {
  let source: string;
  let destParent: string;

  beforeEach(() => {
    source = mkdtempSync(join(tmpdir(), 'lt-template-source-'));
    destParent = mkdtempSync(join(tmpdir(), 'lt-template-dest-'));
  });

  afterEach(() => {
    rmSync(source, { force: true, recursive: true });
    rmSync(destParent, { force: true, recursive: true });
  });

  it('drops the template agent memory from the copy and leaves the source untouched', async () => {
    // A local starter checkout keeps its notes on disk even once git ignores them,
    // so `--api-copy` / `--frontend-copy` would carry them into the new project.
    mkdirSync(join(source, '.claude', 'agent-memory', 'lt-dev-test-reviewer'), { recursive: true });
    writeFileSync(join(source, '.claude', 'agent-memory', 'lt-dev-test-reviewer', 'MEMORY.md'), 'note\n');
    writeFileSync(join(source, 'package.json'), '{}');

    const toolbox = { filesystem, print: { error: vi.fn(), info: vi.fn() } };
    const helper = new TemplateHelper(toolbox as never);
    const dest = join(destParent, 'api');

    const result = await helper.copyLocal(source, dest, { showInfo: false });

    expect(result.success).toBe(true);
    expect(existsSync(join(dest, 'package.json'))).toBe(true);
    expect(existsSync(join(dest, '.claude', 'agent-memory'))).toBe(false);
    expect(existsSync(join(source, '.claude', 'agent-memory', 'lt-dev-test-reviewer', 'MEMORY.md'))).toBe(true);
  });

  it('drops a linked agent memory (lt-memory) from the copy without touching the linked notes', async () => {
    // The copy reproduces a symlink as a symlink, so without the cleanup the new
    // project would point straight at the template's private notes.
    const notes = mkdtempSync(join(tmpdir(), 'lt-template-notes-'));
    writeFileSync(join(notes, 'MEMORY.md'), 'private note\n');
    mkdirSync(join(source, '.claude'));
    symlinkSync(notes, join(source, '.claude', 'agent-memory'));

    const toolbox = { filesystem, print: { error: vi.fn(), info: vi.fn() } };
    const dest = join(destParent, 'api');
    await new TemplateHelper(toolbox as never).copyLocal(source, dest, { showInfo: false });

    expect(() => lstatSync(join(dest, '.claude', 'agent-memory'))).toThrow();
    expect(existsSync(join(notes, 'MEMORY.md'))).toBe(true);
    expect(lstatSync(join(source, '.claude', 'agent-memory')).isSymbolicLink()).toBe(true);
    rmSync(notes, { force: true, recursive: true });
  });

  it('copies a linked source as a real directory and leaves the checkout behind it untouched', async () => {
    // fs-jetpack copies a linked root as the link itself. The new project would
    // then BE the developer's checkout, and removing `.git` and the agent notes
    // from it would delete them in that checkout.
    mkdirSync(join(source, '.git'));
    writeFileSync(join(source, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(source, '.claude', 'agent-memory'), { recursive: true });
    writeFileSync(join(source, '.claude', 'agent-memory', 'MEMORY.md'), 'note\n');
    writeFileSync(join(source, 'package.json'), '{}');
    const linkedSource = join(destParent, 'linked-starter');
    symlinkSync(source, linkedSource);

    const toolbox = { filesystem, print: { error: vi.fn(), info: vi.fn() } };
    const dest = join(destParent, 'api');
    const result = await new TemplateHelper(toolbox as never).copyLocal(linkedSource, dest, { showInfo: false });

    expect(result.success).toBe(true);
    expect(lstatSync(dest).isDirectory()).toBe(true);
    expect(existsSync(join(dest, 'package.json'))).toBe(true);
    expect(existsSync(join(dest, '.git'))).toBe(false);
    expect(existsSync(join(dest, '.claude', 'agent-memory'))).toBe(false);
    expect(existsSync(join(source, '.git', 'HEAD'))).toBe(true);
    expect(existsSync(join(source, '.claude', 'agent-memory', 'MEMORY.md'))).toBe(true);
  });
});
