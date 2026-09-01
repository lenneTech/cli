import { dump, load } from 'js-yaml';

import {
  extractKeyComments,
  hoistPackageManager,
  hoistWorkspacePnpmConfig,
  reattachKeyComments,
} from '../src/lib/hoist-workspace-pnpm-config';

const { filesystem } = require('gluegun');

/**
 * The hoist destination is the ROOT pnpm-workspace.yaml (pnpm 11 ignores
 * package.json#pnpm). Root-owned seed settings therefore live in
 * pnpm-workspace.yaml too; sub-projects may still carry config in either
 * package.json#pnpm or their own pnpm-workspace.yaml.
 */
describe('hoistWorkspacePnpmConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-hoist-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  const writeJson = (path: string, data: unknown): void => {
    filesystem.write(path, JSON.stringify(data, null, 2) + '\n');
  };
  const readJson = (path: string): any => JSON.parse(filesystem.read(path) || '{}');

  // Root workspace helpers — the hoist source/destination for root settings.
  const seedRootWs = (data: Record<string, unknown>): void => {
    filesystem.write(`${tempDir}/pnpm-workspace.yaml`, dump({ packages: ['projects/*'], ...data }));
  };
  const rootWs = (): any => load(filesystem.read(`${tempDir}/pnpm-workspace.yaml`) || '') || {};

  it('merges `overrides` from sub-project into root with sub-project precedence', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { handlebars: '4.7.9', lodash: '4.17.0' } });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0', lodash: '4.18.1' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    expect(rootWs().overrides).toEqual({
      axios: '1.15.0',
      handlebars: '4.7.9',
      lodash: '4.18.1', // sub wins
    });
    // packages: declaration preserved.
    expect(rootWs().packages).toEqual(['projects/*']);
    expect(readJson(`${tempDir}/projects/api/package.json`).pnpm).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Sub-vs-sub conflicts.
  //
  // The merge is last-writer-wins, which is RIGHT for root-vs-sub (a sub-project
  // owns the authoritative list for its own transitive deps) and a trap for
  // sub-vs-sub: two projects pinning one package to different versions produce a
  // single silent winner, picked by iteration order. Nothing downstream can tell
  // that apart from a deliberate decision — the generated workspace just carries
  // one of the two values with no record that the other existed.
  //
  // This matters most for the packages api and app SHARE. better-auth is the
  // worked example: it is one protocol with two ends, so a version split there is
  // a client and a server disagreeing about their own wire format.
  // -------------------------------------------------------------------------

  it('reports two sub-projects pinning the same package to different versions', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { 'better-auth': '1.7.1' } },
    });
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { overrides: { 'better-auth': '1.7.2' } },
    });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toHaveLength(1);
    // The message must name both values and both sources — a bare "conflict"
    // sends the reader hunting through two repos.
    expect(conflicts[0]).toContain('better-auth');
    expect(conflicts[0]).toContain('1.7.1');
    expect(conflicts[0]).toContain('1.7.2');
    expect(conflicts[0]).toContain('projects/api');
    expect(conflicts[0]).toContain('projects/app');
  });

  it('stays silent when two sub-projects agree on the same value', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { 'better-auth': '1.7.1' } },
    });
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { overrides: { 'better-auth': '1.7.1' } },
    });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toEqual([]);
    expect(rootWs().overrides).toEqual({ 'better-auth': '1.7.1' });
  });

  it('does not treat root-vs-sub precedence as a conflict', () => {
    // The root only seeds; a sub-project overriding it is the documented,
    // intended behaviour and must not produce noise.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { lodash: '4.17.0' } });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { lodash: '4.18.1' } },
    });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api'],
    });

    expect(conflicts).toEqual([]);
    expect(rootWs().overrides.lodash).toBe('4.18.1');
  });

  it('detects a conflict across the two config sources of different sub-projects', () => {
    // api declares it in package.json#pnpm, app in its own pnpm-workspace.yaml.
    // Both are legal, and the disagreement must be caught either way.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { 'better-auth': '1.7.1' } },
    });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app' });
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      dump({ overrides: { 'better-auth': '1.6.26' } }),
    );

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('1.6.26');
    // Both ends must be named. A message that identifies only one of them
    // leaves the reader to guess which repo carries the other value.
    expect(conflicts[0]).toContain('projects/api');
    expect(conflicts[0]).toContain('projects/app');
  });

  it('keeps the merge report-only — the last writer still wins', () => {
    // Detection deliberately does not change the outcome. Pinned so a later
    // "fix" that aborts or reorders the merge cannot pass silently.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { 'better-auth': '1.7.1' } },
    });
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { overrides: { 'better-auth': '1.7.2' } },
    });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toHaveLength(1);
    expect(rootWs().overrides['better-auth']).toBe('1.7.2');
  });

  it('catches a sub-project contradicting ITSELF across its two config sources', () => {
    // `sourceLabel` names the FILE, not the sub-project. Sharing one label
    // across both of a project's sources hid this: the yaml value won and the
    // root ended up on the OLDER pin with no output at all.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { 'better-auth': '1.7.1' } },
    });
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, dump({ overrides: { 'better-auth': '1.0.0' } }));

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api'],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('projects/api/package.json#pnpm');
    expect(conflicts[0]).toContain('projects/api/pnpm-workspace.yaml');
  });

  it('reports a disagreement in `allowBuilds`, the other object-valued field', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { allowBuilds: { 'msgpackr-extract': false } },
    });
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { allowBuilds: { 'msgpackr-extract': true } },
    });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toHaveLength(1);
    // …and the DENY wins. `allowBuilds` decides which packages may run a
    // postinstall script, so last-writer-wins would resolve the disagreement in
    // favour of executing code one sub-project explicitly refused.
    expect(rootWs().allowBuilds).toEqual({ 'msgpackr-extract': false });
    expect(rootWs().onlyBuiltDependencies).toEqual([]);
    // The message must say what actually happened. An earlier version announced
    // the incoming value as the winner for every field, so for `allowBuilds` it
    // stated the opposite of the file it had just written.
    expect(conflicts[0]).toContain('keeps false');
    expect(conflicts[0]).not.toContain('would silently win');
  });

  it('does not mistake YAML 1.2 `no` for a disagreement with JSON `false`', () => {
    // js-yaml 4 parses `esbuild: no` as the STRING 'no'; the same intent in
    // package.json#pnpm is the BOOLEAN false. `syncBuildAllowlists` narrows both
    // to false, so reporting them sends someone through two repos over two
    // spellings of "deny".
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', pnpm: { allowBuilds: { esbuild: false } } });
    filesystem.write(`${tempDir}/projects/app/pnpm-workspace.yaml`, 'allowBuilds:\n  esbuild: no\n');

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toEqual([]);
  });

  it('reports the incremental add-api → add-app case, where the api is already hoisted', () => {
    // Hoisting is destructive: the api's `pnpm` block is gone from its
    // package.json once it reaches the root. A later `add-app` therefore sees
    // only root-vs-sub and used to stay silent while the app overwrote the api's
    // pin. The signal is a sub-project that is present but contributed nothing.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { 'better-auth': '1.7.1' } },
    });
    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { overrides: { 'better-auth': '1.7.2' } },
    });
    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('better-auth');
    expect(conflicts[0]).toContain('1.7.1');
    expect(conflicts[0]).toContain('1.7.2');
    // Names the sibling whose earlier contribution the root value came from.
    expect(conflicts[0]).toContain('projects/api');
    // For `overrides` the incoming value really does win, and the message says so.
    expect(conflicts[0]).toContain('which now wins');
    expect(rootWs().overrides['better-auth']).toBe('1.7.2');
  });

  it('reports the incremental case for allowBuilds without misnaming the winner', () => {
    // Same shape as above, but `applyDenyWins` means the incoming value does NOT
    // win. A generic "which now wins" would state the opposite of the file the
    // command just wrote — the reader would go hunting for an allowed build
    // script that was in fact denied.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { allowBuilds: { 'msgpackr-extract': false } },
    });
    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { allowBuilds: { 'msgpackr-extract': true } },
    });
    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('keeps false');
    expect(conflicts[0]).not.toContain('which now wins');
    expect(rootWs().allowBuilds).toEqual({ 'msgpackr-extract': false });
    expect(rootWs().onlyBuiltDependencies).toEqual([]);
  });

  it('stays silent when every sub-project contributes — the root only seeds', () => {
    // The `lt fullstack init` path. Both halves are unhoisted, so overriding the
    // template's own seed is the documented precedence, not a disagreement.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { lodash: '4.17.0' } });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', pnpm: { overrides: { lodash: '4.18.1' } } });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', pnpm: { overrides: { vite: '7.0.0' } } });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toEqual([]);
  });

  it('escapes a control character smuggled through an overrides KEY', () => {
    // An ESC in the key would otherwise reach the terminal raw and could erase
    // and repaint the line — i.e. hide the very warning being printed.
    const evil = `lodash${String.fromCharCode(27)}[2K${String.fromCharCode(27)}[32m all good`;
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', pnpm: { overrides: { [evil]: '1' } } });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', pnpm: { overrides: { [evil]: '2' } } });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toHaveLength(1);
    expect(/[\u0000-\u0008\u000B-\u001F\u007F]/.test(conflicts[0])).toBe(false);
  });

  it('redacts credentials embedded in a conflicting overrides value', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { pkg: 'git+https://user:s3cr3t@host/org/repo' } },
    });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', pnpm: { overrides: { pkg: '2.0.0' } } });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts[0]).not.toContain('s3cr3t');
    expect(conflicts[0]).toContain('***');
  });

  it('reports that hoisting widened the audit suppressions workspace-wide', () => {
    // A union cannot produce a two-valued conflict, but an advisory assessed
    // against ONE package's tree now covers every package in the workspace —
    // and the audit job is the generated project's only automated vuln gate.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(
      `${tempDir}/projects/api/pnpm-workspace.yaml`,
      dump({ auditConfig: { ignoreGhsas: ['GHSA-aaaa-bbbb-cccc'] } }),
    );

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api'],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('auditConfig');
    expect(conflicts[0]).toContain('projects/api');
  });

  it('stays silent for an empty auditConfig — nothing was actually suppressed', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, dump({ auditConfig: { ignoreGhsas: [] } }));

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api'],
    });

    expect(conflicts).toEqual([]);
  });

  it('does not report array-valued fields, which union instead of overwriting', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { ignoredOptionalDependencies: ['@img/a'] },
    });
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { ignoredOptionalDependencies: ['@img/b'] },
    });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toEqual([]);
    expect(rootWs().ignoredOptionalDependencies).toEqual(['@img/a', '@img/b']);
  });

  it('chains the comparison across three sub-projects', () => {
    // Provenance keeps only the last writer, so A≠B and B≠C are reported while
    // A and C are never compared directly. Pinned so the count is a decision,
    // not an accident.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    for (const [dir, version] of [
      ['api', '1.0.0'],
      ['app', '2.0.0'],
      ['admin', '1.0.0'],
    ]) {
      filesystem.dir(`${tempDir}/projects/${dir}`);
      writeJson(`${tempDir}/projects/${dir}/package.json`, { name: dir, pnpm: { overrides: { pkg: version } } });
    }

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app', 'projects/admin'],
    });

    expect(conflicts).toHaveLength(2);
  });

  it('survives a recursive YAML anchor instead of aborting the whole hoist', () => {
    // `js-yaml` resolves `&o … *o` into a circular object; `JSON.stringify`
    // throws on it, which would take `lt fullstack init` down with it.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, 'overrides: &o\n  self: *o\n');
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', pnpm: { overrides: { self: 'x' } } });

    expect(() =>
      hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] }),
    ).not.toThrow();
  });

  it('ignores a non-object value where a map is expected', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', pnpm: { overrides: 'oops' } });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', pnpm: { overrides: { pkg: '1' } } });

    const { conflicts } = hoistWorkspacePnpmConfig({
      filesystem,
      projectDir: tempDir,
      subProjects: ['projects/api', 'projects/app'],
    });

    expect(conflicts).toEqual([]);
  });

  it('dedupes and sorts `ignoredOptionalDependencies` arrays', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { ignoredOptionalDependencies: ['@img/b', '@img/a', '@img/a'] },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().ignoredOptionalDependencies).toEqual(['@img/a', '@img/b']);
  });

  it('dedupes and sorts `onlyBuiltDependencies` arrays', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ onlyBuiltDependencies: ['sharp', 'esbuild'] });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { onlyBuiltDependencies: ['bcrypt', 'esbuild', '@swc/core'] },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['@swc/core', 'bcrypt', 'esbuild', 'sharp']);
    // allowBuilds twin synced from the array.
    expect(rootWs().allowBuilds).toEqual({ '@swc/core': true, bcrypt: true, esbuild: true, sharp: true });
  });

  it('hoists a first-party minimumReleaseAgeExclude glob', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['minimumReleaseAgeExclude:', "  - '@lenne.tech/*'", "  - 'better-auth@1.6.13'", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().minimumReleaseAgeExclude).toEqual(['@lenne.tech/*', 'better-auth@1.6.13']);
  });

  it('removes the entire `pnpm` section from sub-project when it becomes empty', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { overrides: { defu: '6.1.7' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    const app = readJson(`${tempDir}/projects/app/package.json`);
    expect(app).not.toHaveProperty('pnpm');
  });

  it('preserves non-hoisted pnpm fields in the sub-project', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: {
        overrides: { qs: '6.15.1' },
        peerDependencyRules: { allowedVersions: {} }, // not workspace-scoped here
      },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    const api = readJson(`${tempDir}/projects/api/package.json`);
    expect(api.pnpm).toEqual({ peerDependencyRules: { allowedVersions: {} } });
  });

  it('is idempotent — running twice produces the same result', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { handlebars: '4.7.9' } });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    const firstRoot = filesystem.read(`${tempDir}/pnpm-workspace.yaml`);
    const firstApi = filesystem.read(`${tempDir}/projects/api/package.json`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    expect(filesystem.read(`${tempDir}/pnpm-workspace.yaml`)).toEqual(firstRoot);
    expect(filesystem.read(`${tempDir}/projects/api/package.json`)).toEqual(firstApi);
  });

  it('handles missing sub-project gracefully', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { defu: '6.1.7' } });
    expect(() =>
      hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/does-not-exist'] }),
    ).not.toThrow();
    expect(rootWs().overrides).toEqual({ defu: '6.1.7' });
  });

  // ── pnpm-workspace.yaml source (nuxt-base-template pnpm-11 layout) ──────────

  it('hoists overrides from a sub-project pnpm-workspace.yaml into root', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { 'fast-xml-parser@<5.7.0': '5.7.3' } });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      [
        'overrides:',
        "  'vite@>=7.0.0 <7.3.2': 7.3.2",
        "  'fast-xml-parser@<5.7.0': 5.7.4",
        'ignoredOptionalDependencies:',
        "  - '@img/sharp-linux-x64'",
        'onlyBuiltDependencies:',
        '  - esbuild',
        '  - sharp',
        'allowBuilds:',
        '  esbuild: true',
        '  sharp: true',
        '',
      ].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().overrides).toEqual({
      'fast-xml-parser@<5.7.0': '5.7.4', // sub wins
      'vite@>=7.0.0 <7.3.2': '7.3.2',
    });
    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    expect(rootWs().ignoredOptionalDependencies).toEqual(['@img/sharp-linux-x64']);
  });

  it('removes a settings-only sub-project pnpm-workspace.yaml after hoisting', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['overrides:', "  'defu@<=6.1.4': 6.1.7", 'allowBuilds:', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
    expect(rootWs().overrides).toEqual({ 'defu@<=6.1.4': '6.1.7' });
  });

  it('hoists auditConfig, unioning the inner arrays instead of replacing them', () => {
    // Regression: `auditConfig` was NOT in the hoist whitelist, and a
    // settings-only sub-workspace file is REMOVED after hoisting — so the
    // starter's assessed-advisory allowlist was destroyed, not merely ignored.
    // With a deploy-blocking audit job that means the generated project's first
    // pipeline is red on an advisory that was already justified upstream.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.write(
      `${tempDir}/pnpm-workspace.yaml`,
      ['auditConfig:', '  ignoreGhsas:', '    - GHSA-root-only', ''].join('\n'),
    );
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(
      `${tempDir}/projects/api/pnpm-workspace.yaml`,
      [
        'auditConfig:',
        '  ignoreGhsas:',
        '    - GHSA-sub-only',
        '    - GHSA-root-only',
        '  ignoreCves:',
        '    - CVE-2026-14257',
        '',
      ].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    // Union, deduped and sorted — the root's own entry must survive.
    expect(rootWs().auditConfig).toEqual({
      ignoreCves: ['CVE-2026-14257'],
      ignoreGhsas: ['GHSA-root-only', 'GHSA-sub-only'],
    });
    expect(filesystem.exists(`${tempDir}/projects/api/pnpm-workspace.yaml`)).toBe(false);
  });

  it('marks a hoisted auditConfig as workspace-wide, in the file itself', () => {
    // These entries SUPPRESS vulnerability findings and the CI audit job is
    // deploy-blocking. Hoisting is correct (the alternative destroys the
    // allowlist) but it widens the blast radius from one package to all of
    // them, so it must not be invisible to whoever reviews the diff.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(
      `${tempDir}/projects/api/pnpm-workspace.yaml`,
      ['auditConfig:', '  ignoreGhsas:', '    - GHSA-sub-only', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    const raw = filesystem.read(`${tempDir}/pnpm-workspace.yaml`) || '';
    expect(raw).toMatch(/#.*EVERY package in this workspace/);
    expect(raw.indexOf('# Hoisted from the sub-projects')).toBeLessThan(raw.indexOf('auditConfig:'));
    // The note must not accumulate on a second hoist.
    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    const again = filesystem.read(`${tempDir}/pnpm-workspace.yaml`) || '';
    expect(again.match(/# Hoisted from the sub-projects/g) || []).toHaveLength(1);
  });

  it('hoists an auditConfig that only the sub-project has', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(
      `${tempDir}/projects/api/pnpm-workspace.yaml`,
      ['auditConfig:', '  ignoreCves:', '    - CVE-2026-1', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    expect(rootWs().auditConfig).toEqual({ ignoreCves: ['CVE-2026-1'] });
  });

  it('keeps a non-array nested auditConfig value instead of dropping it', () => {
    // pnpm may grow scalar keys under auditConfig; the union branch only applies
    // to arrays, and the else-branch must not silently discard the rest.
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(
      `${tempDir}/projects/api/pnpm-workspace.yaml`,
      ['auditConfig:', '  someScalar: true', '  ignoreGhsas:', '    - GHSA-x', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    expect(rootWs().auditConfig).toEqual({ ignoreGhsas: ['GHSA-x'], someScalar: true });
  });

  it('keeps a sub-project pnpm-workspace.yaml that declares packages, minus hoisted keys', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['packages:', "  - 'sub/*'", 'overrides:', "  'defu@<=6.1.4': 6.1.7", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe('file');
    const remaining = load(filesystem.read(`${tempDir}/projects/app/pnpm-workspace.yaml`) || '');
    expect(remaining).toEqual({ packages: ['sub/*'] });
    expect(rootWs().overrides).toEqual({ 'defu@<=6.1.4': '6.1.7' });
  });

  it('merges both package.json#pnpm and pnpm-workspace.yaml across sub-projects', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0' } },
    });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app' });
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['overrides:', "  'vite@>=7.0.0 <7.3.2': 7.3.2", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(rootWs().overrides).toEqual({
      axios: '1.15.0',
      'vite@>=7.0.0 <7.3.2': '7.3.2',
    });
    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('is idempotent for the pnpm-workspace.yaml source', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['overrides:', "  'defu@<=6.1.4': 6.1.7", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });
    const firstRoot = filesystem.read(`${tempDir}/pnpm-workspace.yaml`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });
    expect(filesystem.read(`${tempDir}/pnpm-workspace.yaml`)).toEqual(firstRoot);
    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('leaves a malformed sub-project pnpm-workspace.yaml untouched', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    const broken = 'overrides:\n  - [unbalanced';
    filesystem.write(`${tempDir}/projects/app/pnpm-workspace.yaml`, broken);

    expect(() =>
      hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] }),
    ).not.toThrow();
    expect(filesystem.read(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(broken);
  });

  it('skips a symlinked sub-project without mutating its source tree', () => {
    const realFs = require('fs');
    // Real sub-project tree lives outside the workspace; projects/app is a symlink to it.
    const realApp = `${tempDir}/external-app`;
    filesystem.dir(realApp);
    filesystem.write(`${realApp}/pnpm-workspace.yaml`, ['overrides:', "  'defu@<=6.1.4': 6.1.7", ''].join('\n'));
    filesystem.dir(`${tempDir}/projects`);
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    realFs.symlinkSync(realApp, `${tempDir}/projects/app`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    // Symlinked source must remain intact and nothing hoisted.
    expect(filesystem.exists(`${realApp}/pnpm-workspace.yaml`)).toBe('file');
    expect(filesystem.exists(`${tempDir}/pnpm-workspace.yaml`)).toBe(false);
  });

  // ── allowBuilds ↔ onlyBuiltDependencies sync ───────────────────────────────

  it('derives onlyBuiltDependencies from a pnpm-11 allowBuilds map (no array twin)', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['allowBuilds:', '  esbuild: true', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    expect(rootWs().allowBuilds).toEqual({ esbuild: true, sharp: true });
    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('only allows allowBuilds packages whose value is true', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['allowBuilds:', '  esbuild: true', '  puppeteer: false', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild']);
    // explicit false preserved in the map.
    expect(rootWs().allowBuilds).toEqual({ esbuild: true, puppeteer: false });
  });

  it('unions allowBuilds with an existing onlyBuiltDependencies array', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['onlyBuiltDependencies:', '  - esbuild', 'allowBuilds:', '  esbuild: true', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    expect(rootWs().allowBuilds).toEqual({ esbuild: true, sharp: true });
  });
});

/**
 * `packageManager` is a TOP-LEVEL package.json field read by Corepack, so unlike the
 * pnpm block above its hoist destination is the root package.json. Only the root pin
 * governs the install; one left behind in projects/app makes
 * `cd projects/app && pnpm run build` provision a different pnpm than the root used.
 */
/**
 * The reasons must survive the hoist, not just the values.
 *
 * Every entry in `pnpm-workspace.yaml` is there because something would otherwise
 * break, and several of them look WRONG on sight — `'msgpackr-extract': false`
 * denies a build for a package `pnpm why` cannot find, because it enters through
 * an optional peer that only exists in vendor mode. The starter carries twenty
 * lines saying exactly that, ending in "deleting this stops the first install of
 * every new project".
 *
 * `js-yaml`'s `dump()` writes values and nothing else, so those twenty lines used
 * to stop at the repo boundary: the generated project inherited the trap and none
 * of the warning, and its maintainer is precisely the person who cannot read the
 * source repo. A tidy-minded cleanup then removes the entry, and the next
 * `pnpm install` fails on something with no visible connection to the deletion.
 */
describe('hoistWorkspacePnpmConfig — comment preservation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-comments-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
    filesystem.write(`${tempDir}/package.json`, JSON.stringify({ name: 'root' }));
    filesystem.write(`${tempDir}/pnpm-workspace.yaml`, 'packages:\n  - projects/*\n');
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.write(`${tempDir}/projects/api/package.json`, JSON.stringify({ name: 'api' }));
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) filesystem.remove(tempDir);
  });

  const hoist = (): void => {
    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
  };
  const rootText = (): string => filesystem.read(`${tempDir}/pnpm-workspace.yaml`) || '';

  const SUB_WS = [
    'allowBuilds:',
    '  # Do NOT delete this as a dead entry — bullmq is an optional peer and only',
    '  # becomes real in vendor mode, where it pulls msgpackr-extract in.',
    "  'msgpackr-extract': false",
    '  bcrypt: true',
    '',
  ].join('\n');

  it('carries an entry comment from the sub-project into the root file', () => {
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, SUB_WS);
    hoist();
    expect(rootText()).toContain('# Do NOT delete this as a dead entry');
  });

  it('attaches the comment to the right key, even after re-quoting and re-sorting', () => {
    // The dump re-emits `'msgpackr-extract'` unquoted and sorts the map, so a
    // naive line-offset carry-over would land the block on `bcrypt`.
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, SUB_WS);
    hoist();
    const lines = rootText().split('\n');
    const noteAt = lines.findIndex((l) => l.includes('Do NOT delete'));
    const keyAt = lines.findIndex((l) => /msgpackr-extract['"]?:/.test(l));
    expect(noteAt).toBeGreaterThanOrEqual(0);
    expect(keyAt).toBeGreaterThan(noteAt);
    // Nothing but the rest of the same block may sit between them.
    expect(lines.slice(noteAt, keyAt).every((l) => l.trim().startsWith('#'))).toBe(true);
  });

  it("keeps the root's own wording when both files annotate the same key", () => {
    filesystem.write(
      `${tempDir}/pnpm-workspace.yaml`,
      "packages:\n  - projects/*\nallowBuilds:\n  # Root decided this deliberately.\n  bcrypt: true\n",
    );
    filesystem.write(
      `${tempDir}/projects/api/pnpm-workspace.yaml`,
      'allowBuilds:\n  # Sub-project wording.\n  bcrypt: true\n  esbuild: true\n',
    );
    hoist();
    expect(rootText()).toContain('# Root decided this deliberately.');
    expect(rootText()).not.toContain('# Sub-project wording.');
  });

  it('does not duplicate comments when the hoist runs again', () => {
    // `lt fullstack add-api` on an existing workspace re-runs the hoist over an
    // ALREADY-annotated root file. Stuttering blocks would grow it every time.
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, SUB_WS);
    hoist();
    const first = rootText();
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, SUB_WS);
    hoist();
    const occurrences = (rootText().match(/Do NOT delete this as a dead entry/g) || []).length;
    expect(occurrences).toBe(1);
    expect(rootText()).toBe(first);
  });

  it('reattaching over already-annotated YAML is a no-op', () => {
    // The test above CANNOT see the idempotency guard: the second hoist finds
    // nothing to move, short-circuits on `rootChanged === false`, and never
    // re-enters `reattachKeyComments` at all. It asserted a property that held
    // before the guard existed. This one drives the helper directly — with the
    // guard removed it produces a doubled comment block.
    const comments = extractKeyComments("allowBuilds:\n  # why\n  'a-b': false\n");
    const once = reattachKeyComments('allowBuilds:\n  a-b: false\n', comments);
    expect(once).toContain('# why');
    expect(reattachKeyComments(once, comments)).toBe(once);
  });

  it('does not harvest comments from keys nested one level deeper', () => {
    // The neighbouring list-item fixture is rejected one branch EARLIER (a `- x`
    // line never matches the entry regex), so it never reaches the depth guard it
    // claims to test — removing the guard left every test green. A nested MAP is
    // what actually exercises it.
    const nested = 'overrides:\n  a: 1\n  nested:\n    # inner note\n    b: 2\n';
    expect([...extractKeyComments(nested).keys()]).toEqual([]);

    // Control, so the assertion above cannot pass merely because nothing is ever
    // harvested: the SAME comment one level up IS taken.
    const topLevel = 'overrides:\n  # outer note\n  a: 1\n';
    expect([...extractKeyComments(topLevel).keys()]).toHaveLength(1);
  });

  it('keeps two keys apart even when one contains a space', () => {
    // Why the separator is `\0` and not a space: `overrides` selectors legally
    // contain spaces. With a space separator, `overrides` + `a b` and `overrides a`
    // + `b` collapse onto one entry — one override's reasoning silently attached
    // to another's.
    const comments = extractKeyComments(
      "overrides:\n  # range note\n  'minimatch@>=5.0.0 <10.2.6': 10.2.6\n",
    );
    expect([...comments.keys()]).toEqual(['overrides\u0000minimatch@>=5.0.0 <10.2.6']);
    const out = reattachKeyComments("overrides:\n  'minimatch@>=5.0.0 <10.2.6': 10.2.6\n", comments);
    expect(out).toContain('# range note');
  });

  it('still produces valid YAML that parses back to the same values', () => {
    filesystem.write(`${tempDir}/projects/api/pnpm-workspace.yaml`, SUB_WS);
    hoist();
    const parsed: any = load(rootText());
    expect(parsed.allowBuilds).toEqual({ bcrypt: true, 'msgpackr-extract': false });
  });
});

