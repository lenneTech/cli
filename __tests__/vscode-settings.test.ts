import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { minimatch } from 'minimatch';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildMergedValue,
  detectVariants,
  diffProfile,
  formatChange,
  isEnablingFlagSet,
  isPreventingFlagSet,
  MEMORY_PROFILE,
  selectVariants,
  settingsPathFor,
  tuneSettingsFile,
  VsCodeVariant,
} from '../src/lib/vscode-settings';

const plain = { dim: (s: string) => s, green: (s: string) => s, red: (s: string) => s, yellow: (s: string) => s };

// gluegun declares no booleans to yargs-parser, so a flag arrives as boolean,
// string or number depending on how it was typed. CLAUDE.md records that the
// `=== true || === 'true'` idiom is safe only for flags that ENABLE something.
describe('flag semantics', () => {
  describe('isEnablingFlagSet — a parse quirk must not switch it on', () => {
    it.each([
      [true, true],
      ['true', true],
      [1, false],
      ['yes', false],
      [false, false],
      [undefined, false],
    ])('%p -> %p', (input, expected) => {
      expect(isEnablingFlagSet(input)).toBe(expected);
    });
  });

  // --dry-run PREVENTS the write. `--dry-run=1` reading as "not set" would let
  // the write through — the exact failure this repo already paid for with
  // --keep-db, which dropped a database the user asked to keep.
  describe('isPreventingFlagSet — presence is intent', () => {
    it.each([
      [{ 'dry-run': true }, true],
      [{ 'dry-run': 'true' }, true],
      [{ 'dry-run': 1 }, true],
      [{ 'dry-run': 'yes' }, true],
      [{ 'dry-run': '' }, true],
      [{ 'dry-run': false }, false],
      [{ 'dry-run': 'false' }, false],
      [{}, false],
    ])('%p -> %p', (options, expected) => {
      expect(isPreventingFlagSet(options as Record<string, unknown>, 'dry-run', 'dryRun')).toBe(expected);
    });

    it('accepts either spelling yargs-parser produces', () => {
      expect(isPreventingFlagSet({ dryRun: true }, 'dry-run', 'dryRun')).toBe(true);
    });
  });
});

describe('selectVariants', () => {
  const all: VsCodeVariant[] = [
    { id: 'code', installed: true, label: 'VS Code', settingsPath: '/a' },
    { id: 'cursor', installed: false, label: 'Cursor', settingsPath: '/b' },
  ];

  it('returns every installed variant when no filter is given', () => {
    expect(selectVariants(all, undefined).targets.map((v) => v.id)).toEqual(['code']);
  });

  it('narrows to a known variant', () => {
    expect(selectVariants(all, 'code').targets.map((v) => v.id)).toEqual(['code']);
  });

  it('returns no targets for a known but uninstalled variant, without flagging it unknown', () => {
    const result = selectVariants(all, 'cursor');
    expect(result.targets).toEqual([]);
    expect(result.unknownFilter).toBeUndefined();
  });

  // A bare `--variant` parses to boolean true. Reporting that as "no
  // installation found" claimed the editor was missing while it was installed.
  it('reports a bare --variant as an unknown filter, not as a missing editor', () => {
    expect(selectVariants(all, true).unknownFilter).toBe('true');
    expect(selectVariants(all, 'nope').unknownFilter).toBe('nope');
  });
});

describe('formatChange', () => {
  it('renders an added key with its new value', () => {
    expect(formatChange({ action: 'added', after: 2048, before: undefined, key: 'k' }, plain)).toBe('+ k: — → 2048');
  });

  it('renders a removed key', () => {
    expect(formatChange({ action: 'removed', after: undefined, before: 1, key: 'k' }, plain)).toBe('- k: 1 → —');
  });

  it('renders an unchanged key without an arrow', () => {
    expect(formatChange({ action: 'unchanged', after: 1, before: 1, key: 'k' }, plain)).toBe('= k 1');
  });

  it('truncates a long value so one key stays one line', () => {
    const long = { action: 'added' as const, after: { ['x'.repeat(200)]: true }, before: undefined, key: 'k' };
    expect(formatChange(long, plain).length).toBeLessThan(80);
  });
});

