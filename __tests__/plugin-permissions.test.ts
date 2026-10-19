import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { getClaudeConfigDir } from '../src/lib/claude-cli';
import {
  hasPluginRootVariable,
  planPermissionSync,
  pluginCacheRootPattern,
  readLedgerEntries,
  recordLedgerEntry,
  resolvePluginRootVariable,
} from '../src/lib/plugin-permissions';
import { readPluginContents, setupPermissions } from '../src/lib/plugin-utils';

const LT_DEV = { marketplaceName: 'lenne-tech', pluginName: 'lt-dev' };
const LT_SHOWROOM = { marketplaceName: 'lenne-tech', pluginName: 'lt-showroom' };

const plan = (input: Partial<Parameters<typeof planPermissionSync>[0]>) =>
  planPermissionSync({
    allow: [],
    formerApplied: [],
    formerRules: [],
    listed: [],
    owned: null,
    ownedByOthers: [],
    withdrawnRules: [],
    ...input,
  });

describe('getClaudeConfigDir', () => {
  test('defaults to ~/.claude', () => {
    expect(getClaudeConfigDir({}, '/home/kai')).toBe(join('/home/kai', '.claude'));
  });

  test('follows CLAUDE_CONFIG_DIR, resolved to an absolute path', () => {
    expect(getClaudeConfigDir({ CLAUDE_CONFIG_DIR: '/opt/claude-work' }, '/home/kai')).toBe(resolve('/opt/claude-work'));
    expect(getClaudeConfigDir({ CLAUDE_CONFIG_DIR: 'rel/dir' }, '/home/kai')).toBe(resolve('rel/dir'));
  });

  test('treats an empty CLAUDE_CONFIG_DIR as unset', () => {
    expect(getClaudeConfigDir({ CLAUDE_CONFIG_DIR: '  ' }, '/home/kai')).toBe(join('/home/kai', '.claude'));
  });
});

describe('resolvePluginRootVariable', () => {
  const root = pluginCacheRootPattern('/Users/kai/.claude', 'lenne-tech', 'lt-dev');

  test('the root is the absolute cache dir with a wildcard for the version folder', () => {
    expect(root).toBe(join('/Users/kai/.claude', 'plugins', 'cache', 'lenne-tech', 'lt-dev', '*'));
    expect(root).not.toContain('~');
  });

  test('resolves every rule shape the plugins ship', () => {
    expect(resolvePluginRootVariable('Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/*)', root)).toBe(
      `Bash(bash ${root}/scripts/*)`,
    );
    expect(resolvePluginRootVariable('Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/*)', root)).toBe(
      `Bash(bash "${root}/scripts/*)`,
    );
    expect(resolvePluginRootVariable('Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/ai-models.mjs":*)', root)).toBe(
      `Bash(node "${root}/scripts/ai-models.mjs":*)`,
    );
  });

  test('also resolves the bare form, but not a longer variable name', () => {
    expect(resolvePluginRootVariable('Bash(node $CLAUDE_PLUGIN_ROOT/x.mjs)', root)).toBe(`Bash(node ${root}/x.mjs)`);
    expect(resolvePluginRootVariable('Bash(echo $CLAUDE_PLUGIN_ROOTS)', root)).toBe('Bash(echo $CLAUDE_PLUGIN_ROOTS)');
  });

  test('a $ in the path is taken literally, not as a replacement pattern', () => {
    expect(resolvePluginRootVariable('Bash(bash ${CLAUDE_PLUGIN_ROOT}/x)', "/home/a$&b$'c")).toBe(
      "Bash(bash /home/a$&b$'c/x)",
    );
  });

  test('leaves rules without the variable unchanged', () => {
    expect(resolvePluginRootVariable('Bash(git log:*)', root)).toBe('Bash(git log:*)');
  });

  test('hasPluginRootVariable is stable across repeated calls (no lastIndex state)', () => {
    const rule = 'Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/*)';
    expect([1, 2, 3].map(() => hasPluginRootVariable(rule))).toEqual([true, true, true]);
    expect(hasPluginRootVariable('Bash(git log:*)')).toBe(false);
  });
});

