/**
 * Vendoring turns package typings into project source, and one declaration does
 * not survive the move.
 *
 * `runtime/types/module.ts` in nuxt-extensions augments `PublicRuntimeConfig`
 * under BOTH `nuxt/schema` and `@nuxt/schema`. The former re-exports the latter,
 * so those are one interface — and once the file is project source (vendor mode
 * puts it in `app/core/`, which the project's `include` picks up unconditionally)
 * it closes a cycle with Nuxt's own generated `runtime-config.d.ts`:
 *
 *     error TS2310: Type 'PublicRuntimeConfig' recursively references itself as a base type.
 *
 * An interface in that state resolves every member to `unknown`, so in every
 * vendor-mode project — the DEFAULT for `lt fullstack init` — `config.public.x`
 * stops being its declared type and `nuxt typecheck` fails on correct code.
 *
 * The reason this went unexplained for so long is that Nuxt sets
 * `skipLibCheck: true`, which suppresses TS2310 (it is reported in a `.d.ts`).
 * Only the consequence is visible, at a call site that is not wrong. Measured
 * 2026-08-22 by converting the template for real and re-running the gate with
 * `--skipLibCheck false`; a fresh conversion with this strip in place typechecks
 * with zero errors.
 *
 * What must hold:
 *   1. The PublicRuntimeConfig-only blocks go, under either module name.
 *   2. A block that declares anything else STAYS — those carry module options and
 *      hooks, have no cycle, and removing them would trade this bug for a worse one.
 *   3. Nothing outside a `declare module` block is touched.
 *   4. The removal explains itself in the file, because the next person to look is
 *      a developer in a generated project with no access to this reasoning.
 */
import { filesystem } from 'gluegun';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { stripAugmentationBlocks, stripVendorSchemaAugmentation } from '../src/lib/strip-vendor-schema-augmentation';

/**
 * The drift detector reads the real nuxt-extensions checkout. Absent siblings
 * must SKIP visibly rather than pass: this repo's CI checks out only itself, so
 * the detector was reporting `✓` without ever having run. `LT_DRIFT_STRICT=1`
 * makes absence a hard failure and belongs in the release workflow — the one
 * moment upstream drift actually matters.
 */
const UPSTREAM_MODULE = join(__dirname, '..', '..', 'nuxt-extensions', 'src', 'runtime', 'types', 'module.ts');
const itDrift = filesystem.exists(UPSTREAM_MODULE) || process.env.LT_DRIFT_STRICT === '1' ? it : it.skip;

const AUGMENTATION = [
  "declare module 'nuxt/schema' {",
  '  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}',
  '}',
  '',
  "declare module '@nuxt/schema' {",
  '  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}',
  '}',
].join('\n');

const KEEPER =
  "export interface LtExtensionsPublicRuntimeConfig {\n  ltExtensions: { auth: { enabled: boolean } };\n}\n";