describe('extractKeyComments / reattachKeyComments', () => {
  it('ignores a block separated from its key by a blank line', () => {
    // Such a block is a section header. Re-attaching it would move a heading onto
    // whichever entry happened to sort first — a confident, wrong explanation.
    const comments = extractKeyComments('allowBuilds:\n  # Section heading.\n\n  bcrypt: true\n');
    expect(comments.size).toBe(0);
  });

  it('does not harvest from fields it has no business rewriting', () => {
    const comments = extractKeyComments('somethingElse:\n  # note\n  key: true\n');
    expect(comments.size).toBe(0);
  });

  it('treats quoted and unquoted spellings of a key as the same key', () => {
    const comments = extractKeyComments("allowBuilds:\n  # note\n  'a-b': false\n");
    expect(reattachKeyComments('allowBuilds:\n  a-b: false\n', comments)).toContain('# note');
  });

  it('drops a comment carrying a control character instead of re-emitting it', () => {
    // A bare CR is not a line break to `split('\n')` but IS one to every YAML
    // parser, so everything after it is re-emitted as real YAML. Verified against
    // pnpm 11: this exact block installs `left-pad: 9.9.9` as a workspace-wide
    // `overrides` entry in the generated project, while the line still looks like
    // an ordinary comment in an editor.
    const poisoned = 'overrides:\n  # rationale for the pin\r  left-pad: 9.9.9\n  semver: 7.8.5\n';
    expect([...extractKeyComments(poisoned).keys()]).toEqual([]);

    const out = reattachKeyComments('overrides:\n  semver: 7.8.5\n', extractKeyComments(poisoned));
    expect(out).not.toContain('left-pad');
    expect(load(out) as any).toEqual({ overrides: { semver: '7.8.5' } });
  });

  it('still carries an ordinary comment (the control-char guard is not a blanket)', () => {
    const clean = 'overrides:\n  # a normal reason\n  semver: 7.8.5\n';
    expect([...extractKeyComments(clean).keys()]).toHaveLength(1);
  });

  it('is a no-op when there is nothing to reattach', () => {
    const yaml = 'allowBuilds:\n  bcrypt: true\n';
    expect(reattachKeyComments(yaml, new Map())).toBe(yaml);
  });

  it('leaves nested list items alone', () => {
    // `auditConfig.ignoreGhsas` entries sit one level deeper; their comments belong
    // to the inner key, which this pass deliberately does not carry.
    const comments = extractKeyComments('auditConfig:\n  ignoreGhsas:\n    # why\n    - GHSA-x\n');
    expect([...comments.keys()]).toEqual([]);
  });
});

