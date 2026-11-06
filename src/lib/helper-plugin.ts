/**
 * Location of the `@lenne.tech/cli-plugin-helper` gluegun plugin (`toolbox.helper`).
 *
 * `cli.ts` used to load it from `<cli>/node_modules/@lenne.tech/cli-plugin-helper/dist`. That
 * path exists only when npm nests the dependency inside the CLI's own folder, as a global
 * install (`npm i -g`) does. `npx -p @lenne.tech/cli` installs flat: the plugin sits NEXT to the
 * CLI, gluegun skipped the missing directory without a word, and every command that reached
 * `toolbox.helper` died with "Cannot read properties of undefined". `lt fullstack init` did so on
 * its last line, after a complete workspace, and exited 1.
 */
import { dirname, join } from 'path';

/**
 * The plugin's `dist` directory, found the way `require` finds the package (walking up the
 * `node_modules` directories from `fromDir`), so a nested and a flat install both work.
 * @param fromDir - Directory to resolve from (`cli.ts`: its own `__dirname`)
 * @param resolve - `require.resolve` (tests)
 * @returns The `dist` directory, or the former nested path when the package cannot be resolved
 */
export function helperPluginDir(
  fromDir: string,
  resolve: (request: string, options: { paths: string[] }) => string = require.resolve,
): string {
  try {
    return join(dirname(resolve('@lenne.tech/cli-plugin-helper/package.json', { paths: [fromDir] })), 'dist');
  } catch {
    return join(fromDir, '..', 'node_modules', '@lenne.tech', 'cli-plugin-helper', 'dist');
  }
}
