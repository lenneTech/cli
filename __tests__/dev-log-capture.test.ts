import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { spawnDetached } from '../src/lib/dev-process';

describe('spawnDetached — the log must actually receive the output', () => {
  // The silent failure this guards: on Windows `.lt-dev/*.log` was created and
  // even rotated ("Rotated previous api log (0B)") but never written, because the
  // output of everything below `cmd.exe` went to an extra console window. A log
  // that exists but stays empty is worse than none: it looks trustworthy. On
  // Windows the command goes through a `.cmd` shim exactly like `pnpm.cmd`; on
  // POSIX through the sh wrapper. Both a child and a grandchild must reach the file.
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-dev-log-'));
  });
  afterEach(() => {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      /* a writer on Windows may still hold the file for a moment */
    }
  });

  it('captures stdout and stderr of the child AND of a grandchild', async () => {
    const script = join(dir, 'child.js');
    writeFileSync(
      script,
      [
        "const tag = process.argv[2] || 'child';",
        "if (tag === 'child') require('child_process').spawn(process.execPath, [__filename, 'grandchild'], { stdio: 'inherit' });",
        "console.log(tag + '-out'); console.error(tag + '-err');",
        'setTimeout(() => {}, 300);',
      ].join('\n'),
    );
    let cmd = process.execPath;
    let args = [script];
    const env = { ...process.env };
    if (process.platform === 'win32') {
      writeFileSync(join(dir, 'fakepnpm.cmd'), '@node "%~dp0child.js" %*\r\n');
      cmd = 'fakepnpm';
      args = [];
      // The key is `Path` on Windows, and a copied env is a plain, case-SENSITIVE
      // object: `env.PATH` would read undefined and hide node from the shim.
      const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[pathKey] = `${dir};${env[pathKey]}`;
    }
    const logFile = join(dir, 'app.log');
    const result = spawnDetached(cmd, args, { cwd: dir, env, logFile });
    if (!result) throw new Error('spawnDetached returned undefined');

    const want = ['child-out', 'child-err', 'grandchild-out', 'grandchild-err'];
    const deadline = Date.now() + 15_000;
    let content = '';
    while (Date.now() < deadline) {
      content = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
      if (want.every((w) => content.includes(w))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    for (const w of want) expect(content).toContain(w);
  });
});