describe('hoistPackageManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-hoist-pm-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  const writeJson = (path: string, data: unknown): void => {
    filesystem.write(path, JSON.stringify(data, null, 2) + '\n');
  };
  const readJson = (path: string): any => JSON.parse(filesystem.read(path) || '{}');

  const PIN_11_13_1 = 'pnpm@11.13.1+sha512.b2fc7683b8a6525414e7d13e1ba28caaddde96bf66ec540bfaeb7e702b81f3e0';

  it('hoists a sub-project pin to a root that has none and strips the sub-project', () => {
    writeJson(`${tempDir}/package.json`, { engines: { pnpm: '^11.0.0' }, name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe(PIN_11_13_1);
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBeUndefined();
    // Unrelated root fields survive.
    expect(readJson(`${tempDir}/package.json`).engines).toEqual({ pnpm: '^11.0.0' });
  });

  it('keeps the highest version across sub-projects and root, incl. integrity hash', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root', packageManager: 'pnpm@11.2.0' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', packageManager: 'pnpm@11.9.0' });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe(PIN_11_13_1);
    expect(readJson(`${tempDir}/projects/api/package.json`).packageManager).toBeUndefined();
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBeUndefined();
  });

  it('does not downgrade a newer root pin, but still strips the sub-projects', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root', packageManager: 'pnpm@11.20.0' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: 'pnpm@11.4.0' });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe('pnpm@11.20.0');
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBeUndefined();
  });

  it('compares versions numerically, not lexically (11.9.0 < 11.13.1)', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', packageManager: 'pnpm@11.9.0' });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: 'pnpm@11.13.1' });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe('pnpm@11.13.1');
  });

  it('leaves everything untouched when the managers differ', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', packageManager: 'yarn@4.6.0' });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBeUndefined();
    expect(readJson(`${tempDir}/projects/api/package.json`).packageManager).toBe('yarn@4.6.0');
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBe(PIN_11_13_1);
  });

  it('is a no-op when no sub-project carries a pin', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app' });
    const rootBefore = filesystem.read(`${tempDir}/package.json`);

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.read(`${tempDir}/package.json`)).toBe(rootBefore);
  });

  it('is idempotent', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });
    const rootAfterFirst = filesystem.read(`${tempDir}/package.json`);
    const appAfterFirst = filesystem.read(`${tempDir}/projects/app/package.json`);

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.read(`${tempDir}/package.json`)).toBe(rootAfterFirst);
    expect(filesystem.read(`${tempDir}/projects/app/package.json`)).toBe(appAfterFirst);
  });

  it('skips a symlinked sub-project without mutating its source tree', () => {
    const realFs = require('fs');
    const realApp = `${tempDir}/external-app`;
    filesystem.dir(realApp);
    writeJson(`${realApp}/package.json`, { name: 'app', packageManager: PIN_11_13_1 });
    filesystem.dir(`${tempDir}/projects`);
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    realFs.symlinkSync(realApp, `${tempDir}/projects/app`);

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    // The user's own checkout keeps its pin; nothing hoisted.
    expect(readJson(`${realApp}/package.json`).packageManager).toBe(PIN_11_13_1);
    expect(readJson(`${tempDir}/package.json`).packageManager).toBeUndefined();
  });

  it('tolerates a missing sub-project dir', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });

    expect(() =>
      hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/does-not-exist'] }),
    ).not.toThrow();
  });
});