describe('planPermissionSync', () => {
  test('first run: removes the former rules present, adopts the present listed ones', () => {
    const result = plan({
      allow: ['Bash(curl:*)', 'Bash(git log:*)', 'Bash(my-own-tool:*)', 'Bash(rm:*)'],
      formerRules: ['Bash(curl:*)', 'Bash(rm:*)', 'Bash(node:*)'],
      listed: ['Bash(git log:*)', 'Bash(git diff:*)'],
    });
    expect(result.removed).toEqual(['Bash(curl:*)', 'Bash(rm:*)']);
    expect(result.added).toEqual(['Bash(git diff:*)']);
    expect(result.existing).toEqual(['Bash(git log:*)']);
    expect(result.allow).toEqual(['Bash(git log:*)', 'Bash(my-own-tool:*)', 'Bash(git diff:*)']);
    expect(result.ledger).toEqual({
      formerApplied: ['Bash(curl:*)', 'Bash(rm:*)', 'Bash(node:*)'],
      owned: ['Bash(git log:*)', 'Bash(git diff:*)'],
    });
  });

  test('a rule the plugin still lists is kept even if it is also named as former', () => {
    const result = plan({ allow: ['Bash(curl:*)'], formerRules: ['Bash(curl:*)'], listed: ['Bash(curl:*)'] });
    expect(result.removed).toEqual([]);
    expect(result.ledger.owned).toEqual(['Bash(curl:*)']);
  });

  test('a listed rule the plugin drops later is removed by the next run', () => {
    const result = plan({ allow: ['Bash(curl:*)'], listed: [], owned: ['Bash(curl:*)'] });
    expect(result.removed).toEqual(['Bash(curl:*)']);
    expect(result.allow).toEqual([]);
    expect(result.ledger.owned).toEqual([]);
  });

  test('a former rule applied before is not removed again: re-added by hand, it stays', () => {
    const result = plan({
      allow: ['Bash(git push:*)'],
      formerApplied: ['Bash(git push:*)'],
      formerRules: ['Bash(git push:*)'],
      listed: ['Bash(git log:*)'],
      owned: ['Bash(git log:*)'],
    });
    expect(result.removed).toEqual([]);
    expect(result.allow).toEqual(['Bash(git push:*)', 'Bash(git log:*)']);
  });

  test('a former rule that shows up after the first run is still applied once', () => {
    const result = plan({
      allow: ['Bash(docker rm:*)'],
      formerApplied: [],
      formerRules: ['Bash(docker rm:*)'],
      listed: ['Bash(git log:*)'],
      owned: ['Bash(git log:*)'],
    });
    expect(result.removed).toEqual(['Bash(docker rm:*)']);
    expect(result.ledger.formerApplied).toEqual(['Bash(docker rm:*)']);
  });

  test('never removes a rule nobody recorded, even if no plugin lists it', () => {
    const result = plan({ allow: ['Bash(docker:*)'], listed: [], owned: [] });
    expect(result.removed).toEqual([]);
    expect(result.allow).toEqual(['Bash(docker:*)']);
  });

  test('keeps a dropped rule another plugin still owns', () => {
    const result = plan({
      allow: ['Bash(git log:*)'],
      formerRules: ['Bash(git log:*)'],
      listed: [],
      owned: ['Bash(git log:*)'],
      ownedByOthers: ['Bash(git log:*)'],
    });
    expect(result.removed).toEqual([]);
    expect(result.allow).toEqual(['Bash(git log:*)']);
  });

  test('a user rule present before the ledger entry existed is not adopted later', () => {
    const result = plan({
      allow: ['Bash(jq:*)'],
      listed: ['Bash(git log:*)', 'Bash(jq:*)'],
      owned: ['Bash(git log:*)'],
    });
    expect(result.existing).toEqual(['Bash(jq:*)']);
    expect(result.ledger.owned).toEqual(['Bash(git log:*)']);
  });

  test('removes withdrawn rules on every run, even when nobody recorded them', () => {
    const verbatim = 'Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/*)';
    const wildcard = 'Bash(bash /Users/kai/.claude/plugins/cache/lenne-tech/lt-dev/*/scripts/*)';
    const result = plan({
      allow: [verbatim, 'Bash(git log:*)', wildcard],
      listed: ['Bash(git log:*)'],
      owned: ['Bash(git log:*)'],
      withdrawnRules: [verbatim, wildcard],
    });
    expect(result.removed).toEqual([verbatim, wildcard]);
    expect(result.allow).toEqual(['Bash(git log:*)']);
  });

  test('reports a removed rule once and drops all its duplicates', () => {
    const result = plan({ allow: ['Bash(rm:*)', 'Bash(x)', 'Bash(rm:*)'], listed: [], owned: ['Bash(rm:*)'] });
    expect(result.removed).toEqual(['Bash(rm:*)']);
    expect(result.allow).toEqual(['Bash(x)']);
  });

  test('only reports rules that were actually present, but marks absent former rules as applied', () => {
    const result = plan({ allow: [], formerRules: ['Bash(rm:*)'], listed: [] });
    expect(result.removed).toEqual([]);
    expect(result.ledger.formerApplied).toEqual(['Bash(rm:*)']);
  });
});

