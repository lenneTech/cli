import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Project } from 'ts-morph';

import { addJsExtensions } from './esm-specifiers';

/**
 * The generators (`lt server module`, `object`, `test`, `addProp`) write extensionless relative
 * imports from their templates. An ES module project (`"type": "module"`, nest-server-starter
 * after the 12.0.0 publish, or a project converted with `lt server convert-esm`) needs every one
 * of them with its emitted extension (`./x.js`, `../../../core/index.js`), or `tsc` reports TS2835
 * and Node cannot load the file. A CommonJS project keeps them extensionless: nest-server 11
 * projects run their dev server under ts-node, which cannot resolve `./x.js` (see CLAUDE.md).
 */

/**
 * Give the relative imports of `paths` (files, or directories searched recursively for `.ts`
 * files) their emitted extension, in an ES module project only. Returns the number of
 * specifiers changed; a CommonJS project returns 0 without reading anything.
 */
export function finishGeneratedImports(projectDir: string, paths: string[]): number {
  if (!isEsmProject(projectDir)) return 0;
  const files = new Set<string>();
  const collect = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) collect(join(path, entry));
    } else if (/\.[cm]?ts$/.test(path) && !path.endsWith('.d.ts')) {
      files.add(path);
    }
  };
  paths.forEach(collect);
  if (files.size === 0) return 0;

  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  let changed = 0;
  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    changed += addJsExtensions(sourceFile, existsSync).changed.length;
  }
  project.saveSync();
  return changed;
}

/** True when the project's package.json declares `"type": "module"`. */
export function isEsmProject(projectDir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).type === 'module';
  } catch {
    return false;
  }
}