describe('stripAugmentationBlocks', () => {
  it('removes the PublicRuntimeConfig augmentation under both module names', () => {
    const out = stripAugmentationBlocks(`${KEEPER}\n${AUGMENTATION}\n`);
    expect(out).not.toContain("declare module 'nuxt/schema'");
    expect(out).not.toContain("declare module '@nuxt/schema'");
  });

  it('leaves everything outside the blocks untouched', () => {
    const out = stripAugmentationBlocks(`${KEEPER}\n${AUGMENTATION}\n`);
    expect(out).toContain('export interface LtExtensionsPublicRuntimeConfig');
    expect(out).toContain('ltExtensions: { auth: { enabled: boolean } };');
  });

  it('explains itself where the block used to be', () => {
    // The audience is a developer in a generated project who has never seen
    // nuxt-extensions. Without this they read a deleted augmentation as an
    // accident and restore it.
    const out = stripAugmentationBlocks(AUGMENTATION);
    expect(out).toContain('TS2310');
    expect(out).toContain('skipLibCheck');
    expect(out).toMatch(/vendored/i);
  });

  it('keeps a block that declares more than PublicRuntimeConfig', () => {
    // Module options and hooks live in blocks like this. They have no cycle, and
    // dropping them would break the config surface outright.
    const mixed = [
      "declare module 'nuxt/schema' {",
      '  interface NuxtConfig { ltExtensions?: ModuleOptions }',
      '  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}',
      '}',
    ].join('\n');
    expect(stripAugmentationBlocks(mixed)).toBe(mixed);
  });

  it('ignores augmentations of unrelated modules', () => {
    const other = "declare module 'vue' {\n  interface PublicRuntimeConfig { a: string }\n}";
    expect(stripAugmentationBlocks(other)).toBe(other);
  });

  it('survives a block that grows extra members later', () => {
    // Pinned to the exact two lines, this would silently stop matching the day
    // upstream adds a member — reintroducing the bug with every test still green,
    // because the symptom only shows up in a generated project.
    const grown = [
      "declare module 'nuxt/schema' {",
      '  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}',
      '  interface PublicRuntimeConfig { somethingNew?: string }',
      '}',
    ].join('\n');
    expect(stripAugmentationBlocks(grown)).not.toContain('declare module');
  });

  it('leaves unbalanced source alone rather than truncating it', () => {
    const broken = "declare module 'nuxt/schema' {\n  interface PublicRuntimeConfig extends X {}\n";
    expect(stripAugmentationBlocks(broken)).toBe(broken);
  });

  it('keeps a keeper block and still strips a later one', () => {
    // Exercises the cursor path: the first block is skipped past, the second
    // rewritten. Getting this wrong either loses the keeper or stops early.
    const mixed = [
      "declare module 'nuxt/schema' {",
      '  interface NuxtConfig { ltExtensions?: ModuleOptions }',
      '}',
      '',
      AUGMENTATION,
    ].join('\n');
    const out = stripAugmentationBlocks(mixed);
    expect(out).toContain('interface NuxtConfig');
    expect(out).toContain('TS2310');
    expect(out.match(/declare module/g) ?? []).toHaveLength(1);
  });

  it('is not fooled by a brace inside a string literal', () => {
    // Fuzz-found. A `}` in a string ended the block early and left a stray brace
    // behind — the vendored file then does not compile.
    const tricky = [
      "declare module 'nuxt/schema' {",
      "  interface PublicRuntimeConfig { closing: '}'; opening: '{' }",
      '}',
      'export const keep = 1;',
    ].join('\n');
    const out = stripAugmentationBlocks(tricky);
    expect(out).not.toContain('declare module');
    expect(out).toContain('export const keep = 1;');
    // No orphaned brace left on its own line.
    expect(out.split('\n').filter((l) => l.trim() === '}')).toHaveLength(0);
  });

  it('reports rather than silently retaining when the end cannot be found', () => {
    const reasons: string[] = [];
    const broken = "declare module 'nuxt/schema' {\n  interface PublicRuntimeConfig extends X {}\n";
    expect(stripAugmentationBlocks(broken, (r) => reasons.push(r))).toBe(broken);
    expect(reasons).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = stripAugmentationBlocks(`${KEEPER}\n${AUGMENTATION}\n`);
    expect(stripAugmentationBlocks(once)).toBe(once);
  });
});

describe('stripVendorSchemaAugmentation', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { force: true, recursive: true })));

  const core = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-core-'));
    dirs.push(dir);
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    return dir;
  };

  it('finds and patches the file wherever in the core tree it lives', () => {
    const dir = core({ 'runtime/types/module.ts': `${KEEPER}\n${AUGMENTATION}\n` });
    const { touched, warnings } = stripVendorSchemaAugmentation({ coreDir: dir, filesystem });

    expect(touched).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(readFileSync(join(dir, 'runtime/types/module.ts'), 'utf8')).not.toContain('declare module');
  });

  it('does not rewrite files that have nothing to strip', () => {
    const dir = core({ 'runtime/index.ts': 'export const a = 1;\n' });
    expect(stripVendorSchemaAugmentation({ coreDir: dir, filesystem }).touched).toEqual([]);
    expect(readFileSync(join(dir, 'runtime/index.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('returns nothing for a core directory that is not there', () => {
    expect(stripVendorSchemaAugmentation({ coreDir: join(tmpdir(), 'nope-' + Date.now()), filesystem }).touched).toEqual([]);
  });

  itDrift('matches the real nuxt-extensions source when it is checked out (drift detector)', () => {
    // Guards the assumption the whole fix rests on: that upstream still ships this
    // augmentation in a file the vendoring copies. If upstream removes or renames
    // it, this strip becomes dead code and should go — and if upstream MOVES it,
    // the strip must learn the new place. Skipped when the sibling checkout is
    // absent, so this repo stays testable on its own.
    const source = readFileSync(UPSTREAM_MODULE, 'utf8');
    expect(source).toMatch(/declare module ['"](?:@nuxt|nuxt)\/schema['"]/);
    expect(stripAugmentationBlocks(source)).not.toMatch(/declare module ['"](?:@nuxt|nuxt)\/schema['"]/);
  });
  it('patches every file that needs it, not just the first', () => {
    const dir = core({
      'runtime/types/module.ts': `${KEEPER}\n${AUGMENTATION}\n`,
      'runtime/types/other.ts': `${KEEPER}\n${AUGMENTATION}\n`,
    });
    expect(stripVendorSchemaAugmentation({ coreDir: dir, filesystem }).touched).toHaveLength(2);
  });

  it('reports a block it could not process instead of leaving it silently', () => {
    // Silence here is the worst outcome: the augmentation stays, so
    // `config.public.*` is `unknown` in the generated project, and the conversion
    // still printed success.
    const dir = core({ 'runtime/types/module.ts': "declare module 'nuxt/schema' {\n  interface PublicRuntimeConfig extends X {}\n" });
    const { touched, warnings } = stripVendorSchemaAugmentation({ coreDir: dir, filesystem });
    expect(touched).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown/);
  });
});
