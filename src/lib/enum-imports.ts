/**
 * Imports for the enums the `lt server` generators write.
 *
 * `--prop-enum-<n> <Name>` puts the enum's name into model, input and create input
 * (`enum: { enum: Name }`, `Object.values(Name)`, the property type), and nothing imported it:
 * every such file failed `tsc` with TS2304. The enum itself is the developer's to write
 * (`src/server/common/enums/<kebab>.enum.ts`, lt-dev generating-nest-servers), so the generators
 * import a declaration they find in the project and name the ones they do not, instead of guessing
 * a path that may not exist.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { Project } from 'ts-morph';

import { ensureImportLine } from './ensure-import';

/**
 * Adds `import { <Name> } from '<relative>'` to every given file (directories are searched for
 * `.ts` files) that uses an enum the project declares and does not import it yet.
 * @param apiDir - The API project, whose `src/` holds the declarations
 * @param paths - The generated files or directories
 * @param enumNames - The enum names the generator wrote
 * @returns The names no declaration was found for, in the given order
 */
export function addEnumImports(apiDir: string, paths: string[], enumNames: string[]): string[] {
  const names = [...new Set(enumNames.filter(Boolean))];
  if (names.length === 0) return [];
  const files = paths.flatMap((p) => tsFilesIn(p));
  const missing: string[] = [];
  const project = new Project({ skipAddingFilesFromTsConfig: true });

  for (const name of names) {
    const declaration = findEnumDeclaration(apiDir, name);
    if (!declaration) {
      missing.push(name);
      continue;
    }
    const uses = new RegExp(`\\b${name}\\b`);
    for (const file of files) {
      if (file === declaration || !uses.test(readFileSync(file, 'utf8'))) continue;
      let specifier = relative(dirname(file), declaration).split(sep).join('/').replace(/\.ts$/, '');
      if (!specifier.startsWith('.')) specifier = `./${specifier}`;
      const sourceFile = project.addSourceFileAtPath(file);
      if (ensureImportLine(sourceFile, `import { ${name} } from '${specifier}';`)) sourceFile.saveSync();
    }
  }
  return missing;
}

/** Where the lt convention puts an enum: `StatusEnum` and `Status` both live in `status.enum.ts`. */
export function conventionalEnumPath(enumName: string): string {
  const kebab = enumName
    .replace(/Enum$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return `src/server/common/enums/${kebab}.enum.ts`;
}

/**
 * The enum names a generator wrote for these properties, in the form it wrote them
 * (`Server#getEnumConfig` pascal-cases `enumRef`).
 */
export function enumNamesOf(props: Iterable<{ enumRef?: string }>, pascalCase: (value: string) => string): string[] {
  return [...props].map((p) => (p.enumRef?.trim() ? pascalCase(p.enumRef.trim()) : '')).filter(Boolean);
}

/**
 * The project file that declares `export enum <Name>` (or `export const enum`), searched under
 * `src/` outside the vendored core (`src/core/` is the framework's, and a project enum of the
 * same name would shadow it anyway). The conventional path is tried first.
 * @returns The absolute path, or null when the project declares no such enum
 */
export function findEnumDeclaration(apiDir: string, enumName: string): null | string {
  const declares = new RegExp(`export\\s+(?:const\\s+)?enum\\s+${enumName}\\b`);
  const conventional = join(apiDir, conventionalEnumPath(enumName));
  if (existsSync(conventional) && declares.test(readFileSync(conventional, 'utf8'))) return conventional;

  const srcDir = join(apiDir, 'src');
  for (const file of tsFilesIn(srcDir, [join(srcDir, 'core')])) {
    if (declares.test(readFileSync(file, 'utf8'))) return file;
  }
  return null;
}

/** The warning for an enum the project does not declare yet. */
export function missingEnumHint(enumName: string): string {
  return `Enum ${enumName} is not declared under src/ yet: create it (by convention ${conventionalEnumPath(enumName)}) and import it where the generated files use it.`;
}

/** `.ts` files (no `.d.ts`) at or under `path`, skipping `node_modules` and the excluded directories. */
function tsFilesIn(path: string, exclude: string[] = []): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
  if (!stat.isDirectory() || exclude.includes(path)) return [];
  return readdirSync(path)
    .filter((entry) => entry !== 'node_modules')
    .sort()
    .flatMap((entry) => tsFilesIn(join(path, entry), exclude));
}
