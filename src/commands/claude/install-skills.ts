import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Skill-specific permissions mapping
 */
const SKILL_PERMISSIONS: Record<string, string[]> = {
  'building-stories-with-tdd': [
    'Bash(npm test:*)',
    'Bash(npm run test:*)',
  ],
  'generating-nest-servers': [
    'Bash(lt server:*)',
  ],
  'using-lt-cli': [
    'Bash(lt:*)',
  ],
};

/**
 * Mapping of old skill names to new names (for cleanup of renamed skills)
 */
const LEGACY_SKILL_NAMES: Record<string, string> = {
  'lt-cli': 'using-lt-cli',
  'nest-server-generator': 'generating-nest-servers',
  'story-tdd': 'building-stories-with-tdd',
};

/**
 * Check for and optionally remove legacy skill directories
 * Returns list of deleted legacy skills
 */
async function cleanupLegacySkills(
  filesystem: any,
  info: any,
  prompt: any,
  skipInteractive: boolean,
): Promise<string[]> {
  const skillsBaseDir = join(homedir(), '.claude', 'skills');
  const deletedSkills: string[] = [];

  // Check if skills directory exists
  if (!filesystem.exists(skillsBaseDir)) {
    return deletedSkills;
  }

  // Find existing legacy skill directories
  const existingLegacySkills: Array<{ newName: string; oldName: string; path: string }> = [];

  for (const [oldName, newName] of Object.entries(LEGACY_SKILL_NAMES)) {
    const legacyPath = join(skillsBaseDir, oldName);
    if (filesystem.exists(legacyPath) && filesystem.isDirectory(legacyPath)) {
      existingLegacySkills.push({ newName, oldName, path: legacyPath });
    }
  }

  if (existingLegacySkills.length === 0) {
    return deletedSkills;
  }

  // Show found legacy skills
  info('');
  info('Found legacy skill directories (renamed skills):');
  existingLegacySkills.forEach(({ newName, oldName }) => {
    info(`  • ${oldName} → ${newName}`);
  });
  info('');

  // Ask if user wants to delete them (default: yes)
  const shouldDelete = skipInteractive ? true : await prompt.confirm(
    'Delete these old skill directories?',
    true
  );

  if (shouldDelete) {
    for (const { oldName, path } of existingLegacySkills) {
      try {
        filesystem.remove(path);
        deletedSkills.push(oldName);
        info(`  ✓ Deleted ${oldName}`);
      } catch (err) {
        info(`  ✗ Could not delete ${oldName}: ${err.message}`);
      }
    }
    if (deletedSkills.length > 0) {
      info('');
    }
  }

  return deletedSkills;
}

/**
 * Get skill descriptions from SKILL.md frontmatter
 */
function getSkillDescription(skillDir: string, filesystem: any): string {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!filesystem.exists(skillMdPath)) {
    return 'No description available';
  }

  const content = filesystem.read(skillMdPath);
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return 'No description available';
  }

  const frontmatter = frontmatterMatch[1];
  const descMatch = frontmatter.match(/description:\s*([^\n]+)/);

  return descMatch ? descMatch[1].trim() : 'No description available';
}

/**
 * Install a single skill
 */
