import { GluegunFilesystem } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * API Mode processing for nest-server-starter template
 *
 * Reads the api-mode.manifest.json from the project and processes it
 * based on the selected API mode (Rest, GraphQL, Both).
 */
export class ApiMode {
  filesystem: GluegunFilesystem;

  constructor(protected toolbox: ExtendedGluegunToolbox) {
    this.filesystem = toolbox.filesystem;
  }

  /**
   * Process the API mode for a project
   *
   * @param projectPath - Path to the project root
   * @param mode - Selected API mode
   */
  async processApiMode(projectPath: string, mode: 'Both' | 'GraphQL' | 'Rest'): Promise<void> {
    const manifestPath = join(projectPath, 'api-mode.manifest.json');

    // Read manifest
    const manifestContent = this.filesystem.read(manifestPath);
    if (!manifestContent) {
      return; // No manifest = nothing to do
    }

    const manifest = JSON.parse(manifestContent);

    if (mode === 'Both') {
      // Both mode: just remove markers and cleanup
      this.stripAllMarkers(projectPath);
    } else if (mode === 'Rest') {
      // REST mode: remove graphql regions, keep rest regions
      await this.removeMode(projectPath, manifest, 'graphql', 'rest');
      await this.modifyConfigEnvForRest(projectPath);
    } else if (mode === 'GraphQL') {
      // GraphQL mode: remove rest regions, keep graphql regions
      await this.removeMode(projectPath, manifest, 'rest', 'graphql');
    }

    // Remove manifest and strip-markers script
    this.filesystem.remove(manifestPath);
    this.filesystem.remove(join(projectPath, 'scripts', 'strip-api-mode-markers.mjs'));

    // Remove strip-markers script from package.json
    this.removeScriptFromPackageJson(projectPath, 'strip-markers');
  }

  /**
   * Remove a specific mode from the project
   */
  private async removeMode(
    projectPath: string,
    manifest: any,
    removeMarker: string,
    keepMarker: string,
  ): Promise<void> {
    const modeConfig = manifest.modes[removeMarker];
    if (!modeConfig) {
      return;
    }

    // 1. Delete files matching filePatterns
    if (modeConfig.filePatterns) {
      for (const pattern of modeConfig.filePatterns) {
        const matches = this.filesystem.find(projectPath, {
          matching: pattern,
        });
        for (const file of matches) {
          this.filesystem.remove(file);
        }
      }
    }

    // 2. Remove packages from package.json
    const pkgPath = join(projectPath, 'package.json');
    const pkg = JSON.parse(this.filesystem.read(pkgPath));

    if (modeConfig.packages) {
      for (const p of modeConfig.packages) {
        delete pkg.dependencies?.[p];
      }
    }
    if (modeConfig.devPackages) {
      for (const p of modeConfig.devPackages) {
        delete pkg.devDependencies?.[p];
      }
    }

    // 3. Remove scripts
    if (modeConfig.scripts) {
      for (const s of modeConfig.scripts) {
        delete pkg.scripts?.[s];
      }
    }

    // 4. Edit scripts (e.g. remove parts from a script value)
    if (modeConfig.scriptEdits && pkg.scripts) {
      for (const [scriptName, edit] of Object.entries(modeConfig.scriptEdits)) {
        if (pkg.scripts[scriptName] && (edit as any).remove) {
          pkg.scripts[scriptName] = pkg.scripts[scriptName].replace((edit as any).remove, '');
        }
      }
    }

    this.filesystem.write(pkgPath, pkg, { jsonIndent: 2 });

    // 5. Strip regions from source files
    this.stripRegions(projectPath, removeMarker, keepMarker);

    // 6. Clean orphan imports
    this.cleanOrphanImports(projectPath);
  }

  /**
   * Strip region markers from all .ts files
   *
   * For removeMarker: delete marker lines AND content between them
   * For keepMarker: delete only the marker lines, keep content
   */
  private stripRegions(projectPath: string, removeMarker: string, keepMarker: string): void {
    const dirs = [join(projectPath, 'src'), join(projectPath, 'tests')];

    for (const dir of dirs) {
      if (!this.filesystem.exists(dir)) {
        continue;
      }

      const files = this.filesystem.find(dir, { matching: '**/*.ts' });
      for (const file of files) {
        const content = this.filesystem.read(file);
        if (!content) {
          continue;
        }

        const processed = this.processFileRegions(content, removeMarker, keepMarker);
        if (processed !== content) {
          this.filesystem.write(file, processed);
        }
      }
    }
  }

