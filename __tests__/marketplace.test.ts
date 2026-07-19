import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  BUILTIN_MARKETPLACES,
  configuredToMarketplaceConfig,
  deriveGitHubRepo,
  getAllMarketplaces,
  PRIMARY_MARKETPLACE_NAME,
} from '../src/lib/marketplace';
import { upsertConfiguredMarketplace } from '../src/lib/marketplace-config';

describe('deriveGitHubRepo', () => {
  test('accepts a plain owner/repo', () => {
    expect(deriveGitHubRepo('lenneTech/claude-code')).toBe('lenneTech/claude-code');
  });

  test('parses an https GitHub URL (with and without .git)', () => {
    expect(deriveGitHubRepo('https://github.com/lenneTech/claude-code')).toBe('lenneTech/claude-code');
    expect(deriveGitHubRepo('https://github.com/lenneTech/claude-code.git')).toBe('lenneTech/claude-code');
  });

  test('parses an SSH GitHub URL', () => {
    expect(deriveGitHubRepo('git@github.com:lenneTech/claude-code.git')).toBe('lenneTech/claude-code');
  });

  test('returns undefined for non-GitHub sources', () => {
    expect(deriveGitHubRepo('git@gitlab.lenne.tech:intern/claude-code-internal.git')).toBeUndefined();
  });
});

describe('configuredToMarketplaceConfig', () => {
  test('defaults to the git provider with autoInstall enabled', () => {
    const cfg = configuredToMarketplaceConfig({
      name: 'lenne-tech-internal',
      source: 'git@gitlab.lenne.tech:intern/claude-code-internal.git',
    });
    expect(cfg.provider).toBe('git');
    expect(cfg.autoInstall).toBe(true);
    expect(cfg.apiBase).toBeUndefined();
    expect(cfg.source).toBe('git@gitlab.lenne.tech:intern/claude-code-internal.git');
  });

  test('derives GitHub API/raw bases for the github provider', () => {
    const cfg = configuredToMarketplaceConfig({
      name: 'extra',
      provider: 'github',
      source: 'acme/plugins',
    });
    expect(cfg.provider).toBe('github');
    expect(cfg.repo).toBe('acme/plugins');
    expect(cfg.apiBase).toBe('https://api.github.com/repos/acme/plugins/contents');
    expect(cfg.rawBase).toBe('https://raw.githubusercontent.com/acme/plugins/main');
  });

  test('passes private and autoInstall flags through', () => {
    const cfg = configuredToMarketplaceConfig({
      autoInstall: false,
      name: 'x',
      private: true,
      source: 's',
    });
    expect(cfg.private).toBe(true);
    expect(cfg.autoInstall).toBe(false);
  });
});

describe('getAllMarketplaces', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lt-mp-all-'));
    process.env.LT_MARKETPLACE_CONFIG = join(tmpDir, 'claude-marketplaces.json');
  });

  afterEach(() => {
    delete process.env.LT_MARKETPLACE_CONFIG;
    rmSync(tmpDir, { force: true, recursive: true });
  });

  test('returns only the built-in marketplaces when nothing is configured', () => {
    const all = getAllMarketplaces();
    expect(all.map((m) => m.name)).toEqual(BUILTIN_MARKETPLACES.map((m) => m.name));
  });

  test('appends configured marketplaces after the built-ins', () => {
    upsertConfiguredMarketplace({ name: 'lenne-tech-internal', source: 'git@gitlab.lenne.tech:intern/x.git' });
    const all = getAllMarketplaces();
    expect(all.map((m) => m.name)).toContain('lenne-tech-internal');
    expect(all).toHaveLength(BUILTIN_MARKETPLACES.length + 1);
  });

  test('does not let a configured entry override a built-in name', () => {
    upsertConfiguredMarketplace({ name: PRIMARY_MARKETPLACE_NAME, source: 'evil/override' });
    const all = getAllMarketplaces();
    const primary = all.filter((m) => m.name === PRIMARY_MARKETPLACE_NAME);
    expect(primary).toHaveLength(1);
    expect(primary[0].provider).toBe('github');
  });
});
