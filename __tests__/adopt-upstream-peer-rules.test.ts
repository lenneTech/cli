/**
 * Vendoring makes the framework's peer exceptions the project's problem.
 *
 * The vendor conversion turns `typeorm` and `ioredis` into direct dependencies of
 * the project. typeorm 1.1.2 peer-wants `ioredis ^5.0.4`, the framework is on
 * ioredis 6, and nest-server scope-allows that in its own `pnpm-workspace.yaml`
 * (`'typeorm>ioredis': '6'`). That file is not in the npm tarball, so a fresh
 * vendor project failed its first `pnpm run check` at `check:peers` with
 * "unmet peer ioredis" (smoke test, CLI 1.56.0).
 *
 * What must hold:
 *   1. A rule about a package the project depends on is adopted.
 *   2. A rule about a package the project does not have is not.
 *   3. A selector the project already lists keeps its value.
 *   4. Odd shapes on either side degrade to "adopt nothing", never to a rewrite
 *      that loses what the project had.
 *   5. In a fullstack workspace the adopted rule survives the hoist to the root,
 *      which is where `pnpm peers check` reads it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { filesystem } from 'gluegun';
import { load } from 'js-yaml';
import { tmpdir } from 'os';
import { join } from 'path';

import { adoptUpstreamPeerRules, selectorSubject } from '../src/lib/adopt-upstream-peer-rules';
import { hoistWorkspacePnpmConfig } from '../src/lib/hoist-workspace-pnpm-config';
import { pnpmSettingsDir } from '../src/lib/workspace-integration';

/** Same gating as the drift detector in adopt-upstream-build-allowlist.test.ts. */
const FRAMEWORK_WS = join(__dirname, '..', '..', 'nest-server', 'pnpm-workspace.yaml');
const STARTER_WS = join(__dirname, '..', '..', 'nest-server-starter', 'pnpm-workspace.yaml');
const SIBLINGS_PRESENT = filesystem.exists(FRAMEWORK_WS) && filesystem.exists(STARTER_WS);
const DRIFT_STRICT = process.env.LT_DRIFT_STRICT === '1';
const itSiblings = SIBLINGS_PRESENT || DRIFT_STRICT ? it : it.skip;

