import { Node, SourceFile, SyntaxKind } from 'ts-morph';

import { toCoreLoaderCommand } from './dev-start-loader';

/**
 * The configuration side of an ES module conversion (nest-server migration guide 11.43.x →
 * 12.0.x, §17 steps 1 and 8, and "Tests: vitest must resolve like Node").
 *
 * JSON files are edited with jsonc-parser, so comments and the formatting a project's formatter
 * gave them survive: the starter's tsconfigs carry both, and a trailing comma. jsonc-parser is
 * required lazily, because gluegun loads every command module on every `lt` run.
 */

/** The framework loader as an npm-mode project names it (migration guide §14). */
export const NPM_CORE_LOADER =
  './node_modules/@lenne.tech/nest-server/dist/core/modules/migrate/helpers/ts-compiler.js';

/** Resolution order vitest needs so graphql is loaded once (see the guide's vitest section). */
export const VITEST_NODE_EXTENSIONS = ['.js', '.mjs', '.mts', '.ts', '.jsx', '.tsx', '.json'];

/**
 * `module` / `moduleResolution: nodenext` and `isolatedModules: true` in a tsconfig. A config
 * that only extends another one and sets neither key is left alone (it inherits the change); a
 * config that sets its own `module` or `moduleResolution` gets both, so it cannot keep a
 * CommonJS value the base no longer has. `isolatedModules` goes into the root config only
 * (`isRoot`), where it reaches every build.
 */
export function convertTsconfigToNodeNext(tsconfig: string, isRoot: boolean): string | undefined {
  const { applyEdits, modify, parse } = jsoncParser();
  const options = parse(tsconfig)?.compilerOptions ?? {};
  const wanted: [string, boolean | string][] = [];
  const setsModule = 'module' in options || 'moduleResolution' in options;
  if (isRoot || setsModule) {
    if (String(options.module).toLowerCase() !== 'nodenext') wanted.push(['module', 'nodenext']);
    if (String(options.moduleResolution).toLowerCase() !== 'nodenext') wanted.push(['moduleResolution', 'nodenext']);
  }
  if (isRoot && options.isolatedModules !== true) wanted.push(['isolatedModules', true]);
  if (wanted.length === 0) return undefined;
  let text = tsconfig;
  for (const [key, value] of wanted) {
    text = applyEdits(text, modify(text, ['compilerOptions', key], value, { formattingOptions: formatting(text) }));
  }
  return text;
}

/**
 * Add `resolve.extensions` to a vitest config's `defineConfig({ … })` when it is missing.
 * Returns what happened; `'unrecognised'` means the config has a shape the conversion does not
 * edit, and the caller reports it.
 */
export function ensureVitestNodeResolution(config: SourceFile): 'added' | 'present' | 'unrecognised' {
  const call = config
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((candidate) => candidate.getExpression().getText() === 'defineConfig');
  const options = call?.getArguments()[0];
  if (!options || !Node.isObjectLiteralExpression(options)) return 'unrecognised';
  const extensions = `extensions: [${VITEST_NODE_EXTENSIONS.map((extension) => `'${extension}'`).join(', ')}]`;
  const resolveProperty = options.getProperty('resolve');
  if (!resolveProperty) {
    options.addPropertyAssignment({ initializer: `{ ${extensions} }`, name: 'resolve' });
    return 'added';
  }
  if (!Node.isPropertyAssignment(resolveProperty)) return 'unrecognised';
  const value = resolveProperty.getInitializer();
  if (!value || !Node.isObjectLiteralExpression(value)) return 'unrecognised';
  if (value.getProperty('extensions')) return 'present';
  value.addPropertyAssignment({
    initializer: `[${VITEST_NODE_EXTENSIONS.map((extension) => `'${extension}'`).join(', ')}]`,
    name: 'extensions',
  });
  return 'added';
}

/**
 * `"type": "module"` in package.json. Returns `undefined` when it is already set. An explicit
 * `"type": "commonjs"` is switched (that is what the conversion is for); any other value is not
 * a module format the conversion knows, so it throws instead of overwriting it.
 */
export function setPackageTypeModule(packageJson: string): string | undefined {
  const { applyEdits, modify, parse } = jsoncParser();
  const parsed = parse(packageJson);
  if (parsed?.type === 'module') return undefined;
  if (parsed?.type && parsed.type !== 'commonjs') {
    throw new Error(`package.json has "type": ${JSON.stringify(parsed.type)}, which is neither module nor commonjs`);
  }
  return applyEdits(
    packageJson,
    modify(packageJson, ['type'], 'module', { formattingOptions: formatting(packageJson) }),
  );
}

/**
 * A dev or script command for an ES module project: ts-node goes (it cannot run ESM with `.js`
 * specifiers), the framework loader comes in, and `-r tsconfig-paths/register` goes too, because
 * a CommonJS require hook never sees an ES module's imports. Reports what it could not convert.
 */
export function toEsmCommand(command: string, loader: string): { command: string; unconverted: string[] } {
  const converted = toCoreLoaderCommand(command, loader);
  return {
    command: converted.command.replace(/\s+(?:-r|--require)\s+tsconfig-paths\/register(?=\s|$)/g, ''),
    unconverted: converted.unconverted,
  };
}

/** jsonc-parser's formatting options, matched to the file's own indentation. */
function formatting(text: string): { insertSpaces: boolean; tabSize: number } {
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
  return indent.startsWith('\t') ? { insertSpaces: false, tabSize: 1 } : { insertSpaces: true, tabSize: indent.length };
}

function jsoncParser(): typeof import('jsonc-parser') {
  return require('jsonc-parser');
}