async function installSingleSkill(
  skillName: string,
  cliRoot: string,
  filesystem: any,
  info: any,
  error: any
): Promise<{ copiedCount: number; skippedCount: number; skippedFiles: Array<{ file: string; reason: string }>; success: boolean; updatedCount: number; }> {
  const templatesDir = join(cliRoot, 'templates', 'claude-skills', skillName);

  // Check if templates exist
  if (!filesystem.exists(templatesDir)) {
    error(`Skill '${skillName}' not found in CLI installation.`);
    info(`Expected location: ${templatesDir}`);
    return { copiedCount: 0, skippedCount: 0, skippedFiles: [], success: false, updatedCount: 0 };
  }

  // Create ~/.claude/skills/<skillName> directory
  const skillsDir = join(homedir(), '.claude', 'skills', skillName);
  if (!filesystem.exists(skillsDir)) {
    filesystem.dir(skillsDir);
  }

  // Copy all skill files with version checking
  const skillFiles = ['SKILL.md', 'examples.md', 'reference.md'];
  let copiedCount = 0;
  let skippedCount = 0;
  let updatedCount = 0;
  const skippedFiles: Array<{ file: string; reason: string }> = [];

  info(`\nInstalling skill: ${skillName}`);

  for (const file of skillFiles) {
    const sourcePath = join(templatesDir, file);
    const targetPath = join(skillsDir, file);

    if (!filesystem.exists(sourcePath)) {
      info(`  Warning: ${file} not found in templates, skipping...`);
      continue;
    }

    const sourceContent = filesystem.read(sourcePath);

    // Check if target file exists
    if (filesystem.exists(targetPath)) {
      const targetContent = filesystem.read(targetPath);

      // Parse versions from both files
      const sourceVersion = parseVersion(sourceContent);
      const targetVersion = parseVersion(targetContent);

      // If both have versions, compare them
      if (sourceVersion && targetVersion) {
        if (isVersionNewer(sourceVersion, targetVersion)) {
          // Source is newer or equal, update
          filesystem.write(targetPath, sourceContent);
          updatedCount++;
          copiedCount++;
          info(`  ✓ Updated ${file} (${targetVersion} → ${sourceVersion})`);
        } else {
          // Target is newer, skip
          skippedCount++;
          const reason = `local version ${targetVersion} is newer than ${sourceVersion}`;
          skippedFiles.push({ file: `${skillName}/${file}`, reason });
          info(`  ⊙ Skipped ${file} (${reason})`);
        }
      } else if (sourceVersion && !targetVersion) {
        // Source has version, target doesn't - update
        filesystem.write(targetPath, sourceContent);
        updatedCount++;
        copiedCount++;
        info(`  ✓ Updated ${file} (no version → ${sourceVersion})`);
      } else {
        // No version info, always update (backward compatibility)
        filesystem.write(targetPath, sourceContent);
        updatedCount++;
        copiedCount++;
        info(`  ✓ Updated ${file} (no version control)`);
      }
    } else {
      // Target doesn't exist, create new
      filesystem.write(targetPath, sourceContent);
      copiedCount++;
      const version = parseVersion(sourceContent);
      info(`  + Created ${file}${version ? ` (v${version})` : ''}`);
    }
  }

  return { copiedCount, skippedCount, skippedFiles, success: true, updatedCount };
}

/**
 * Compare semantic versions
 * Returns true if sourceVersion >= targetVersion
 */
function isVersionNewer(sourceVersion: string, targetVersion: string): boolean {
  const parseSemver = (version: string): number[] => {
    return version.split('.').map(n => parseInt(n, 10) || 0);
  };

  const source = parseSemver(sourceVersion);
  const target = parseSemver(targetVersion);

  // Compare major, minor, patch
  for (let i = 0; i < 3; i++) {
    if (source[i] > target[i]) {
      return true;
    }
    if (source[i] < target[i]) {
      return false;
    }
  }

  // Versions are equal
  return true;
}

/**
 * Parse frontmatter from markdown file and extract version
 */
function parseVersion(content: string): null | string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const versionMatch = frontmatter.match(/version:\s*([^\n]+)/);

  return versionMatch ? versionMatch[1].trim() : null;
}

/**
 * Setup project detection hook for nest-server-generator
 */