  /**
   * Process region markers in file content
   */
  private processFileRegions(content: string, removeMarker: string, keepMarker: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let removing = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for region start
      if (trimmed === `// #region ${removeMarker}`) {
        removing = true;
        continue; // Skip the marker line
      }

      // Check for region end
      if (trimmed === `// #endregion ${removeMarker}`) {
        removing = false;
        continue; // Skip the marker line
      }

      // Check for keep markers (just remove the marker lines, keep content)
      if (trimmed === `// #region ${keepMarker}` || trimmed === `// #endregion ${keepMarker}`) {
        continue; // Skip marker line, content between them is kept naturally
      }

      // Skip content inside remove region
      if (removing) {
        continue;
      }

      result.push(line);
    }

    // Clean up multiple consecutive blank lines (max 1)
    return this.collapseBlankLines(result.join('\n'));
  }

  /**
   * Strip ALL markers (for Both mode) - keep all content
   */
  private stripAllMarkers(projectPath: string): void {
    const dirs = [join(projectPath, 'src'), join(projectPath, 'tests')];

    for (const dir of dirs) {
      if (!this.filesystem.exists(dir)) {
        continue;
      }

      const files = this.filesystem.find(dir, { matching: '**/*.ts' });
      for (const file of files) {
        const content = this.filesystem.read(file);
        if (!content) {
          continue;
        }

        const lines = content.split('\n');
        const filtered = lines.filter((line) => {
          const trimmed = line.trim();
          return !trimmed.match(/^\/\/ #(region|endregion)\s/);
        });

        const processed = filtered.join('\n');
        if (processed !== content) {
          this.filesystem.write(file, processed);
        }
      }
    }
  }

  /**
   * Modify config.env.ts for REST mode using ts-morph AST manipulation
   *
   * - Replace `graphQl: { ... }` blocks with `graphQl: false`
   * - Remove `execAfterInit` properties
   */
  private async modifyConfigEnvForRest(projectPath: string): Promise<void> {
    const configPath = join(projectPath, 'src', 'config.env.ts');
    if (!this.filesystem.exists(configPath)) {
      return;
    }

    try {
      const { Project, SyntaxKind } = require('ts-morph');
      const project = new Project({ skipAddingFilesFromTsConfig: true });
      const sourceFile = project.addSourceFileAtPath(configPath);

      // Find the 'config' variable declaration directly
      // Structure: export const config: { [env: string]: ... } = { ci: { ... }, develop: { ... }, ... };
      let configObj: any;

      const variableStatements = sourceFile.getVariableStatements();
      for (const vs of variableStatements) {
        for (const decl of vs.getDeclarations()) {
          if (decl.getName() === 'config') {
            const init = decl.getInitializer();
            if (init?.getKind() === SyntaxKind.ObjectLiteralExpression) {
              configObj = init;
            }
          }
          // Handle merge() call: const config = merge({ default: ... }, { local: ... }, ...)
          if (!configObj) {
            const init = decl.getInitializer();
            if (init?.getKind() === SyntaxKind.CallExpression) {
              const args = init.getArguments?.();
              if (args) {
                for (const arg of args) {
                  if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
                    this.processConfigObject(arg, SyntaxKind);
                  }
                }
              }
            }
          }
        }
      }

      if (configObj) {
        this.processConfigObject(configObj, SyntaxKind);
      }

      sourceFile.saveSync();
    } catch {
      // If ts-morph is not available or fails, fall back to regex
      this.modifyConfigEnvForRestFallback(projectPath);
    }
  }

  /**
   * Process a config object literal: replace graphQl and remove execAfterInit
   */
  private processConfigObject(obj: any, SyntaxKind: any): void {
    // Process all nested object literals (environment configs)
    const properties = obj.getProperties();

    for (const prop of properties) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) {
        continue;
      }

      const name = prop.getName();

      // Replace graphQl: { ... } with graphQl: false
      if (name === 'graphQl') {
        const init = prop.getInitializer();
        if (init && init.getKind() === SyntaxKind.ObjectLiteralExpression) {
          prop.setInitializer('false');
        }
        continue;
      }

      // Remove execAfterInit
      if (name === 'execAfterInit') {
        prop.remove();
        continue;
      }

      // Recurse into nested objects (environment configs like default, local, etc.)
      const init = prop.getInitializer();
      if (init?.getKind() === SyntaxKind.ObjectLiteralExpression) {
        this.processConfigObject(init, SyntaxKind);
      }
    }
  }

  /**
   * Fallback: Regex-based config.env.ts modification
   */
  private modifyConfigEnvForRestFallback(projectPath: string): void {
    const configPath = join(projectPath, 'src', 'config.env.ts');
    let content = this.filesystem.read(configPath);
    if (!content) {
      return;
    }

    // Replace graphQl: { ... } blocks with graphQl: false
    // Match graphQl: { ... }, handling nested braces
    content = content.replace(/graphQl:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\},?/g, 'graphQl: false,');

    // Remove execAfterInit lines
    content = content.replace(/\s*execAfterInit:.*,?\n/g, '\n');

    this.filesystem.write(configPath, content);
  }

  /**
   * Clean orphan imports after region stripping
   *
   * After removing region content, some imports may reference identifiers
   * that no longer exist in the file. This removes those imports.
   */
  private cleanOrphanImports(projectPath: string): void {
    const dirs = [join(projectPath, 'src')];

    for (const dir of dirs) {
      if (!this.filesystem.exists(dir)) {
        continue;
      }

      const files = this.filesystem.find(dir, { matching: '**/*.ts' });
      for (const file of files) {
        const content = this.filesystem.read(file);
        if (!content) {
          continue;
        }

        const cleaned = this.removeUnusedImports(content);
        if (cleaned !== content) {
          this.filesystem.write(file, cleaned);
        }
      }
    }
  }

  /**
   * Remove unused imports from TypeScript file content
   */
  private removeUnusedImports(content: string): string {
    const lines = content.split('\n');
    const importLines: { end: number; imports: { original: string; resolved: string }[]; start: number }[] = [];

    // Parse import statements
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const singleImportMatch = line.match(/^import\s+\{([^}]+)\}\s+from\s+['"]/);
      const multiImportStart = line.match(/^import\s+\{$/);

      if (singleImportMatch) {
        const imports = singleImportMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => ({ original: s, resolved: this.resolveImportAlias(s) }));
        importLines.push({ end: i, imports, start: i });
      } else if (multiImportStart) {
        // Multi-line import
        const start = i;
        const imports: { original: string; resolved: string }[] = [];
        i++;
        while (i < lines.length && !lines[i].match(/^\}\s+from\s+['"]/)) {
          const raw = lines[i].replace(/,?\s*$/, '').trim();
          if (raw) {
            imports.push({ original: raw, resolved: this.resolveImportAlias(raw) });
          }
          i++;
        }
        importLines.push({ end: i, imports, start });
      }
      i++;
    }

    // Get the non-import part of the file
    const maxImportEnd = importLines.reduce((max, il) => Math.max(max, il.end), -1);
    const codeContent = lines.slice(maxImportEnd + 1).join('\n');

    // Check each import
    const linesToRemove = new Set<number>();
    for (const imp of importLines) {
      const usedImports = imp.imports.filter(({ resolved }) => {
        // Check if resolved identifier is used in code (not in imports)
        const regex = new RegExp(`\\b${resolved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        return regex.test(codeContent);
      });

      if (usedImports.length === 0) {
        // Remove entire import
        for (let j = imp.start; j <= imp.end; j++) {
          linesToRemove.add(j);
        }
      } else if (usedImports.length < imp.imports.length) {
        // Rebuild import with only used identifiers (using original text for aliases)
        const fromMatch = lines[imp.end].match(/from\s+['"].*['"]/);
        const fromClause = fromMatch ? fromMatch[0] : '';

        if (fromClause) {
          // Remove old lines
          for (let j = imp.start; j <= imp.end; j++) {
            linesToRemove.add(j);
          }

          const originals = usedImports.map((ui) => ui.original);
          // Add rebuilt import at start position
          if (originals.length <= 3) {
            lines[imp.start] = `import { ${originals.join(', ')} } ${fromClause};`;
            linesToRemove.delete(imp.start);
          } else {
            // Multi-line for many imports
            lines[imp.start] = `import {\n  ${originals.join(',\n  ')},\n} ${fromClause};`;
            linesToRemove.delete(imp.start);
          }
        }
      }
    }

    // Remove marked lines
    const result = lines.filter((_, idx) => !linesToRemove.has(idx));
    return this.collapseBlankLines(result.join('\n'));
  }

  /**
   * Resolve import alias: "Schema as MongooseSchema" -> "MongooseSchema"
   * For non-aliased imports, returns the identifier as-is.
   */
  private resolveImportAlias(identifier: string): string {
    const asMatch = identifier.match(/^\S+\s+as\s+(\S+)$/);
    return asMatch ? asMatch[1] : identifier;
  }

  /**
   * Collapse multiple consecutive blank lines into at most one
   */
  private collapseBlankLines(content: string): string {
    return content.replace(/\n{3,}/g, '\n\n');
  }

  /**
   * Remove a script from package.json
   */
  private removeScriptFromPackageJson(projectPath: string, scriptName: string): void {
    const pkgPath = join(projectPath, 'package.json');
    const pkg = JSON.parse(this.filesystem.read(pkgPath));
    if (pkg.scripts?.[scriptName]) {
      delete pkg.scripts[scriptName];
      this.filesystem.write(pkgPath, pkg, { jsonIndent: 2 });
    }
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.apiMode = new ApiMode(toolbox);
};