describe('setupPermissions', () => {
  let tmpDir: string;
  let claudeConfigDir: string;
  let ledgerPath: string;
  let settingsPath: string;
  let errors: string[];
  const error = (msg: string) => errors.push(msg);

  const writeSettings = (settings: unknown) => {
    mkdirSync(claudeConfigDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  };
  const readSettings = () => JSON.parse(readFileSync(settingsPath, 'utf-8'));
  const run = (plugin: typeof LT_DEV, permissions: string[], formerPermissions: string[] = []) =>
    setupPermissions(plugin, { formerPermissions, permissions }, error, { claudeConfigDir, ledgerPath });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lt-perm-'));
    claudeConfigDir = join(tmpDir, 'claude-config');
    ledgerPath = join(tmpDir, 'lenneTech', 'claude-plugin-permissions.json');
    settingsPath = join(claudeConfigDir, 'settings.json');
    errors = [];
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  test('upgrades an existing install: drops former rules, keeps user rules and the other settings', () => {
    writeSettings({
      model: 'opus',
      permissions: { allow: ['Bash(curl:*)', 'Bash(git log:*)', 'Bash(my-own-tool:*)'], deny: ['Bash(sudo:*)'] },
    });

    const result = run(LT_DEV, ['Bash(git log:*)', 'Bash(git diff:*)'], ['Bash(curl:*)']);

    expect(result.success).toBe(true);
    expect(result.removed).toEqual(['Bash(curl:*)']);
    expect(result.added).toEqual(['Bash(git diff:*)']);
    expect(readSettings()).toEqual({
      model: 'opus',
      permissions: {
        allow: ['Bash(git log:*)', 'Bash(my-own-tool:*)', 'Bash(git diff:*)'],
        deny: ['Bash(sudo:*)'],
      },
    });
    expect(readLedgerEntries(ledgerPath, settingsPath)).toEqual({
      'lenne-tech/lt-dev': { formerApplied: ['Bash(curl:*)'], owned: ['Bash(git log:*)', 'Bash(git diff:*)'] },
    });
    expect(errors).toEqual([]);
  });

  test('never writes a ${CLAUDE_PLUGIN_ROOT} rule: a version wildcard would allow any file via ../', () => {
    writeSettings({ permissions: { allow: [] } });
    const shipped = ['Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/*)', 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*)'];

    const result = run(LT_DEV, ['Bash(git log:*)', ...shipped]);

    expect(result.skipped).toEqual(shipped);
    expect(result.written).toEqual(['Bash(git log:*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(git log:*)']);
    expect(readSettings().permissions.allow.join('\n')).not.toContain('/plugins/cache/');
  });

  test('removes both spellings of a ${CLAUDE_PLUGIN_ROOT} rule, also when a pre-release build recorded the wildcard form as its own', () => {
    const verbatim = 'Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/*)';
    const wildcard = `Bash(bash ${join(claudeConfigDir, 'plugins', 'cache', 'lenne-tech', 'lt-dev', '*')}/scripts/*)`;
    writeSettings({ permissions: { allow: [verbatim, wildcard, 'Bash(git log:*)', 'Bash(my-own-tool:*)'] } });
    recordLedgerEntry(ledgerPath, settingsPath, 'lenne-tech/lt-dev', {
      formerApplied: [],
      owned: ['Bash(git log:*)', wildcard],
    });

    const result = run(LT_DEV, ['Bash(git log:*)', verbatim]);

    expect(result.removed).toEqual([wildcard, verbatim]);
    expect(readSettings().permissions.allow).toEqual(['Bash(git log:*)', 'Bash(my-own-tool:*)']);
    expect(readLedgerEntries(ledgerPath, settingsPath)['lenne-tech/lt-dev'].owned).toEqual(['Bash(git log:*)']);
  });

  test('a rule the plugin drops later is removed on the next run, a user rule is not', () => {
    writeSettings({ permissions: { allow: ['Bash(my-own-tool:*)'] } });
    run(LT_DEV, ['Bash(git log:*)', 'Bash(git push:*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(my-own-tool:*)', 'Bash(git log:*)', 'Bash(git push:*)']);

    const result = run(LT_DEV, ['Bash(git log:*)']);

    expect(result.removed).toEqual(['Bash(git push:*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(my-own-tool:*)', 'Bash(git log:*)']);
  });

  test('a plugin that ships no rules any more still gets its former rules removed', () => {
    writeSettings({ permissions: { allow: ['Bash(curl *api.example.com*)', 'Bash(jq:*)'] } });

    const result = run({ marketplaceName: 'lenne-tech', pluginName: 'lt-offers' }, [], ['Bash(curl *api.example.com*)']);

    expect(result.removed).toEqual(['Bash(curl *api.example.com*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(jq:*)']);
  });

  test('order does not matter: a CLI that meets the plugin before formerPatterns ships still applies them later', () => {
    writeSettings({ permissions: { allow: ['Bash(docker rm:*)'] } });
    expect(run(LT_SHOWROOM, ['Bash(lsof:*)']).removed).toEqual([]);

    const result = run(LT_SHOWROOM, ['Bash(lsof:*)'], ['Bash(docker rm:*)']);

    expect(result.removed).toEqual(['Bash(docker rm:*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(lsof:*)']);
  });

  test('a former rule is removed once; added back by hand, it stays', () => {
    writeSettings({ permissions: { allow: ['Bash(git push:*)'] } });
    expect(run(LT_DEV, ['Bash(git log:*)'], ['Bash(git push:*)']).removed).toEqual(['Bash(git push:*)']);

    writeSettings({ permissions: { allow: [...readSettings().permissions.allow, 'Bash(git push:*)'] } });
    const result = run(LT_DEV, ['Bash(git log:*)'], ['Bash(git push:*)']);

    expect(result.removed).toEqual([]);
    expect(readSettings().permissions.allow).toContain('Bash(git push:*)');
  });

  test('a former rule with ${CLAUDE_PLUGIN_ROOT} is removed in both spellings', () => {
    const former = 'Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/old.mjs)';
    const resolvedFormer = `Bash(node ${join(claudeConfigDir, 'plugins', 'cache', 'lenne-tech', 'lt-dev', '*')}/scripts/old.mjs)`;
    writeSettings({ permissions: { allow: [former, resolvedFormer, 'Bash(jq:*)'] } });

    const result = run(LT_DEV, [], [former]);

    expect(result.removed).toEqual([former, resolvedFormer]);
    expect(readSettings().permissions.allow).toEqual(['Bash(jq:*)']);
  });

  test('handles rules of any tool, not only Bash: a Skill rule is written verbatim, owned, and removed when dropped', () => {
    writeSettings({ permissions: { allow: [] } });

    run(LT_DEV, ['Skill(lt-dev:running-check-script)', 'Bash(git fetch:*)']);
    expect(readSettings().permissions.allow).toEqual(['Skill(lt-dev:running-check-script)', 'Bash(git fetch:*)']);
    expect(readLedgerEntries(ledgerPath, settingsPath)['lenne-tech/lt-dev'].owned).toEqual([
      'Skill(lt-dev:running-check-script)',
      'Bash(git fetch:*)',
    ]);

    expect(run(LT_DEV, ['Bash(git fetch:*)']).removed).toEqual(['Skill(lt-dev:running-check-script)']);
  });

  test('a rule shared by two plugins survives when only one of them drops it', () => {
    writeSettings({ permissions: { allow: [] } });
    run(LT_DEV, ['Bash(git log:*)']);
    run(LT_SHOWROOM, ['Bash(git log:*)', 'Bash(lsof:*)']);

    const result = run(LT_SHOWROOM, ['Bash(lsof:*)']);

    expect(result.removed).toEqual([]);
    expect(readSettings().permissions.allow).toEqual(['Bash(git log:*)', 'Bash(lsof:*)']);
  });

  test('does not rewrite settings.json when nothing changes', () => {
    // Compact JSON: any rewrite would come back indented.
    const compact = '{"permissions":{"allow":["Bash(git log:*)"]}}';
    mkdirSync(claudeConfigDir, { recursive: true });
    writeFileSync(settingsPath, compact);

    const result = run(LT_DEV, ['Bash(git log:*)']);

    expect(result).toMatchObject({ added: [], existing: ['Bash(git log:*)'], removed: [], success: true });
    expect(readFileSync(settingsPath, 'utf-8')).toBe(compact);
  });

  test('creates settings.json and its directory when missing', () => {
    const result = run(LT_DEV, ['Bash(git log:*)']);

    expect(result.added).toEqual(['Bash(git log:*)']);
    expect(readSettings()).toEqual({ permissions: { allow: ['Bash(git log:*)'] } });
  });

  test('refuses to touch a settings.json that is not valid JSON', () => {
    mkdirSync(claudeConfigDir, { recursive: true });
    writeFileSync(settingsPath, '{ "model": "opus", broken');

    const result = run(LT_DEV, ['Bash(git log:*)']);

    expect(result.success).toBe(false);
    expect(readFileSync(settingsPath, 'utf-8')).toBe('{ "model": "opus", broken');
    expect(existsSync(ledgerPath)).toBe(false);
    expect(errors.join('\n')).toContain('left unchanged');
  });

  test('refuses a permissions.allow that is not a list of rules', () => {
    writeSettings({ permissions: { allow: 'Bash(git log:*)' } });

    const result = run(LT_DEV, ['Bash(git log:*)']);

    expect(result.success).toBe(false);
    expect(readSettings()).toEqual({ permissions: { allow: 'Bash(git log:*)' } });
  });

  test('keeps the ledger apart per settings file (CLAUDE_CONFIG_DIR profiles)', () => {
    writeSettings({ permissions: { allow: [] } });
    run(LT_DEV, ['Bash(git log:*)']);

    const otherDir = join(tmpDir, 'other-profile');
    setupPermissions(LT_DEV, { formerPermissions: [], permissions: ['Bash(git diff:*)'] }, error, {
      claudeConfigDir: otherDir,
      ledgerPath,
    });

    expect(readLedgerEntries(ledgerPath, settingsPath)).toEqual({
      'lenne-tech/lt-dev': { formerApplied: [], owned: ['Bash(git log:*)'] },
    });
    expect(readLedgerEntries(ledgerPath, join(otherDir, 'settings.json'))).toEqual({
      'lenne-tech/lt-dev': { formerApplied: [], owned: ['Bash(git diff:*)'] },
    });
  });
});

describe('readPluginContents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lt-plugin-contents-'));
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    rmSync(tmpDir, { force: true, recursive: true });
  });

  const writePermissionsJson = (content: unknown) => {
    const pluginDir = join(tmpDir, 'plugins', 'marketplaces', 'lenne-tech', 'plugins', 'lt-dev');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'permissions.json'), JSON.stringify(content));
  };

  test('reads formerPatterns from the marketplace clone below CLAUDE_CONFIG_DIR, strings only', () => {
    writePermissionsJson({
      formerPatterns: ['Bash(curl:*)', 42, 'Bash(rm:*)'],
      permissions: [{ pattern: 'Bash(git log:*)' }],
    });

    const contents = readPluginContents('lenne-tech', 'lt-dev');

    expect(contents.permissions).toEqual(['Bash(git log:*)']);
    expect(contents.formerPermissions).toEqual(['Bash(curl:*)', 'Bash(rm:*)']);
  });

  test('a permissions.json without formerPatterns, or with a malformed one, yields none', () => {
    writePermissionsJson({ permissions: [{ pattern: 'Bash(git log:*)' }] });
    expect(readPluginContents('lenne-tech', 'lt-dev').formerPermissions).toEqual([]);

    writePermissionsJson({ formerPatterns: 'Bash(curl:*)', permissions: [] });
    expect(readPluginContents('lenne-tech', 'lt-dev').formerPermissions).toEqual([]);
  });
});

