import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { helperPluginDir } from '../src/lib/helper-plugin';

/** A package directory with a package.json and an empty `dist/index.js`. */
function seedPlugin(dir: string): void {
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ main: 'dist/index.js', name: '@lenne.tech/cli-plugin-helper' }));
  writeFileSync(join(dir, 'dist', 'index.js'), '');
}

describe('helperPluginDir', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lt-helper-plugin-')));
  });
  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  test('finds the plugin next to the CLI, as `npx -p @lenne.tech/cli` installs it', () => {
    const scope = join(root, 'node_modules', '@lenne.tech');
    const cliBuild = join(scope, 'cli', 'build');
    mkdirSync(cliBuild, { recursive: true });
    seedPlugin(join(scope, 'cli-plugin-helper'));
    expect(helperPluginDir(cliBuild)).toBe(join(scope, 'cli-plugin-helper', 'dist'));
  });

  test('finds the plugin nested in the CLI, as `npm i -g` installs it', () => {
    const cli = join(root, 'node_modules', '@lenne.tech', 'cli');
    mkdirSync(join(cli, 'build'), { recursive: true });
    seedPlugin(join(cli, 'node_modules', '@lenne.tech', 'cli-plugin-helper'));
    expect(helperPluginDir(join(cli, 'build'))).toBe(join(cli, 'node_modules', '@lenne.tech', 'cli-plugin-helper', 'dist'));
  });

  test('this checkout resolves its own dependency to a directory that exists', () => {
    expect(helperPluginDir(join(__dirname, '..', 'src'))).toBe(
      realpathSync(join(__dirname, '..', 'node_modules', '@lenne.tech', 'cli-plugin-helper', 'dist')),
    );
  });
});