async function setupProjectDetectionHook(
  filesystem: any,
  info: any,
  error: any,
  promptConfirm: any,
  skipInteractive: boolean,
): Promise<{
  added: boolean;
  alreadyExists: boolean;
  error?: boolean;
  scope: 'global' | 'none' | 'project';
  success: boolean;
}> {
  const globalSettingsPath = join(homedir(), '.claude', 'settings.json');
  const cwd = filesystem.cwd();

  // Detect if we're in a project with package.json
  let packageJsonPath = null;
  let searchDir = cwd;

  // Search up to 3 levels for package.json
  for (let i = 0; i < 3; i++) {
    const testPath = join(searchDir, 'package.json');
    if (filesystem.exists(testPath)) {
      packageJsonPath = testPath;
      break;
    }
    const parent = join(searchDir, '..');
    if (parent === searchDir) break; // Reached root
    searchDir = parent;
  }

  // Determine installation scope
  let scope: 'global' | 'project' = 'global';
  let settingsPath = globalSettingsPath;
  let projectRoot = null;

  if (packageJsonPath) {
    projectRoot = searchDir;
    const projectSettingsPath = join(projectRoot, '.claude', 'settings.json');

    // Ask where to install the hook
    if (!skipInteractive) {
      info('');
      info(`Detected project at: ${projectRoot}`);
      const choices = [
        { name: 'Global (~/.claude/settings.json) - Available for all projects', value: 'global' },
        { name: `Project (${projectRoot}/.claude/settings.json) - Only this project`, value: 'project' }
      ];

      const answer = await promptConfirm({
        choices: choices.map(c => c.name),
        initial: 1, // Default to project
        message: 'Where should the project detection hook be installed?',
        name: 'scope',
        type: 'select',
      });

      // Map the choice back to the value
      scope = choices[answer.scope === 0 ? 0 : 1].value as 'global' | 'project';
    } else {
      // In non-interactive mode, prefer project if we found one
      scope = 'project';
    }

    if (scope === 'project') {
      settingsPath = projectSettingsPath;
      // Ensure .claude directory exists
      filesystem.dir(join(projectRoot, '.claude'));
    }
  }

  try {
    // Read existing settings
    let settings: any = {};
    if (filesystem.exists(settingsPath)) {
      const content = filesystem.read(settingsPath);
      settings = JSON.parse(content);
    }

    // Ensure hooks array exists
    if (!settings.hooks) {
      settings.hooks = [];
    }

    // Check if hook already exists (check both old and new names for backward compatibility)
    const hookExists = settings.hooks.some((hook: any) =>
      hook.event === 'user-prompt-submit' &&
      (hook.name === 'nest-server-detector' || hook.name === 'generating-nest-servers-detector')
    );

    if (hookExists) {
      return {
        added: false,
        alreadyExists: true,
        scope,
        success: true,
      };
    }

    // Create the hook configuration
    const hook = {
      command: `
# Detect @lenne.tech/nest-server in package.json and suggest using generating-nest-servers skill
# Supports both single projects and monorepos

# Check if the prompt mentions NestJS-related tasks first
if ! echo "$PROMPT" | grep -qiE "(module|service|controller|resolver|model|object|nestjs|nest-server|lt server)"; then
  # Not a NestJS-related prompt, skip
  echo '{}'
  exit 0
fi

# Function to check if package.json contains @lenne.tech/nest-server
check_package_json() {
  local pkg_json="$1"
  if [ -f "$pkg_json" ] && grep -q "@lenne\\.tech/nest-server" "$pkg_json"; then
    return 0
  fi
  return 1
}

# First, check package.json in project root
if check_package_json "$CLAUDE_PROJECT_DIR/package.json"; then
  cat << 'EOF'
{
  "contextToAppend": "\\n\\n📦 Detected @lenne.tech/nest-server in this project. Consider using the generating-nest-servers skill for this task."
}
EOF
  exit 0
fi

# If not found in root, check common monorepo patterns
for pattern in "projects/*/package.json" "packages/*/package.json" "apps/*/package.json"; do
  for pkg_json in $CLAUDE_PROJECT_DIR/$pattern; do
    if check_package_json "$pkg_json"; then
      cat << 'EOF'
{
  "contextToAppend": "\\n\\n📦 Detected @lenne.tech/nest-server in this monorepo. Consider using the generating-nest-servers skill for this task."
}
EOF
      exit 0
    fi
  done
done

# No @lenne.tech/nest-server found
echo '{}'
exit 0
`.trim(),
      description: 'Detects projects using @lenne.tech/nest-server and suggests using generating-nest-servers skill',
      event: 'user-prompt-submit',
      name: 'generating-nest-servers-detector',
      type: 'command',
    };

    // Add the hook
    settings.hooks.push(hook);

    // Write back settings
    filesystem.write(settingsPath, JSON.stringify(settings, null, 2));

    return {
      added: true,
      alreadyExists: false,
      scope,
      success: true,
    };
  } catch (err) {
    error(`Could not configure project detection hook: ${err.message}`);
    return {
      added: false,
      alreadyExists: false,
      error: true,
      scope: 'none',
      success: false,
    };
  }
}

