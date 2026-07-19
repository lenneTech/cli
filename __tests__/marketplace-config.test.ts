import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  ConfiguredMarketplace,
  getMarketplaceConfigPath,
  readConfiguredMarketplaces,
  removeConfiguredMarketplace,
  upsertConfiguredMarketplace,
} from '../src/lib/marketplace-config';

describe('marketplace-config', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lt-mp-'));
    configPath = join(tmpDir, 'claude-marketplaces.json');
    process.env.LT_MARKETPLACE_CONFIG = configPath;
  });

  afterEach(() => {
    delete process.env.LT_MARKETPLACE_CONFIG;
    rmSync(tmpDir, { force: true, recursive: true });
  });

  test('getMarketplaceConfigPath honors the env override', () => {
    expect(getMarketplaceConfigPath()).toBe(configPath);
  });

  test('reads an empty array when the config file is missing', () => {
    expect(readConfiguredMarketplaces()).toEqual([]);
  });

  test('upsert creates the file and persists the entry', () => {
    const entry: ConfiguredMarketplace = {
      autoInstall: true,
      name: 'lenne-tech-internal',
      private: true,
      provider: 'git',
      source: 'git@gitlab.lenne.tech:intern/claude-code-internal.git',
    };
    upsertConfiguredMarketplace(entry);

    expect(existsSync(configPath)).toBe(true);
    const list = readConfiguredMarketplaces();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'lenne-tech-internal',
      private: true,
      provider: 'git',
      source: 'git@gitlab.lenne.tech:intern/claude-code-internal.git',
    });
  });

  test('upsert replaces an existing entry with the same name', () => {
    upsertConfiguredMarketplace({ name: 'x', source: 'source-a' });
    upsertConfiguredMarketplace({ name: 'x', private: true, source: 'source-b' });

    const list = readConfiguredMarketplaces();
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe('source-b');
    expect(list[0].private).toBe(true);
  });

  test('upsert trims name and source', () => {
    upsertConfiguredMarketplace({ name: '  spaced  ', source: '  git@host:g/x.git  ' });
    const list = readConfiguredMarketplaces();
    expect(list[0].name).toBe('spaced');
    expect(list[0].source).toBe('git@host:g/x.git');
  });

  test('supports any number of distinct marketplaces', () => {
    upsertConfiguredMarketplace({ name: 'a', source: 's-a' });
    upsertConfiguredMarketplace({ name: 'b', source: 's-b' });
    upsertConfiguredMarketplace({ name: 'c', source: 's-c' });
    expect(
      readConfiguredMarketplaces()
        .map((m) => m.name)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });

  test('remove deletes by name and reports the removal', () => {
    upsertConfiguredMarketplace({ name: 'a', source: 's-a' });
    upsertConfiguredMarketplace({ name: 'b', source: 's-b' });

    const { marketplaces, removed } = removeConfiguredMarketplace('a');
    expect(removed).toBe(true);
    expect(marketplaces.map((m) => m.name)).toEqual(['b']);
    expect(readConfiguredMarketplaces().map((m) => m.name)).toEqual(['b']);
  });

  test('remove is a no-op for an unknown name', () => {
    upsertConfiguredMarketplace({ name: 'a', source: 's-a' });
    const { removed } = removeConfiguredMarketplace('does-not-exist');
    expect(removed).toBe(false);
    expect(readConfiguredMarketplaces()).toHaveLength(1);
  });

  test('read drops invalid entries and de-duplicates by name (first wins)', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        marketplaces: [
          { name: 'valid', source: 's-1' },
          { name: 'no-source' },
          { source: 's-no-name' },
          { name: 'valid', source: 's-2-duplicate' },
        ],
        version: 1,
      }),
      'utf-8',
    );

    const list = readConfiguredMarketplaces();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'valid', source: 's-1' });
  });

  test('read returns [] on malformed JSON', () => {
    writeFileSync(configPath, '{ this is not json', 'utf-8');
    expect(readConfiguredMarketplaces()).toEqual([]);
  });
});