describe('settingsPathFor', () => {
  it('uses the Application Support layout on macOS', () => {
    expect(settingsPathFor('Code', 'darwin', '/Users/x')).toBe(
      '/Users/x/Library/Application Support/Code/User/settings.json',
    );
  });

  it('uses ~/.config on linux', () => {
    expect(settingsPathFor('Code', 'linux', '/home/x')).toBe('/home/x/.config/Code/User/settings.json');
  });

  // Assertable off-Windows because the joiner is picked per platform rather than
  // taken from the ambient `path` — otherwise this branch could only ever be
  // exercised on a Windows CI runner, i.e. never.
  it('uses the APPDATA layout with backslashes on win32', () => {
    const appData = process.env.APPDATA;
    delete process.env.APPDATA;
    try {
      expect(settingsPathFor('Code', 'win32', 'C:\\Users\\x')).toBe(
        'C:\\Users\\x\\AppData\\Roaming\\Code\\User\\settings.json',
      );
    } finally {
      if (appData !== undefined) process.env.APPDATA = appData;
    }
  });

  it('honours an explicit APPDATA on win32', () => {
    const appData = process.env.APPDATA;
    process.env.APPDATA = 'D:\\Roaming';
    try {
      expect(settingsPathFor('Code', 'win32', 'C:\\Users\\x')).toBe('D:\\Roaming\\Code\\User\\settings.json');
    } finally {
      if (appData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = appData;
    }
  });
});

describe('detectVariants', () => {
  it('reports every known editor variant', () => {
    const ids = detectVariants('darwin', '/nonexistent').map((v) => v.id);
    expect(ids).toEqual(['code', 'insiders', 'cursor', 'vscodium']);
  });

  it('flags variants without a settings file as not installed', () => {
    expect(detectVariants('darwin', '/nonexistent').every((v) => !v.installed)).toBe(true);
  });
});

// A glob segment matches whole path segments, so `**/.nuxt/**` does NOT cover
// `.nuxt-test`. The CLI itself creates `.nuxt-test` / `.output-test` (lt dev test)
// and the check chain creates `.nuxt-check` — leaving a 37-294 MB `.output-test`
// watched and indexed would undo the saving this profile exists to make.
describe('MEMORY_PROFILE exclude globs', () => {
  const globs = (key: string): string[] => Object.keys(MEMORY_PROFILE[key].value as Record<string, unknown>);
  const covered = (key: string, path: string): boolean => globs(key).some((g) => minimatch(path, g));

  const paths = [
    'projects/app/.nuxt/f.mjs',
    'projects/app/.nuxt-test/f.mjs',
    'projects/app/.nuxt-check/f.mjs',
    'projects/app/.output/server/index.mjs',
    'projects/app/.output-test/server/index.mjs',
    'projects/api/node_modules/x/index.js',
    'projects/api/dist/main.js',
  ];

  it.each(paths)('files.watcherExclude covers %s', (path) => {
    expect(covered('files.watcherExclude', path)).toBe(true);
  });

  it.each(paths)('search.exclude covers %s', (path) => {
    expect(covered('search.exclude', path)).toBe(true);
  });

  it('does not over-match a checked-in .nuxtrc', () => {
    // `.nuxtrc` is a tracked file, not a build dir. `**/.nuxt*/**` needs a path
    // SEGMENT, so a file called `.nuxtrc` is safe — but pin it, because widening
    // the glob further (`**/.nuxt*`) would silently start excluding it.
    expect(covered('search.exclude', 'projects/app/.nuxtrc')).toBe(false);
  });
});

describe('buildMergedValue', () => {
  it('replaces plain values outright', () => {
    expect(buildMergedValue(3072, 2048)).toBe(2048);
  });

  it('keeps hand-added entries when merging object values', () => {
    const merged = buildMergedValue({ '**/custom/**': true }, { '**/node_modules/**': true });
    expect(merged).toEqual({ '**/custom/**': true, '**/node_modules/**': true });
  });

  it('lets the existing value win on conflicting keys', () => {
    const merged = buildMergedValue({ '**/dist/**': false }, { '**/dist/**': true });
    expect((merged as Record<string, unknown>)['**/dist/**']).toBe(false);
  });

  it('replaces a non-object before under an object-valued key', () => {
    // An array here is already being ignored by VS Code (these settings are
    // objects), so replacing it is correct — but it is the one case the
    // "never drops a hand-added entry" promise does not cover, so pin it.
    expect(buildMergedValue(['**/keep/**'], { '**/node_modules/**': true })).toEqual({ '**/node_modules/**': true });
  });
});

describe('diffProfile', () => {
  it('marks absent keys as added', () => {
    const changes = diffProfile({});
    expect(changes.every((c) => c.action === 'added')).toBe(true);
    expect(changes).toHaveLength(Object.keys(MEMORY_PROFILE).length);
  });

  it('marks matching keys as unchanged so a re-run is a no-op', () => {
    const current: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(MEMORY_PROFILE)) current[key] = entry.value;
    expect(diffProfile(current).every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('marks present keys as removed in revert mode', () => {
    const changes = diffProfile({ 'typescript.tsserver.maxTsServerMemory': 2048 }, true);
    const target = changes.find((c) => c.key === 'typescript.tsserver.maxTsServerMemory');
    expect(target?.action).toBe('removed');
  });

  it('reverting an object key subtracts only our own entries', () => {
    const before = { '**/my-tree/**': true, '**/node_modules/**': true };
    const changes = diffProfile({ 'search.exclude': before }, true);
    const target = changes.find((c) => c.key === 'search.exclude');
    expect(target?.after).toEqual({ '**/my-tree/**': true });
  });

  it('drops an object key entirely when nothing of the user`s remains', () => {
    const changes = diffProfile({ 'search.exclude': { '**/node_modules/**': true } }, true);
    expect(changes.find((c) => c.key === 'search.exclude')?.after).toBeUndefined();
  });

  it('reports unchanged when a revert would remove nothing', () => {
    const changes = diffProfile({ 'search.exclude': { '**/only-mine/**': true } }, true);
    expect(changes.find((c) => c.key === 'search.exclude')?.action).toBe('unchanged');
  });
});

describe('tuneSettingsFile', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-vscode-settings-'));
    file = join(dir, 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('reports a missing file instead of creating one', () => {
    const result = tuneSettingsFile(join(dir, 'absent.json'));
    expect(result.written).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('preserves comments and existing keys — the reason jsonc-parser is used', () => {
    writeFileSync(file, '{\n  // keep me\n  "editor.fontSize": 13\n}\n', 'utf8');
    tuneSettingsFile(file);
    const after = readFileSync(file, 'utf8');
    expect(after).toContain('// keep me');
    expect(after).toContain('"editor.fontSize": 13');
    expect(after).toContain('"typescript.tsserver.maxTsServerMemory": 2048');
  });

  it('writes a .bak copy before the first write', () => {
    writeFileSync(file, '{}\n', 'utf8');
    const result = tuneSettingsFile(file);
    expect(result.backupPath).toBe(`${file}.bak`);
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('{}\n');
  });

  it('is idempotent — a second run writes nothing', () => {
    writeFileSync(file, '{}\n', 'utf8');
    tuneSettingsFile(file);
    const second = tuneSettingsFile(file);
    expect(second.written).toBe(false);
    expect(second.changes.every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('refuses to write into an unparseable file', () => {
    writeFileSync(file, '{ this is not json', 'utf8');
    const result = tuneSettingsFile(file);
    expect(result.written).toBe(false);
    expect(result.error).toMatch(/cannot parse/);
    expect(readFileSync(file, 'utf8')).toBe('{ this is not json');
  });

  it('does not touch the file in dry-run mode', () => {
    writeFileSync(file, '{}\n', 'utf8');
    const result = tuneSettingsFile(file, { dryRun: true });
    expect(result.written).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('{}\n');
  });

  it('removes exactly the profile keys on revert and keeps the rest', () => {
    writeFileSync(file, '{}\n', 'utf8');
    tuneSettingsFile(file);
    writeFileSync(file, readFileSync(file, 'utf8').replace('{', '{\n  "editor.fontSize": 13,'), 'utf8');
    tuneSettingsFile(file, { remove: true });
    const after = readFileSync(file, 'utf8');
    expect(after).toContain('"editor.fontSize": 13');
    for (const key of Object.keys(MEMORY_PROFILE)) expect(after).not.toContain(`"${key}"`);
  });

  // The undo must not destroy data the tool never added. Deleting the whole key
  // took the user's hand-maintained exclusions with it.
  it('revert keeps hand-maintained exclude entries the profile never added', () => {
    writeFileSync(file, '{\n  "search.exclude": { "**/my-huge-tree/**": true }\n}\n', 'utf8');
    tuneSettingsFile(file);
    expect(readFileSync(file, 'utf8')).toContain('my-huge-tree');

    tuneSettingsFile(file, { remove: true });
    const after = readFileSync(file, 'utf8');
    expect(after).toContain('my-huge-tree');
    expect(after).not.toContain('node_modules');
  });

  // The .bak is the only record of the pre-tuning state. A revert that backs up
  // the *tuned* file destroys exactly what someone reaching for it wants back.
  it('keeps the first .bak instead of clobbering it on revert', () => {
    const original = '{\n  "search.exclude": { "**/mine/**": true }\n}\n';
    writeFileSync(file, original, 'utf8');
    tuneSettingsFile(file);
    tuneSettingsFile(file, { remove: true });
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(original);
  });

  // The command renders `result.error` per installation; throwing instead would
  // abort the whole run with a raw Node stack on the first unwritable file.
  it('returns an error instead of throwing when the file cannot be written', () => {
    writeFileSync(file, '{}\n', 'utf8');
    // The FILE is made unwritable, not its directory. Directory permission bits
    // are a POSIX concept: Windows ignores them when a file inside is opened for
    // writing, so a read-only directory lets the write succeed and the error
    // path under test is never reached. Clearing the write bit on a FILE maps to
    // the Windows read-only attribute, which every platform enforces.
    chmodSync(file, 0o444);
    try {
      const result = tuneSettingsFile(file);
      expect(result.written).toBe(false);
      expect(result.error).toMatch(/cannot write/);
    } finally {
      // Restore before afterEach removes the tree — a read-only file needs an
      // extra unlink dance on Windows.
      chmodSync(file, 0o644);
    }
  });

  it('refuses to write through a symlink', () => {
    const real = join(dir, 'real.json');
    writeFileSync(real, '{}\n', 'utf8');
    symlinkSync(real, file);

    const result = tuneSettingsFile(file);
    expect(result.written).toBe(false);
    expect(result.error).toMatch(/symlink/);
    expect(readFileSync(real, 'utf8')).toBe('{}\n');
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });
});