/**
 * Setup global permissions for installed skills
 */
async function setupSkillPermissions(
  skills: string[],
  filesystem: any,
  error: any,
): Promise<{
  added: string[];
  error?: boolean;
  existing: string[];
  requested: string[];
  success: boolean;
}> {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  // Collect all requested permissions
  const requestedPermissions: string[] = [];
  skills.forEach(skill => {
    const perms = SKILL_PERMISSIONS[skill];
    if (perms) {
      requestedPermissions.push(...perms);
    }
  });

  if (requestedPermissions.length === 0) {
    return { added: [], error: false, existing: [], requested: [], success: true };
  }

  try {
    // Read existing settings
    let settings: any = {};
    if (filesystem.exists(settingsPath)) {
      const content = filesystem.read(settingsPath);
      settings = JSON.parse(content);
    }

    // Ensure permissions.allow exists
    if (!settings.permissions) {
      settings.permissions = {};
    }
    if (!settings.permissions.allow) {
      settings.permissions.allow = [];
    }

    // Check which permissions are new vs existing
    const existingPerms = new Set(settings.permissions.allow);
    const added: string[] = [];
    const existing: string[] = [];

    requestedPermissions.forEach(perm => {
      if (existingPerms.has(perm)) {
        existing.push(perm);
      } else {
        added.push(perm);
        settings.permissions.allow.push(perm);
      }
    });

    // Write back settings
    filesystem.write(settingsPath, JSON.stringify(settings, null, 2));

    return {
      added,
      existing,
      requested: requestedPermissions,
      success: true,
    };
  } catch (err) {
    error(`Could not configure permissions: ${err.message}`);
    return {
      added: [],
      error: true,
      existing: [],
      requested: requestedPermissions,
      success: false,
    };
  }
}

/**
 * Install Claude Skills to ~/.claude/skills/
 */
