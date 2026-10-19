import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { findBsonDirectories } from '../src/commands/mongodb/s3-restore';

// `lt mongodb collection-export` and `lt mongodb s3-restore` used to put `--mongoUri`, `--database`
// and directory names from a downloaded backup into double-quoted shell strings, where `$(…)`
// runs. The expansion happens before mongosh is even looked up, so this test needs no MongoDB.
describe('lt mongodb commands pass values to the database tools without a shell', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-mongodb-shell-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test('collection-export does not run $(…) inside --mongoUri', () => {
    const marker = join(dir, 'PWNED');
    spawnSync(
      process.execPath,
      [join(__dirname, '..', 'bin', 'lt'), 'mongodb', 'collection-export', '--noConfirm', '--mongoUri', `mongodb://127.0.0.1:1$(touch ${marker})`],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 },
    );

    expect(existsSync(marker)).toBe(false);
  });

  test('findBsonDirectories lists every directory holding .bson files, sorted and unique', () => {
    mkdirSync(join(dir, 'dump', 'shop'), { recursive: true });
    mkdirSync(join(dir, 'dump', 'admin'), { recursive: true });
    mkdirSync(join(dir, 'dump', 'empty'), { recursive: true });
    writeFileSync(join(dir, 'dump', 'shop', 'orders.bson'), '');
    writeFileSync(join(dir, 'dump', 'shop', 'users.bson'), '');
    writeFileSync(join(dir, 'dump', 'admin', 'system.version.bson'), '');
    writeFileSync(join(dir, 'dump', 'empty', 'notes.json'), '');

    expect(findBsonDirectories(dir)).toEqual([join(dir, 'dump', 'admin'), join(dir, 'dump', 'shop')]);
  });

  test('findBsonDirectories takes a folder name with shell syntax literally', () => {
    const evil = join(dir, 'x;touch PWNED;#');
    mkdirSync(evil, { recursive: true });
    writeFileSync(join(evil, 'a.bson'), '');

    expect(findBsonDirectories(dir)).toEqual([evil]);
    expect(existsSync(join(dir, 'PWNED'))).toBe(false);
  });
});
