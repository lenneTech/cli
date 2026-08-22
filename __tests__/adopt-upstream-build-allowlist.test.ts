/**
 * Vendoring makes the framework's build-script decisions the project's problem.
 *
 * `lt fullstack init --framework-mode vendor` resolves the vendored core's import
 * closure into DIRECT dependencies. `import('bullmq')` in
 * core-cron-jobs.service.ts stops being nest-server's business and becomes the
 * project's, dragging `msgpackr` → `msgpackr-extract` — a package with an install
 * script — along with it. pnpm 11 does not quietly deny an unlisted install
 * script: it stops the install with ERR_PNPM_IGNORED_BUILDS and writes a
 * `set this to true or false` placeholder into the workspace file. One missing
 * entry therefore means a project that cannot be installed, on the very first
 * command, before any code exists.
 *
 * nest-server carries the correct map, but `pnpm-workspace.yaml` is not in its npm
 * tarball, so nothing downstream can read it. The bridge used to be a human
 * copying entries into nest-server-starter — and that bridge demonstrably rots:
 * `@scarf/scarf` stood at `true` in the starter while the framework denied it.
 *
 * What must hold:
 *   1. A key the framework has and the project lacks is adopted.
 *   2. A key the project already decided is NEVER overwritten — including an
 *      explicit `false`. The project is the more specific context.
 *   3. The comment explaining an adopted key comes with it. `'msgpackr-extract':
 *      false` without its twenty lines reads as dead weight, and the whole failure
 *      mode is someone deleting it.
 *   4. Malformed or absent upstream input degrades to "adopt nothing", never to a
 *      thrown conversion.
 */
import { filesystem } from 'gluegun';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { adoptUpstreamBuildAllowlist } from '../src/lib/adopt-upstream-build-allowlist';

/**
 * The drift detector needs the sibling checkouts. When they are absent it must
 * be visibly SKIPPED, never silently green.
 *
 * Measured: this repo's CI does a single `actions/checkout` of itself, so
 * `../nest-server` will never exist there — the detector was passing without
 * ever running, and `✓` is indistinguishable from `✓`. `it.skip` at least prints
 * `○`. `LT_DRIFT_STRICT=1` turns absence into a hard failure and belongs in the
 * release workflow, which can afford to clone the siblings and is the one moment
 * drift actually matters: right before a version ships.
 */
const FRAMEWORK_WS = join(__dirname, '..', '..', 'nest-server', 'pnpm-workspace.yaml');
const STARTER_WS = join(__dirname, '..', '..', 'nest-server-starter', 'pnpm-workspace.yaml');
const SIBLINGS_PRESENT = filesystem.exists(FRAMEWORK_WS) && filesystem.exists(STARTER_WS);
const DRIFT_STRICT = process.env.LT_DRIFT_STRICT === '1';
const itDrift = SIBLINGS_PRESENT || DRIFT_STRICT ? it : it.skip;

