#!/usr/bin/env node

/**
 * Postinstall script for lt CLI
 * Generates static completion files on install/update (no runtime overhead)
 */

const { execSync } = require('child_process');
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');

/**
 * Add source line to shell config
 */
function addSourceLine(configFile, sourceLine) {
  if (!configFile || !sourceLine) return false;

  try {
    appendFileSync(configFile, `\n${sourceLine}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect user's shell
 */
function detectShell() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  return 'bash';
}

/**
 * Generate and write completion file
 */
function generateCompletionFile(shell, completionFile) {
  try {
    // Ensure directory exists
    const dir = join(completionFile, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Generate completion script
    const script = execSync(`lt completion ${shell}`, { encoding: 'utf-8' });
    writeFileSync(completionFile, script);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get completion file paths
 */
function getCompletionPaths(shell) {
  const home = homedir();
  const ltDir = join(home, '.local', 'share', 'lt', 'completions');

  switch (shell) {
    case 'fish':
      return {
        completionFile: join(home, '.config', 'fish', 'completions', 'lt.fish'),
        configFile: null, // Fish auto-loads from completions dir
        sourceLine: null,
      };
    case 'zsh':
      return {
        completionFile: join(ltDir, '_lt'),
        configFile: join(home, '.zshrc'),
        // Source the file directly - it uses compdef internally
        // This avoids calling compinit which conflicts with Powerlevel10k instant prompt
        sourceLine: `# lt CLI completion\n[ -f ~/.local/share/lt/completions/_lt ] && source ~/.local/share/lt/completions/_lt`,
      };
    case 'bash':
    default:
      return {
        completionFile: join(ltDir, 'lt.bash'),
        configFile: existsSync(join(home, '.bash_profile'))
          ? join(home, '.bash_profile')
          : join(home, '.bashrc'),
        sourceLine: `# lt CLI completion\n[ -f ~/.local/share/lt/completions/lt.bash ] && source ~/.local/share/lt/completions/lt.bash`,
      };
  }
}

/**
 * Check if source line is already in config
 */
function isSourceLineInstalled(configFile) {
  if (!configFile || !existsSync(configFile)) {
    return false;
  }
  const content = readFileSync(configFile, 'utf-8');
  return content.includes('lt CLI completion') || content.includes('lt/completions');
}

/**
 * Main postinstall function
 */
function main() {
  // Skip in CI environments
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return;
  }

  const shell = detectShell();
  const paths = getCompletionPaths(shell);
  const isTTY = process.stdout.isTTY;

  // Check if completions were previously installed
  const wasInstalled = existsSync(paths.completionFile) || isSourceLineInstalled(paths.configFile);

  // Always regenerate completion file on install/update (even in non-TTY)
  const generated = generateCompletionFile(shell, paths.completionFile);

  if (!generated) {
    return; // Silent fail
  }

  // If completions were previously installed, we just updated them (silent in non-TTY)
  if (wasInstalled) {
    if (isTTY) {
      console.info(`\n✓ Shell completions updated for ${shell}`);
    }
    return;
  }

  // For new installations: only add source line in TTY mode (interactive)
  if (!isTTY) {
    return;
  }

  // For Bash/Zsh: add source line to config if not already present
  if (paths.configFile && !isSourceLineInstalled(paths.configFile)) {
    const added = addSourceLine(paths.configFile, paths.sourceLine);
    if (added) {
      console.info(`\n✓ Shell completion installed for ${shell}`);
      console.info(`  Restart your terminal or run: source ${paths.configFile}\n`);
      return;
    }
  }

  // Fish: completions are auto-loaded
  if (shell === 'fish') {
    console.info(`\n✓ Fish completions installed`);
    console.info(`  Restart your terminal to activate\n`);
  }
}

// Run
main();