const NewCommand: GluegunCommand = {
  alias: ['skills', 'is'],
  description: 'Installs Claude Skills to ~/.claude/skills/ for Claude Code integration. Interactively select which skills to install. Use -y to skip interactive selection and install all skills.',
  hidden: false,
  name: 'install-skills',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      parameters,
      print: { error, info, spin, success },
      prompt,
    } = toolbox;

    try {
      // Get the CLI installation directory
      const cliRoot = join(__dirname, '..', '..');
      const claudeSkillsDir = join(cliRoot, 'templates', 'claude-skills');

      // Check if claude-skills directory exists
      if (!filesystem.exists(claudeSkillsDir)) {
        error('Claude skills directory not found in CLI installation.');
        info(`Expected location: ${claudeSkillsDir}`);
        info('Please reinstall the CLI or report this issue.');
        return;
      }

      // Get all available skills
      const items = filesystem.list(claudeSkillsDir);
      const availableSkills = items.filter(item =>
        filesystem.isDirectory(join(claudeSkillsDir, item))
      );

      if (availableSkills.length === 0) {
        error('No skills found in CLI installation.');
        return;
      }

      const skipInteractive = parameters.options.y || parameters.options.yes || parameters.options['no-interactive'];

      // Check for and cleanup legacy skill directories before installation
      await cleanupLegacySkills(filesystem, info, prompt, skipInteractive);

      let skillsToInstall: string[] = [];

      // Check if specific skills provided as parameters
      if (parameters.first && parameters.first !== 'all') {
        // Non-interactive mode: install specific skill(s)
        const requestedSkills = parameters.array || [parameters.first];

        // Validate requested skills
        const invalidSkills = requestedSkills.filter(s => !availableSkills.includes(s));
        if (invalidSkills.length > 0) {
          error(`Invalid skill(s): ${invalidSkills.join(', ')}`);
          info('');
          info('Available skills:');
          availableSkills.forEach(s => {
            const desc = getSkillDescription(join(claudeSkillsDir, s), filesystem);
            info(`  • ${s}`);
            info(`    ${desc}`);
          });
          return;
        }

        skillsToInstall = requestedSkills;
      } else if (parameters.first === 'all' || skipInteractive) {
        // Install all skills without prompting
        skillsToInstall = availableSkills;
        if (skipInteractive) {
          info('Installing all skills (non-interactive mode)...');
        }
      } else {
        // Interactive mode: ask for each skill individually
        info('');
        info('Available skills:');
        info('');

        // Show all available skills with descriptions
        availableSkills.forEach(skill => {
          const desc = getSkillDescription(join(claudeSkillsDir, skill), filesystem);
          info(`  • ${skill}`);
          info(`    ${desc.substring(0, 100)}${desc.length > 100 ? '...' : ''}`);
          info('');
        });

        // Ask if user wants to install all or select individually
        const installAll = await prompt.confirm('Install all skills?', true);

        if (installAll) {
          skillsToInstall = availableSkills;
        } else {
          // Ask for each skill
          info('');
          info('Select which skills to install:');
          info('');

          for (const skill of availableSkills) {
            const shouldInstall = await prompt.confirm(`Install ${skill}?`, true);
            if (shouldInstall) {
              skillsToInstall.push(skill);
            }
          }

          if (skillsToInstall.length === 0) {
            info('No skills selected. Installation cancelled.');
            return;
          }
        }
      }

      const installSpinner = spin(`Installing ${skillsToInstall.length} skill(s)...`);

      let totalCopied = 0;
      let totalSkipped = 0;
      let totalUpdated = 0;
      const allSkippedFiles: Array<{ file: string; reason: string }> = [];

      // Install each skill
      for (const skill of skillsToInstall) {
        const result = await installSingleSkill(skill, cliRoot, filesystem, info, error);

        if (!result.success) {
          continue;
        }

        totalCopied += result.copiedCount;
        totalSkipped += result.skippedCount;
        totalUpdated += result.updatedCount;
        allSkippedFiles.push(...result.skippedFiles);
      }

      if (totalCopied === 0 && totalSkipped === 0) {
        installSpinner.fail();
        error('No skill files were found.');
        return;
      }

      if (totalCopied === 0 && totalSkipped > 0) {
        installSpinner.succeed('All selected skills are already up to date!');
        info('');
        info(`Skipped: ${totalSkipped} file(s) across ${skillsToInstall.length} skill(s)`);
        info(`Location: ${join(homedir(), '.claude', 'skills')}`);
        return;
      }

      installSpinner.succeed(`Successfully installed ${skillsToInstall.length} skill(s) to ~/.claude/skills/`);
      info('');

      if (totalUpdated > 0 && totalSkipped > 0) {
        success(`Updated ${totalUpdated} file(s), skipped ${totalSkipped} file(s)`);
      } else if (totalUpdated > 0) {
        success(`Updated ${totalUpdated} file(s)`);
      } else {
        success(`Created ${totalCopied} file(s)`);
      }

      info('');
      info('Installed skills:');
      skillsToInstall.forEach(s => {
        const desc = getSkillDescription(join(claudeSkillsDir, s), filesystem);
        info(`  • ${s}`);
        info(`    ${desc.substring(0, 100)}${desc.length > 100 ? '...' : ''}`);
      });

      info('');
      info('These skills are now available in Claude Code!');
      info('Claude will automatically use them when appropriate.');
      info('');
      info('Examples:');
      if (skillsToInstall.includes('using-lt-cli')) {
        info('  • "Checkout branch DEV-123"');
      }
      if (skillsToInstall.includes('generating-nest-servers')) {
        info('  • "Create a User module with email and username"');
        info('  • "Generate the complete server structure from this specification"');
      }
      info('');
      info(`Location: ${join(homedir(), '.claude', 'skills')}`);

      if (totalSkipped > 0) {
        info('');
        info(`Note: ${totalSkipped} file(s) were skipped because your local versions are newer:`);
        allSkippedFiles.forEach(({ file, reason }) => {
          info(`  • ${file} (${reason})`);
        });
        info('');
        info('To force update, manually delete the files and run this command again.');
      }

      // Ask about setting up permissions
      info('');
      const setupPermissions = skipInteractive ? true : await prompt.confirm(
        'Set up global permissions for these skills? (Recommended - auto-approves skill-related commands)',
        true
      );

      if (setupPermissions) {
        const permissionsResult = await setupSkillPermissions(skillsToInstall, filesystem, error);
        if (permissionsResult.success) {
          info('');
          success('Permissions configured successfully!');
          if (permissionsResult.added.length > 0) {
            info('Added permissions:');
            permissionsResult.added.forEach(perm => {
              info(`  • ${perm}`);
            });
          }
          if (permissionsResult.existing.length > 0) {
            info('Already configured:');
            permissionsResult.existing.forEach(perm => {
              info(`  • ${perm}`);
            });
          }
          info('');
          info('Location: ~/.claude/settings.json');
        } else if (permissionsResult.error) {
          info('');
          info('⚠ Could not automatically configure permissions.');
          info('You can manually add these to ~/.claude/settings.json:');
          info('');
          info(JSON.stringify({
            permissions: {
              allow: permissionsResult.requested
            }
          }, null, 2));
        }
      }

      // Ask about setting up project detection hook for generating-nest-servers
      if (skillsToInstall.includes('generating-nest-servers')) {
        info('');
        const setupHook = skipInteractive ? false : await prompt.confirm(
          'Set up automatic project detection for @lenne.tech/nest-server? (Recommended - suggests generating-nest-servers skill when detected)',
          false
        );

        if (setupHook) {
          const hookResult = await setupProjectDetectionHook(filesystem, info, error, prompt.ask, skipInteractive);
          if (hookResult.success) {
            if (hookResult.added) {
              info('');
              success('Project detection hook configured successfully!');
              info('');
              info(`Scope: ${hookResult.scope === 'global' ? 'Global (all projects)' : 'Project-specific'}`);
              info('');
              info('How it works:');
              info('  • Detects @lenne.tech/nest-server in package.json');
              info('  • Supports monorepos: searches projects/*, packages/*, apps/* directories');
              info('  • Suggests using generating-nest-servers skill for NestJS tasks');
              info('  • Works from any directory in the project');
              info('');
              info(`Location: ${hookResult.scope === 'global' ? '~/.claude/settings.json' : '.claude/settings.json'}`);
            } else if (hookResult.alreadyExists) {
              info('');
              info('✓ Project detection hook already configured');
              info(`  Scope: ${hookResult.scope === 'global' ? 'Global' : 'Project-specific'}`);
            }
          } else if (hookResult.error) {
            info('');
            info('⚠ Could not automatically configure project detection hook.');
            info('You can manually add this hook to your settings.json');
          }
        }
      }

    } catch (err) {
      error(`Failed to install skill(s): ${err.message}`);
      info('');
      info('Troubleshooting:');
      info('  • Ensure ~/.claude directory exists and is writable');
      info('  • Check file permissions');
      info('  • Try running with sudo if permission issues persist');
      // NOTE: Using return instead of process.exit() here because error can occur
      // before any prompts, and we want to let the process clean up naturally
      return;
    }

    // NOTE: This command ends naturally without process.exit() because it has additional
    // prompts at the end (setupPermissions and setupHook) that properly close the readline
    // stream. If you create a new install command without such trailing prompts, you MUST
    // call process.exit(0) explicitly, otherwise the process will hang indefinitely.
    // See install-commands.ts for an example.
    return `claude install-skills`;
  },
};

export default NewCommand;
