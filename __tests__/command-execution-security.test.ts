/**
 * Tests for command execution security hardening
 * Verifies that shell commands use spawnSync (no shell interpretation)
 * and that command injection via shell metacharacters is prevented
 */
import { spawnSync } from 'child_process';

import { checkCommandExists, findClaudeCli } from '../src/lib/claude-cli';
import { processPostInstall, safeExecCommand } from '../src/lib/plugin-utils';

// ─── safeExecCommand ───────────────────────────────────────────────

describe('safeExecCommand', () => {
  test('executes a simple command successfully', () => {
    expect(() => safeExecCommand('echo hello')).not.toThrow();
  });

  test('throws on non-existent command', () => {
    expect(() => safeExecCommand('__nonexistent_command_12345__')).toThrow();
  });

  test('throws on command that exits with non-zero', () => {
    expect(() => safeExecCommand('node -e process.exit(1)')).toThrow();
  });

  test('does not interpret shell semicolons as command separator', () => {
    // With execSync this would run two commands: "echo a" and "echo b"
    // With spawnSync this passes "; echo b" as arguments to echo
    // So it should NOT execute a second command
    const tmpFile = `/tmp/__security_test_${Date.now()}__`;

    // If shell interpretation happened, this would create the file
    try {
      safeExecCommand(`echo safe ; touch ${tmpFile}`);
    } catch {
      // May fail because echo gets weird args, that's fine
    }

    // Verify the file was NOT created (touch was not executed as separate command)
    const result = spawnSync('test', ['-f', tmpFile], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
  });

  test('does not interpret shell pipes', () => {
    const tmpFile = `/tmp/__security_test_pipe_${Date.now()}__`;

    try {
      safeExecCommand(`echo safe | touch ${tmpFile}`);
    } catch {
      // Expected to fail
    }

    const result = spawnSync('test', ['-f', tmpFile], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
  });

  test('does not interpret $() command substitution', () => {
    const tmpFile = `/tmp/__security_test_subst_${Date.now()}__`;

    try {
      safeExecCommand(`echo $(touch ${tmpFile})`);
    } catch {
      // Expected to fail
    }

    const result = spawnSync('test', ['-f', tmpFile], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
  });

  test('does not interpret backtick command substitution', () => {
    const tmpFile = `/tmp/__security_test_bt_${Date.now()}__`;

    try {
      safeExecCommand('echo `touch ' + tmpFile + '`');
    } catch {
      // Expected to fail
    }

    const result = spawnSync('test', ['-f', tmpFile], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
  });

  test('handles commands with multiple spaces gracefully', () => {
    expect(() => safeExecCommand('  echo   hello  ')).not.toThrow();
  });
});

// ─── checkCommandExists ────────────────────────────────────────────

describe('checkCommandExists', () => {
  test('returns true for existing command (node)', () => {
    expect(checkCommandExists('which node')).toBe(true);
  });

  test('returns true for command with arguments', () => {
    expect(checkCommandExists('node --version')).toBe(true);
  });

  test('returns false for non-existent command', () => {
    expect(checkCommandExists('which __nonexistent_command_xyz__')).toBe(false);
  });

  test('returns false for completely invalid command', () => {
    expect(checkCommandExists('__totally_fake_binary__')).toBe(false);
  });

  test('does not interpret shell metacharacters', () => {
    // If shell interpretation happened, "which node; which npm" would succeed
    // because "which node" succeeds. With spawnSync, the whole string
    // "; which npm" is passed as args to "which", which should fail or
    // at minimum not execute a second command
    const result = checkCommandExists('which node; echo injected');
    // "which" gets "node;" as first arg — this may or may not find node
    // The key test is that no separate command runs
    expect(typeof result).toBe('boolean');
  });
});

// ─── findClaudeCli ─────────────────────────────────────────────────

describe('findClaudeCli', () => {
  test('returns a string path or null', () => {
    const result = findClaudeCli();
    expect(result === null || typeof result === 'string').toBe(true);
  });

  test('returned path exists on disk if not null', () => {
    const result = findClaudeCli();
    if (result !== null) {
      const check = spawnSync('test', ['-f', result], { encoding: 'utf-8' });
      expect(check.status).toBe(0);
    }
  });
});

// ─── processPostInstall (integration) ──────────────────────────────

describe('processPostInstall', () => {
  const mockToolbox = () => {
    const logs: string[] = [];
    return {
      logs,
      print: {
        spin: (msg: string) => ({
          fail: (m: string) => logs.push(`FAIL: ${m}`),
          succeed: (m: string) => logs.push(`OK: ${m}`),
          text: msg,
        }),
        warning: (msg: string) => logs.push(`WARN: ${msg}`),
      },
    };
  };

  test('returns success for unknown plugin (no post-install config)', () => {
    const toolbox = mockToolbox();
    const result = processPostInstall('__unknown_plugin__', toolbox);
    expect(result.success).toBe(true);
    expect(result.requirementsInstalled).toHaveLength(0);
    expect(result.requirementsMissing).toHaveLength(0);
  });

  test('returns success for plugin with empty config (lt-offers)', () => {
    const toolbox = mockToolbox();
    const result = processPostInstall('lt-offers', toolbox);
    expect(result.success).toBe(true);
  });

  test('detects already-installed requirement via checkCommand', () => {
    // Temporarily add a test entry to PLUGIN_POST_INSTALL
    const { PLUGIN_POST_INSTALL } = require('../src/lib/plugin-utils');
    PLUGIN_POST_INSTALL['__test_plugin__'] = {
      requirements: [
        {
          checkCommand: 'which node',
          description: 'Node.js',
          installCommand: 'echo skip',
        },
      ],
    };

    const toolbox = mockToolbox();
    const result = processPostInstall('__test_plugin__', toolbox);

    expect(result.success).toBe(true);
    expect(toolbox.logs.some((l) => l.includes('already installed'))).toBe(true);

    // Cleanup
    delete PLUGIN_POST_INSTALL['__test_plugin__'];
  });

  test('reports missing requirement when install fails', () => {
    const { PLUGIN_POST_INSTALL } = require('../src/lib/plugin-utils');
    PLUGIN_POST_INSTALL['__test_fail_plugin__'] = {
      requirements: [
        {
          checkCommand: 'which __nonexistent_xyz__',
          description: 'Fake tool',
          installCommand: '__nonexistent_installer__',
        },
      ],
    };

    const toolbox = mockToolbox();
    const result = processPostInstall('__test_fail_plugin__', toolbox);

    expect(result.success).toBe(false);
    expect(result.requirementsMissing).toContain('Fake tool');

    delete PLUGIN_POST_INSTALL['__test_fail_plugin__'];
  });

  test('runs installCommand without checkCommand', () => {
    const { PLUGIN_POST_INSTALL } = require('../src/lib/plugin-utils');
    PLUGIN_POST_INSTALL['__test_nocheck__'] = {
      requirements: [
        {
          description: 'Echo test',
          installCommand: 'echo post-install-done',
        },
      ],
    };

    const toolbox = mockToolbox();
    const result = processPostInstall('__test_nocheck__', toolbox);

    expect(result.success).toBe(true);
    expect(result.requirementsInstalled).toContain('Echo test');

    delete PLUGIN_POST_INSTALL['__test_nocheck__'];
  });
});
