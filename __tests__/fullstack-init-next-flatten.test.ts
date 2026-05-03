/**
 * `lt fullstack init --next` clones `lenneTech/nuxt-base-starter` into
 * `projects/app/`, but the actual Nuxt app lives one level deeper at
 * `projects/app/nuxt-base-template/`. The repo's root `package.json`
 * is the npm scaffolder `create-nuxt-base` (a wrapper CLI), not the
 * app, so `cd projects/app && pnpm install && pnpm dev` (per the
 * generated README) does not work — the friction-author had to use
 * `cd projects/app/nuxt-base-template && pnpm install --ignore-workspace
 * && pnpm dev` (LLM-test 2026-05-03 friction #3 entry 20:30).
 *
 * After cloning, the CLI flattens the layout so `projects/app/` IS
 * the Nuxt app:
 *
 *   1. If `projects/app/nuxt-base-template/` exists, its contents
 *      (including dotfiles like `.env.example`, `.gitignore`) replace
 *      the cloned root.
 *   2. Wrapper-only files at the root (the scaffolder `package.json`
 *      with `name: "create-nuxt-base"`, `index.js`, `pnpm-lock.yaml`,
 *      etc.) disappear.
 *   3. The `nuxt-base-template/` subdirectory itself is removed.
 *
 * Defense-in-depth: if extraction fails (e.g. `nuxt-base-template/`
 * isn't a directory), `projects/app/` stays untouched. The pre-flatten
 * layout is annoying but functional — better than wiping the user's
 * clone when a future repo reshape removes the wrapper.
 *
 * Both branches of `nuxt-base-starter` (`main` and `next`) currently
 * ship the wrapper layout, so this fix applies to both `--next` and
 * the legacy default-branch path. We name the test file after `--next`
 * because that's the friction surface that prompted the change.
 */

const { filesystem } = require('gluegun');