describe('ledger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lt-ledger-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  test('reads a missing or corrupt ledger as empty', () => {
    const ledgerPath = join(tmpDir, 'ledger.json');
    expect(readLedgerEntries(ledgerPath, '/s.json')).toEqual({});
    writeFileSync(ledgerPath, 'not json');
    expect(readLedgerEntries(ledgerPath, '/s.json')).toEqual({});
  });

  test('drops entries of the wrong shape and non-string rules', () => {
    const ledgerPath = join(tmpDir, 'ledger.json');
    writeFileSync(
      ledgerPath,
      JSON.stringify({
        settings: {
          '/s.json': {
            a: { formerApplied: ['Bash(f)', null], owned: ['Bash(x)', 3] },
            b: ['Bash(y)'],
            c: { formerApplied: ['Bash(z)'] },
          },
        },
        version: 1,
      }),
    );
    expect(readLedgerEntries(ledgerPath, '/s.json')).toEqual({ a: { formerApplied: ['Bash(f)'], owned: ['Bash(x)'] } });
  });

  test('records entries without touching the other plugins and leaves no temp file', () => {
    const ledgerPath = join(tmpDir, 'nested', 'ledger.json');
    recordLedgerEntry(ledgerPath, '/s.json', 'm/a', { formerApplied: [], owned: ['Bash(x)'] });
    recordLedgerEntry(ledgerPath, '/s.json', 'm/b', { formerApplied: ['Bash(f)'], owned: ['Bash(y)'] });

    expect(readLedgerEntries(ledgerPath, '/s.json')).toEqual({
      'm/a': { formerApplied: [], owned: ['Bash(x)'] },
      'm/b': { formerApplied: ['Bash(f)'], owned: ['Bash(y)'] },
    });
    expect(existsSync(`${ledgerPath}.${process.pid}.tmp`)).toBe(false);
  });
});
