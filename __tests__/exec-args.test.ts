import { existsSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { parseParams } from 'gluegun/build/toolbox/parameter-tools';
import { tmpdir } from 'os';
import { join } from 'path';

import { execArgs, hasCmdShimHazard, isSafeRef, safeRef, spawnArgs } from '../src/lib/exec-args';

describe('execArgs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-exec-args-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test('passes shell syntax through verbatim and runs nothing', async () => {
    const marker = join(dir, 'PWNED');
    const payload = `x;touch ${marker}|$(touch ${marker})\`touch ${marker}\`&& touch ${marker} "'`;

    const out = await execArgs(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', payload]);

    expect(out).toBe(payload);
    expect(existsSync(marker)).toBe(false);
  });

  test('runs in cwd and trims on request', async () => {
    const out = await execArgs(process.execPath, ['-e', 'console.log(process.cwd())'], { cwd: dir, trim: true });
    expect(realpathSync(out)).toBe(realpathSync(dir));
  });

  test('rejects like system.run, with stdout and stderr attached', async () => {
    const failing = execArgs(process.execPath, ['-e', 'process.stdout.write("out"); console.error("boom"); process.exit(3)']);
    await expect(failing).rejects.toMatchObject({ stderr: expect.stringContaining('boom'), stdout: 'out' });
    await expect(failing).rejects.toThrow(/Command failed/);
  });
});

describe('safeRef', () => {
  test.each(['main', 'feature/DEV-123_x.y', 'release/1.0', 'v11.24.1', 'feat;touch${IFS}x'])(
    'accepts %s (no shell parses it any more)',
    (ref) => {
      expect(isSafeRef(ref)).toBe(true);
      expect(safeRef(ref)).toBe(ref);
    },
  );

  test('accepts a digits-only name as gluegun parses it (a number), e.g. a ticket branch', () => {
    const branch = parseParams(['git', 'create', '2314', 'main'], {}).array[2];
    expect(typeof branch).toBe('number');
    expect(isSafeRef(branch)).toBe(true);
    expect(safeRef(branch)).toBe('2314');
  });

  test('strips the newline git output ends in', () => {
    expect(safeRef('main\n')).toBe('main');
  });

  test.each(['', '   ', '-x', '--orphan=evil', '--upload-pack=touch x', 'a b', 'a\tb', 'a\nb', 'a\u0001b'])(
    'refuses %j, which git would read as an option or which cannot be a ref',
    (ref) => {
      expect(isSafeRef(ref)).toBe(false);
      expect(() => safeRef(ref)).toThrow(/Refusing/);
    },
  );
});

describe('spawnArgs', () => {
  test('passes shell syntax through verbatim and runs nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-spawn-args-'));
    try {
      const marker = join(dir, 'PWNED');
      const payload = `x;touch ${marker}|$(touch ${marker})`;
      const out = await spawnArgs(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', payload], { cwd: dir });
      expect(out).toBe(payload);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects with stderr on a non-zero exit', async () => {
    await expect(spawnArgs(process.execPath, ['-e', 'console.error("boom"); process.exit(2)'])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('boom'),
    });
  });
});

describe('hasCmdShimHazard', () => {
  test.each(['a"b', '50%', 'a\nb', 'a\rb'])('refuses %j on Windows', (value) => {
    expect(hasCmdShimHazard(value, 'win32')).toBe(true);
    expect(hasCmdShimHazard(value, 'darwin')).toBe(false);
  });

  test('accepts ordinary names and author strings on Windows', () => {
    expect(hasCmdShimHazard('John Doe <john@example.com>', 'win32')).toBe(false);
    expect(hasCmdShimHazard('my-cli', 'win32')).toBe(false);
  });
});
