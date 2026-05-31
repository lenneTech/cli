import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { rotateLogFile } from '../src/lib/dev-process';

describe('rotateLogFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-dev-process-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('returns rotated:false when there is no prior log', () => {
    const result = rotateLogFile(join(dir, 'app.log'));
    expect(result.rotated).toBe(false);
    expect(result.archivePath).toBeUndefined();
  });

  it('moves an existing log to <name>.1 and reports its prior size', () => {
    const log = join(dir, 'app.log');
    writeFileSync(log, 'hello\n');

    const result = rotateLogFile(log);

    expect(result.rotated).toBe(true);
    expect(result.archivePath).toBe(`${log}.1`);
    expect(result.previousSize).toBe(6);
    expect(existsSync(log)).toBe(false);
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('hello\n');
  });

  it('overwrites a prior generation so disk usage stays bounded', () => {
    const log = join(dir, 'app.log');
    writeFileSync(`${log}.1`, 'oldest');
    writeFileSync(log, 'newer');

    const result = rotateLogFile(log);

    expect(result.rotated).toBe(true);
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('newer');
    expect(existsSync(log)).toBe(false);
  });
});