describe('adoptUpstreamBuildAllowlist', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { force: true, recursive: true })));

  /** A throwaway project root carrying the given pnpm-workspace.yaml (or none). */
  const project = (yaml?: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-allowlist-'));
    dirs.push(dir);
    if (yaml !== undefined) writeFileSync(join(dir, 'pnpm-workspace.yaml'), yaml);
    return dir;
  };

  const read = (dest: string): string => readFileSync(join(dest, 'pnpm-workspace.yaml'), 'utf8');

  const UPSTREAM = [
    'allowBuilds:',
    "  bcrypt: true",
    '  # Optional native accelerator for msgpackr; the prebuilt package carries no',
    '  # scripts of its own, so denying the build costs no acceleration.',
    "  'msgpackr-extract': false",
    "  '@scarf/scarf': false",
    '',
  ].join('\n');

  it('adopts a build decision the project does not have', () => {
    const dest = project("allowBuilds:\n  bcrypt: true\n");
    const adopted = adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM });

    expect(adopted.sort()).toEqual(['@scarf/scarf', 'msgpackr-extract']);
    const out = read(dest);
    expect(out).toMatch(/msgpackr-extract['"]?: false/);
    expect(out).toMatch(/@scarf\/scarf['"]?: false/);
  });

  it('carries the reason for an adopted key, not just the value', () => {
    // The failure this prevents: an entry that looks dead (`pnpm why
    // msgpackr-extract` finds nothing in npm mode) gets deleted, and the next
    // fresh install dies. The explanation is the entire defence.
    const dest = project('allowBuilds:\n  bcrypt: true\n');
    adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM });

    expect(read(dest)).toContain('# Optional native accelerator for msgpackr');
  });

  it('adds allowBuilds to a workspace file that has none yet', () => {
    // The likeliest real shape — the lt-monorepo root workspace file declares
    // `packages:` and nothing else. Code that assumed `allowBuilds` already
    // existed would fail exactly here, on the first init of every project.
    const dest = project('packages:\n  - projects/*\n');
    const adopted = adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM });

    expect(adopted.sort()).toEqual(['@scarf/scarf', 'bcrypt', 'msgpackr-extract']);
    const out = read(dest);
    expect(out).toContain('allowBuilds:');
    expect(out).toMatch(/packages:/);
    expect(out).toContain('# Optional native accelerator for msgpackr');
  });

  it('leaves a malformed destination file alone', () => {
    // Only the UPSTREAM malformed case was covered. Rewriting a file we could not
    // parse would destroy whatever the project had.
    const broken = '{{{ not yaml';
    const dest = project(broken);
    expect(adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM })).toEqual([]);
    expect(read(dest)).toBe(broken);
  });

  it('leaves an empty destination file alone', () => {
    const dest = project('');
    expect(adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM })).toEqual([]);
    expect(read(dest)).toBe('');
  });

  it('never overwrites a decision the project already made', () => {
    // Both directions matter: the project saying `false` where the framework says
    // `true` is a deliberate, more-specific choice, and flipping it silently would
    // be a worse bug than the one being fixed.
    const dest = project("allowBuilds:\n  bcrypt: false\n  'msgpackr-extract': true\n");
    const adopted = adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM });

    expect(adopted).toEqual(['@scarf/scarf']);
    const parsedBcrypt = /\bbcrypt['"]?:\s*(\w+)/.exec(read(dest))?.[1];
    const parsedMsgpackr = /msgpackr-extract['"]?:\s*(\w+)/.exec(read(dest))?.[1];
    expect(parsedBcrypt).toBe('false');
    expect(parsedMsgpackr).toBe('true');
  });

  it('treats ANY existing key as a decision, whatever shape YAML gave it', () => {
    // js-yaml 4 uses the YAML 1.2 core schema, so `no` and `off` are STRINGS, not
    // booleans. Narrowing the project's map to booleans first made a maintainer
    // who wrote `no` to mean "deny" read as "no opinion" — upstream's `true` was
    // adopted AND the original entry vanished from the rewritten file. Verified
    // against pnpm-visible output for all five shapes.
    for (const written of ['no', 'off', "'false'", 'set this to true or false', '']) {
      const dest = project(`allowBuilds:\n  esbuild: ${written}\n`);
      const adopted = adoptUpstreamBuildAllowlist({
        dest,
        filesystem,
        upstreamWorkspaceYaml: 'allowBuilds:\n  esbuild: true\n',
      });
      expect(adopted).toEqual([]);
      expect(read(dest)).not.toMatch(/esbuild:\s*true/);
    }
  });

  it('adopts package names that collide with Object.prototype members', () => {
    // `'constructor' in {}` is true via the prototype, so eight real package names
    // read as already-decided and were silently never adopted — the
    // ERR_PNPM_IGNORED_BUILDS abort this function exists to prevent.
    const dest = project('allowBuilds:\n  bcrypt: true\n');
    const adopted = adoptUpstreamBuildAllowlist({
      dest,
      filesystem,
      upstreamWorkspaceYaml: 'allowBuilds:\n  constructor: true\n  toString: false\n',
    });
    expect(adopted.sort()).toEqual(['constructor', 'toString']);
  });

  it('refuses to write through a symlinked project', () => {
    // `--api-link` points the sub-project at the user's own checkout; writing
    // there edits their repository.
    const real = project('allowBuilds:\n  bcrypt: true\n');
    const link = join(mkdtempSync(join(tmpdir(), 'lt-link-')), 'api');
    dirs.push(link);
    symlinkSync(real, link, 'dir');
    expect(adoptUpstreamBuildAllowlist({ dest: link, filesystem, upstreamWorkspaceYaml: UPSTREAM })).toEqual([]);
    expect(read(real)).toBe('allowBuilds:\n  bcrypt: true\n');
  });

  it('leaves the file untouched when there is nothing to add', () => {
    const yaml = "allowBuilds:\n  bcrypt: true\n  'msgpackr-extract': false\n  '@scarf/scarf': false\n";
    const dest = project(yaml);
    expect(adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM })).toEqual([]);
    // Byte-identical: a no-op must not reformat the project's own file, or every
    // conversion would show a spurious diff and reviewers would stop reading them.
    expect(read(dest)).toBe(yaml);
  });

  it('does not invent a pnpm-workspace.yaml where the project has none', () => {
    // Writing one would declare a workspace root the scaffolding never asked for.
    const dest = project();
    expect(adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml: UPSTREAM })).toEqual([]);
    expect(filesystem.exists(join(dest, 'pnpm-workspace.yaml'))).toBeFalsy();
  });

  it('degrades quietly on unusable upstream input rather than failing the conversion', () => {
    const yaml = 'allowBuilds:\n  bcrypt: true\n';
    for (const upstreamWorkspaceYaml of ['', '{{{ not yaml', 'allowBuilds: "a string"', 'packages:\n  - a\n']) {
      const dest = project(yaml);
      expect(adoptUpstreamBuildAllowlist({ dest, filesystem, upstreamWorkspaceYaml })).toEqual([]);
      expect(read(dest)).toBe(yaml);
    }
  });

  it('ignores non-boolean entries instead of copying them through', () => {
    const dest = project('allowBuilds:\n  bcrypt: true\n');
    const adopted = adoptUpstreamBuildAllowlist({
      dest,
      filesystem,
      upstreamWorkspaceYaml: "allowBuilds:\n  weird: 'maybe'\n  ok: false\n",
    });
    expect(adopted).toEqual(['ok']);
    expect(read(dest)).not.toContain('weird');
  });

  itDrift('the real nest-server and nest-server-starter maps agree (drift detector)', () => {
    // Not a unit test of the function — a check on the two files themselves. If
    // this fails, the starter is missing a build decision the framework makes, and
    // a fresh vendor-mode project would hit ERR_PNPM_IGNORED_BUILDS. The adoption
    // above repairs that at conversion time; this says so at development time,
    // while the person changing nest-server is still looking.
    //
    // Skipped rather than failed when the sibling checkouts are absent: this repo
    // must stay testable on a machine that only cloned the CLI.
    const dest = project(readFileSync(STARTER_WS, 'utf8'));
    const missing = adoptUpstreamBuildAllowlist({
      dest,
      filesystem,
      upstreamWorkspaceYaml: readFileSync(FRAMEWORK_WS, 'utf8'),
    });
    expect(missing).toEqual([]);
  });
});