describe('Fullstack init nuxt-base-template flatten', () => {
  let tempDir: string;

  beforeEach(() => {
    // Each test gets its own temp dir to mirror the post-clone state.
    tempDir = filesystem.path('__tests__', `temp-flatten-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    filesystem.remove(tempDir);
  });

  /**
   * Build a fixture that mirrors `git clone nuxt-base-starter` output:
   * scaffolder package.json + index.js + pnpm-lock.yaml at the root,
   * plus the actual Nuxt app under `nuxt-base-template/`.
   */
  function seedClonedLayout(dest: string): void {
    filesystem.dir(dest);

    // Wrapper / scaffolder files at the cloned root — these must be
    // removed by the flatten so the Nuxt app's own files surface.
    filesystem.write(filesystem.path(dest, 'package.json'), {
      name: 'create-nuxt-base',
      version: '2.6.7',
      bin: { 'create-nuxt-base': 'index.js' },
    });
    filesystem.write(filesystem.path(dest, 'index.js'), '#!/usr/bin/env node\n// scaffolder\n');
    filesystem.write(filesystem.path(dest, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    filesystem.write(filesystem.path(dest, 'README.md'), '# create-nuxt-base wrapper\n');

    // The actual Nuxt app, including a dotfile to verify hidden-file
    // movement works (gluegun copy / fs.cp behaviour varies).
    const tmplDir = filesystem.path(dest, 'nuxt-base-template');
    filesystem.dir(tmplDir);
    filesystem.write(filesystem.path(tmplDir, 'package.json'), {
      name: 'nuxt-base-template',
      private: true,
      type: 'module',
    });
    filesystem.write(filesystem.path(tmplDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n');
    filesystem.write(filesystem.path(tmplDir, '.env.example'), 'NUXT_PUBLIC_API_URL=http://localhost:3000\n');
    filesystem.write(filesystem.path(tmplDir, '.gitignore'), 'node_modules\n.nuxt\n');
    filesystem.dir(filesystem.path(tmplDir, 'app'));
    filesystem.write(filesystem.path(tmplDir, 'app', 'app.vue'), '<template><div>app</div></template>\n');
  }

  /**
   * Lazy import of FrontendHelper so the test file doesn't pay the
   * cost of loading every extension at module-eval time, and so a
   * `tsc --noEmit` of the test suite doesn't pick up the helper's
   * full toolbox-shaped surface.
   */
  function loadFrontendHelper(): {
    FrontendHelper: new (toolbox: Record<string, unknown>) => {
      flattenNuxtBaseTemplate: (dest: string) => Promise<{ flattened: boolean; reason?: string }>;
    };
  } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../src/extensions/frontend-helper');
  }

  /**
   * Minimal toolbox stub — flatten only needs filesystem + a quiet
   * print surface for diagnostics. We re-use gluegun's real filesystem
   * so the test exercises the same path-handling the CLI does.
   */
  function makeToolbox(): Record<string, unknown> {
    return {
      filesystem,
      print: { error: () => {}, info: () => {}, warning: () => {} },
    };
  }

  test('flattens nuxt-base-template/ contents into the project app dir', async () => {
    const dest = filesystem.path(tempDir, 'projects', 'app');
    seedClonedLayout(dest);

    const { FrontendHelper } = loadFrontendHelper();
    const helper = new FrontendHelper(makeToolbox());

    const result = await helper.flattenNuxtBaseTemplate(dest);

    expect(result.flattened).toBe(true);

    // The wrapper sub-dir is gone …
    expect(filesystem.exists(filesystem.path(dest, 'nuxt-base-template'))).toBe(false);

    // … and the template's package.json is now at the project root,
    // overwriting the scaffolder's `create-nuxt-base` package.
    const pkg = filesystem.read(filesystem.path(dest, 'package.json'), 'json');
    expect(pkg.name).toBe('nuxt-base-template');

    // Nested files survive the move.
    expect(filesystem.read(filesystem.path(dest, 'app', 'app.vue'))).toContain('<template>');

    // Dotfiles (commonly missed by naive copy implementations) survive too.
    expect(filesystem.read(filesystem.path(dest, '.env.example'))).toContain('NUXT_PUBLIC_API_URL');
    expect(filesystem.read(filesystem.path(dest, '.gitignore'))).toContain('node_modules');

    // Wrapper-only files that aren't in the template are gone.
    expect(filesystem.exists(filesystem.path(dest, 'index.js'))).toBe(false);
    expect(filesystem.exists(filesystem.path(dest, 'pnpm-lock.yaml'))).toBe(false);
  });

  test('is a no-op when nuxt-base-template/ does not exist', async () => {
    // Already-flat layouts (older starters, manually flattened repos,
    // or future reshapes) must round-trip untouched.
    const dest = filesystem.path(tempDir, 'projects', 'app');
    filesystem.dir(dest);
    filesystem.write(filesystem.path(dest, 'package.json'), { name: 'already-flat' });
    filesystem.write(filesystem.path(dest, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n');

    const { FrontendHelper } = loadFrontendHelper();
    const helper = new FrontendHelper(makeToolbox());

    const result = await helper.flattenNuxtBaseTemplate(dest);

    expect(result.flattened).toBe(false);
    expect(result.reason).toMatch(/no.*subdirectory/i);

    // Layout is unchanged — `package.json` still has the original name.
    const pkg = filesystem.read(filesystem.path(dest, 'package.json'), 'json');
    expect(pkg.name).toBe('already-flat');
    // gluegun's `filesystem.exists` returns the type ('file' / 'dir')
    // when the path exists, not a strict boolean.
    expect(filesystem.exists(filesystem.path(dest, 'nuxt.config.ts'))).toBe('file');
  });

  test('leaves the original layout intact when the subdir is a file, not a directory', async () => {
    // Defense-in-depth: if `nuxt-base-template` somehow exists but
    // isn't a directory (corrupt clone, name collision in a future
    // repo reshape), we must NOT wipe `projects/app/`.
    const dest = filesystem.path(tempDir, 'projects', 'app');
    filesystem.dir(dest);
    filesystem.write(filesystem.path(dest, 'package.json'), { name: 'create-nuxt-base' });
    filesystem.write(filesystem.path(dest, 'nuxt-base-template'), 'this is a stray file\n');

    const { FrontendHelper } = loadFrontendHelper();
    const helper = new FrontendHelper(makeToolbox());

    const result = await helper.flattenNuxtBaseTemplate(dest);

    expect(result.flattened).toBe(false);
    // The pre-flatten layout is annoying but functional — better than
    // wiping a user's clone when something unexpected is in the way.
    const pkg = filesystem.read(filesystem.path(dest, 'package.json'), 'json');
    expect(pkg.name).toBe('create-nuxt-base');
    // The stray file is preserved as-is (gluegun returns 'file' for the
    // type, not a boolean).
    expect(filesystem.exists(filesystem.path(dest, 'nuxt-base-template'))).toBe('file');
  });

  test('setupNuxt invokes the flatten after a successful clone', () => {
    // Source-introspection guard: a future refactor could quietly
    // drop the flatten call from setupNuxt. The friction is invisible
    // until a user runs `pnpm dev`, so we pin it via the source.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const helperSource: string = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extensions', 'frontend-helper.ts'),
      'utf8',
    );

    // The setupNuxt method must call flattenNuxtBaseTemplate.
    const setupNuxtBlock = helperSource.match(/public async setupNuxt[\s\S]*?\n  \}/);
    expect(setupNuxtBlock).not.toBeNull();
    expect(setupNuxtBlock![0]).toMatch(/flattenNuxtBaseTemplate/);

    // And it must only run on clone (not on link — a symlink to the
    // user's local checkout must not have its template subdir torn out).
    expect(setupNuxtBlock![0]).toMatch(/method\s*===?\s*'clone'/);
  });
});
