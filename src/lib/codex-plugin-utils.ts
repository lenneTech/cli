/**
 * Codex plugin setup helpers.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { safeJsonParse } from './json-utils';

export interface CodexMarketplaceManifest {
  name: string;
  plugins?: Array<{ name: string }>;
}

export interface CodexPluginContents {
  agents: string[];
  hooks: number;
  mcpServers: string[];
  prompts: string[];
  skills: string[];
}

export const EMPTY_CODEX_PLUGIN_CONTENTS: CodexPluginContents = {
  agents: [],
  hooks: 0,
  mcpServers: [],
  prompts: [],
  skills: [],
};

export function installCodexAgents(pluginRoot: string): number {
  const sourceDir = join(pluginRoot, 'codex-agents');
  if (!existsSync(sourceDir)) {
    return 0;
  }

  const targetDir = join(homedir(), '.codex', 'agents');
  mkdirSync(targetDir, { recursive: true });

  let count = 0;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.toml')) continue;
    copyFileSync(join(sourceDir, entry.name), join(targetDir, entry.name));
    count += 1;
  }
  return count;
}

export function installCodexPrompts(pluginRoot: string): number {
  const sourceDir = join(pluginRoot, 'prompts');
  if (!existsSync(sourceDir)) {
    return 0;
  }

  const targetDir = join(homedir(), '.codex', 'prompts');
  mkdirSync(targetDir, { recursive: true });

  let count = 0;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    copyFileSync(join(sourceDir, entry.name), join(targetDir, entry.name));
    count += 1;
  }
  return count;
}

export function readCodexMarketplaceName(root: string): null | string {
  const path = join(root, '.agents', 'plugins', 'marketplace.json');
  if (!existsSync(path)) {
    return null;
  }

  const parsed = safeJsonParse<CodexMarketplaceManifest>(readFileSync(path, 'utf-8'));
  return parsed?.name || null;
}

export function readLocalCodexPluginContents(pluginRoot: string): CodexPluginContents {
  const result: CodexPluginContents = { ...EMPTY_CODEX_PLUGIN_CONTENTS };

  const skillsDir = join(pluginRoot, 'skills');
  if (existsSync(skillsDir)) {
    result.skills = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  const agentsDir = join(pluginRoot, 'codex-agents');
  if (existsSync(agentsDir)) {
    result.agents = readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.toml'))
      .map((entry) => entry.name.replace(/\.toml$/, ''))
      .sort();
  }

  const promptsDir = join(pluginRoot, 'prompts');
  if (existsSync(promptsDir)) {
    result.prompts = readdirSync(promptsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name.replace(/\.md$/, ''))
      .sort();
  }

  const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
  if (existsSync(hooksPath)) {
    const parsed = safeJsonParse<{ hooks?: Record<string, Array<{ hooks?: unknown[] }>> }>(
      readFileSync(hooksPath, 'utf-8'),
    );
    if (parsed?.hooks) {
      for (const groups of Object.values(parsed.hooks)) {
        for (const group of groups) {
          result.hooks += Array.isArray(group.hooks) ? group.hooks.length : 0;
        }
      }
    }
  }

  const mcpPath = join(pluginRoot, '.mcp.json');
  if (existsSync(mcpPath)) {
    const parsed = safeJsonParse<{ mcpServers?: Record<string, unknown> }>(readFileSync(mcpPath, 'utf-8'));
    result.mcpServers = Object.keys(parsed?.mcpServers || {}).sort();
  }

  return result;
}