describe('adoptUpstreamPeerRules', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { force: true, recursive: true })));

  /** A throwaway project root carrying the given pnpm-workspace.yaml (or none). */
  const project = (yaml?: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-peer-rules-'));
    dirs.push(dir);
    if (yaml !== undefined) writeFileSync(join(dir, 'pnpm-workspace.yaml'), yaml);
    return dir;
  };

  const read = (dest: string): string => readFileSync(join(dest, 'pnpm-workspace.yaml'), 'utf8');
  const allowed = (dest: string): Record<string, unknown> =>
    (load(read(dest)) as any)?.peerDependencyRules?.allowedVersions ?? {};

  const UPSTREAM = [
    'peerDependencyRules:',
    '  allowedVersions:',
    "    # typeorm 1.1.2 declares the optional peer `ioredis: ^5.0.4`.",
    "    'typeorm>ioredis': '6'",
    "    'vis-network>keycharm': '1'",
    '  ignoreMissing:',
    "    - '@egjs/hammerjs'",
    '  allowAny:',
    '    - some-peer',
    '',
  ].join('\n');

  const STARTER = ['peerDependencyRules:', '  allowedVersions:', "    '@swc/cli>chokidar': '4'", ''].join('\n');

  const adopt = (dest: string, projectPackages: string[], upstreamWorkspaceYaml = UPSTREAM): string[] =>
    adoptUpstreamPeerRules({ dest, filesystem, projectPackages, upstreamWorkspaceYaml });

  it('adopts a rule about a package the project depends on, next to the project rules', () => {
    const dest = project(STARTER);
    expect(adopt(dest, ['typeorm', 'ioredis', '@swc/cli'])).toEqual(['typeorm>ioredis']);
    expect(allowed(dest)).toEqual({ '@swc/cli>chokidar': '4', 'typeorm>ioredis': '6' });
  });

  it('leaves a rule behind when the project does not have its package', () => {
    // vis-network arrives through compodoc, a framework devDependency. Adopting
    // its rule would only widen what the project tolerates.
    const dest = project(STARTER);
    adopt(dest, ['typeorm']);
    expect(allowed(dest)).not.toHaveProperty('vis-network>keycharm');
  });

  it('adopts nothing and leaves the file untouched when no rule is relevant', () => {
    const dest = project(STARTER);
    expect(adopt(dest, ['express'])).toEqual([]);
    expect(read(dest)).toBe(STARTER);
  });

  it('takes the subject of an unscoped selector from the peer itself', () => {
    const dest = project(STARTER);
    expect(adopt(dest, ['ioredis'], "peerDependencyRules:\n  allowedVersions:\n    ioredis: '6'\n")).toEqual([
      'ioredis',
    ]);
    expect(allowed(dest)).toHaveProperty('ioredis', '6');
  });

  it('never overwrites a selector the project already lists', () => {
    const dest = project("peerDependencyRules:\n  allowedVersions:\n    'typeorm>ioredis': '5'\n");
    expect(adopt(dest, ['typeorm'])).toEqual([]);
    expect(allowed(dest)).toEqual({ 'typeorm>ioredis': '5' });
  });

  it('adopts only allowedVersions, not ignoreMissing or allowAny', () => {
    // Neither list names the package that needs it, so there is no way to tell
    // whether the project has it.
    const dest = project(STARTER);
    adopt(dest, ['typeorm', '@egjs/hammerjs', 'some-peer']);
    const rules = (load(read(dest)) as any).peerDependencyRules;
    expect(rules.ignoreMissing).toBeUndefined();
    expect(rules.allowAny).toBeUndefined();
  });

  it('adds peerDependencyRules to a workspace file that has none', () => {
    const dest = project("allowBuilds:\n  # why bcrypt builds\n  bcrypt: true\n");
    expect(adopt(dest, ['typeorm'])).toEqual(['typeorm>ioredis']);
    const out = read(dest);
    expect(allowed(dest)).toEqual({ 'typeorm>ioredis': '6' });
    // The project's own first-level comments survive the rewrite.
    expect(out).toContain('# why bcrypt builds');
  });

  it('inserts the rule as text and keeps every other byte, with the upstream reason above it', () => {
    // Re-dumping the file dropped every comment not directly above a first-level
    // entry: about 240 lines of policy text in a standalone vendor project.
    const before = [
      '# Section header at column 0, about the whole file.',
      'auditConfig:',
      '  ignoreGhsas:',
      '    # why this advisory is accepted',
      '    - GHSA-x',
      '',
      '# Peer rules: read this first.',
      'peerDependencyRules:',
      '  allowedVersions:',
      '    # why chokidar 4',
      "    '@swc/cli>chokidar': '4'",
      '  # not a comment of allowedVersions',
      '  ignoreMissing:',
      '    - keep-me',
      '',
    ].join('\n');
    const dest = project(before);
    expect(adopt(dest, ['typeorm'])).toEqual(['typeorm>ioredis']);

    const added = ['    # typeorm 1.1.2 declares the optional peer `ioredis: ^5.0.4`.', "    'typeorm>ioredis': '6'"];
    const lines = before.split('\n');
    lines.splice(lines.indexOf("    '@swc/cli>chokidar': '4'") + 1, 0, ...added);
    expect(read(dest)).toBe(lines.join('\n'));
  });

  it('adds allowedVersions below a peerDependencyRules that has only other keys', () => {
    const before = 'peerDependencyRules:\n  # keep\n  ignoreMissing:\n    - x\n';
    const dest = project(before);
    adopt(dest, ['typeorm']);
    expect(read(dest)).toBe(
      'peerDependencyRules:\n  # keep\n  ignoreMissing:\n    - x\n  allowedVersions:\n' +
        "    # typeorm 1.1.2 declares the optional peer `ioredis: ^5.0.4`.\n    'typeorm>ioredis': '6'\n",
    );
  });

  it('keeps CRLF line endings', () => {
    const dest = project("# note\r\npeerDependencyRules:\r\n  allowedVersions:\r\n    a>b: '1'\r\n");
    adopt(dest, ['typeorm']);
    const out = read(dest);
    expect(out).toContain("'typeorm>ioredis': '6'\r\n");
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('falls back to a rewrite for a flow-style mapping, and still adopts the rule', () => {
    const dest = project("peerDependencyRules: { allowedVersions: { 'a>b': '1' } }\n");
    expect(adopt(dest, ['typeorm'])).toEqual(['typeorm>ioredis']);
    expect(allowed(dest)).toEqual({ 'a>b': '1', 'typeorm>ioredis': '6' });
  });

  it('drops an upstream comment carrying a control character, not the rule', () => {
    // A bare CR ends the comment for every YAML parser but not for a split on
    // '\n'. Carried verbatim, it would plant `'evil>x'` as a real entry.
    const upstream = "peerDependencyRules:\n  allowedVersions:\n    # note\r    'evil>x': '1'\n    'typeorm>ioredis': '6'\n";
    const dest = project(STARTER);
    expect(adopt(dest, ['typeorm'], upstream)).toEqual(['typeorm>ioredis']);
    expect(read(dest)).not.toContain('\r');
    expect(allowed(dest)).toEqual({ '@swc/cli>chokidar': '4', 'typeorm>ioredis': '6' });
  });

  it.each([
    ['peerDependencyRules is a list', 'peerDependencyRules:\n  - x\n'],
    ['allowedVersions is a list', 'peerDependencyRules:\n  allowedVersions:\n    - x\n'],
    ['the file does not parse', '{{{ not yaml'],
    ['the file is empty', ''],
  ])('leaves the project file alone when %s', (_label, yaml) => {
    const dest = project(yaml);
    expect(adopt(dest, ['typeorm'])).toEqual([]);
    expect(read(dest)).toBe(yaml);
  });

  it('does not invent a pnpm-workspace.yaml where the project has none', () => {
    const dest = project();
    expect(adopt(dest, ['typeorm'])).toEqual([]);
    expect(filesystem.exists(join(dest, 'pnpm-workspace.yaml'))).toBe(false);
  });

  it('refuses to write through a symlinked project', () => {
    const real = project(STARTER);
    const link = join(mkdtempSync(join(tmpdir(), 'lt-peer-rules-link-')), 'api');
    dirs.push(join(link, '..'));
    symlinkSync(real, link);
    expect(adopt(link, ['typeorm'])).toEqual([]);
    expect(read(real)).toBe(STARTER);
  });

  it.each([['', 'no upstream file'], ['{{{', 'malformed'], ['allowBuilds:\n  x: true\n', 'no rules']])(
    'degrades quietly on unusable upstream input (%j, %s)',
    (upstream) => {
      const dest = project(STARTER);
      expect(adopt(dest, ['typeorm'], upstream)).toEqual([]);
      expect(read(dest)).toBe(STARTER);
    },
  );

  it('ignores a rule whose range is not a string', () => {
    const dest = project(STARTER);
    expect(adopt(dest, ['typeorm'], "peerDependencyRules:\n  allowedVersions:\n    'typeorm>ioredis': 6\n")).toEqual(
      [],
    );
  });

  itSiblings(
    'with the real nest-server and nest-server-starter files, the typeorm rule reaches the workspace root',
    () => {
      // The smoke-test shape: lt-monorepo root, starter settings in projects/api,
      // typeorm added by the vendored core's import closure. Before the fix the
      // root ended up with `@swc/cli>chokidar` only, and `pnpm peers check` failed.
      const root = project('packages:\n  - projects/*\n');
      const api = join(root, 'projects', 'api');
      mkdirSync(api, { recursive: true });
      writeFileSync(join(api, 'pnpm-workspace.yaml'), readFileSync(STARTER_WS, 'utf8'));
      writeFileSync(join(api, 'package.json'), JSON.stringify({ name: 'api' }));
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root' }));

      // No assertion on the return value: once the starter carries the rule itself,
      // nothing is adopted and the root is still right.
      adoptUpstreamPeerRules({
        dest: api,
        filesystem,
        projectPackages: ['typeorm', 'ioredis', '@nestjs/core'],
        upstreamWorkspaceYaml: readFileSync(FRAMEWORK_WS, 'utf8'),
      });

      hoistWorkspacePnpmConfig({ filesystem, projectDir: root, subProjects: ['projects/api'] });

      const rootAllowed = (load(read(root)) as any)?.peerDependencyRules?.allowedVersions ?? {};
      expect(rootAllowed).toHaveProperty('typeorm>ioredis');
    },
  );

  itSiblings('a standalone vendor project keeps every line of the real starter file', () => {
    // `lt server create --framework-mode vendor`: no hoist follows, so whatever the
    // adoption writes is what the project keeps.
    const starter = readFileSync(STARTER_WS, 'utf8');
    const dest = project(starter);
    adoptUpstreamPeerRules({
      dest,
      filesystem,
      projectPackages: ['typeorm', 'ioredis'],
      upstreamWorkspaceYaml: readFileSync(FRAMEWORK_WS, 'utf8'),
    });

    const after = read(dest).split('\n');
    const remaining = [...after];
    for (const line of starter.split('\n')) {
      const at = remaining.indexOf(line);
      expect(at, `line lost: ${line}`).toBeGreaterThanOrEqual(0);
      remaining.splice(at, 1);
    }
    // Only the rule (and its upstream reason) was added.
    expect(remaining.every((line) => /^\s*#/.test(line) || line.includes('typeorm>ioredis'))).toBe(true);
    expect(allowed(dest)).toHaveProperty('typeorm>ioredis');
  });

  it('after a hoist, a later vendor conversion writes the rule to the workspace root', () => {
    // `lt fullstack convert-mode --to vendor` on an npm-mode workspace: the hoist
    // already moved the settings to the root and deleted projects/api's file.
    const rootYaml = "packages:\n  - projects/*\n# root note\npeerDependencyRules:\n  allowedVersions:\n    '@swc/cli>chokidar': '4'\n";
    const root = project(rootYaml);
    const api = join(root, 'projects', 'api');
    mkdirSync(api, { recursive: true });

    expect(pnpmSettingsDir(api, filesystem)).toBe(filesystem.path(root));
    expect(adopt(pnpmSettingsDir(api, filesystem), ['typeorm'])).toEqual(['typeorm>ioredis']);
    expect(read(root)).toContain('# root note');
    expect(allowed(root)).toEqual({ '@swc/cli>chokidar': '4', 'typeorm>ioredis': '6' });
  });
});

describe('pnpmSettingsDir', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { force: true, recursive: true })));

  const workspace = (): { api: string; root: string } => {
    const root = mkdtempSync(join(tmpdir(), 'lt-settings-dir-'));
    dirs.push(root);
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - projects/*\n');
    const api = join(root, 'projects', 'api');
    mkdirSync(join(api, 'src'), { recursive: true });
    return { api, root };
  };

  it('prefers the project file when it has one', () => {
    const { api } = workspace();
    writeFileSync(join(api, 'pnpm-workspace.yaml'), 'allowBuilds: {}\n');
    expect(pnpmSettingsDir(api, filesystem)).toBe(api);
  });

  it('uses the workspace root for projects/api without a file of its own', () => {
    const { api, root } = workspace();
    expect(pnpmSettingsDir(api, filesystem)).toBe(filesystem.path(root));
  });

  it('never climbs from a directory that is not exactly projects/api or projects/app', () => {
    const { api } = workspace();
    expect(pnpmSettingsDir(join(api, 'src'), filesystem)).toBe(join(api, 'src'));
  });

  it('stays in a standalone project without any workspace around it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-settings-standalone-'));
    dirs.push(dir);
    expect(pnpmSettingsDir(dir, filesystem)).toBe(dir);
  });
});

describe('selectorSubject', () => {
  it.each([
    ['typeorm>ioredis', 'typeorm'],
    ['typeorm@1>ioredis', 'typeorm'],
    ['@swc/cli>chokidar', '@swc/cli'],
    ['@swc/cli@0.8>chokidar', '@swc/cli'],
    ['ioredis', 'ioredis'],
    ['@types/express', '@types/express'],
  ])('%s → %s', (selector, subject) => {
    expect(selectorSubject(selector)).toBe(subject);
  });
});
