import type { GluegunFilesystem } from 'gluegun';

import { dump, load } from 'js-yaml';

import { isSymlink } from './fs-utils';

/**
 * pnpm workspace-scoped fields that must live at the workspace root.
 * When present in sub-project package.json files, pnpm emits:
 *
 *   WARN  The field "<field>" was found in <path>. This will not take
 *   effect. You should configure "<field>" at the root of the workspace
 *   instead.
 *
 * Crucially, the WARN also means the values are silently ignored — CVE
 * overrides defined only in projects/api/package.json never reach the
 * install resolver. Hoisting them to the root fixes both the warning
 * and the actual dependency-resolution behavior.
 *
 * Object-valued fields (`overrides`, `allowBuilds`) merge key-by-key;
 * array-valued fields union + dedupe + sort. `minimumReleaseAgeExclude`
 * is hoisted too so a sub-project's first-party exemption (e.g.
 * `@lenne.tech/*`) keeps working in the monorepo — otherwise the
 * minimum-release-age gate would block freshly published own packages.
 *
 * `auditConfig` is nested (`{ ignoreGhsas: [...], ignoreCves: [...] }`), so it
 * needs a one-level-deeper merge than the flat object fields. It MUST be hoisted:
 * the CI audit job is deploy-blocking, and a settings-only sub-workspace file is
 * deleted after hoisting (see hoistFromSubWorkspaceYaml). Without this the
 * starter's assessed-advisory allowlist is destroyed rather than merely ignored,
 * and the generated project's very first pipeline goes red on an advisory that
 * was already justified upstream.
 */
const OBJECT_FIELDS = ['overrides', 'allowBuilds'] as const;
const ARRAY_FIELDS = ['onlyBuiltDependencies', 'ignoredOptionalDependencies', 'minimumReleaseAgeExclude'] as const;
/** Objects whose values are arrays to be unioned, not replaced. */
const NESTED_ARRAY_FIELDS = ['auditConfig'] as const;

/** The union of all three, in declaration order. Declared here, with its inputs,
 * because the comment-carrying helpers below default their `fields` parameter to it. */
const WORKSPACE_SCOPED_PNPM_FIELDS = [...OBJECT_FIELDS, ...ARRAY_FIELDS, ...NESTED_ARRAY_FIELDS] as const;

/**
 * Comment blocks harvested from the source files, keyed `<field>\0<key>`.
 *
 * `js-yaml`'s `dump()` writes values and nothing else, so every hoist used to
 * arrive in the generated project as a bare list of entries with their reasons
 * stripped. That is not cosmetic. The whole point of the entries in
 * `pnpm-workspace.yaml` is that they look wrong: `'msgpackr-extract': false`
 * denies a build for a package `pnpm why` cannot even find (it enters through an
 * optional peer), and the starter carries twenty lines explaining why deleting it
 * breaks the first install of every new project. Those twenty lines are exactly
 * what did not survive — so the generated project shows the trap without the
 * warning, to the one audience that has no access to the source repo.
 *
 * Carried textually rather than through a comment-preserving YAML library: the
 * merge below normalises, unions and sorts across three source documents, and an
 * AST round-trip would have to answer which of two conflicting comments wins for
 * every merged key. Lifting the block that sits directly above a key and
 * re-attaching it to the same key is the part that actually carries the meaning.
 */
type KeyComments = Map<string, string>;

/**
 * Separator for the composite map key.
 *
 * `\0` rather than a space, because a YAML mapping key may legally contain
 * spaces — `overrides` selectors like `minimatch@>=5.0.0 <10.2.6` do — and a
 * space would let two different (field, key) pairs collide on one entry,
 * silently attaching one entry's reasoning to another's. Written as an escape
 * rather than a literal control character: a raw NUL in the source makes git
 * treat this file as binary, which costs every future reviewer the diff.
 */
const KEY_SEPARATOR = '\0';

/**
 * Control characters that must never survive into an emitted YAML comment.
 *
 * Everything below U+0020 except TAB (U+0009) and LF (U+000A) — CR included,
 * deliberately: it is the one that reads as whitespace and parses as a line
 * break. LF cannot appear here (the harvest splits on it) and TAB is harmless.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/;

const commentKey = (field: string, key: string): string => `${field}${KEY_SEPARATOR}${key}`;

/**
 * Comment blocks attached to the entries of each top-level mapping in `raw`.
 *
 * Only contiguous `#` lines DIRECTLY above an entry are taken, and a blank line
 * ends the block — a comment separated from a key by an empty line belongs to the
 * section, not to that key, and re-attaching it would silently move a section
 * header onto whichever entry happened to come first.
 */
export function extractKeyComments(raw: string, fields: readonly string[] = WORKSPACE_SCOPED_PNPM_FIELDS): KeyComments {
  const out: KeyComments = new Map();
  if (!raw) return out;
  const lines = raw.split('\n');

  let field: null | string = null;
  let fieldIndent = 0;
  let pending: string[] = [];

  for (const line of lines) {
    const topLevel = /^([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (topLevel) {
      field = fields.includes(topLevel[1]) ? topLevel[1] : null;
      fieldIndent = 0;
      pending = [];
      continue;
    }
    if (field === null) continue;

    if (/^\s*$/.test(line)) {
      pending = [];
      continue;
    }
    const indent = line.search(/\S/);
    // Back at column 0 → the mapping is over (a new top-level key or a list item).
    if (indent === 0) {
      field = null;
      pending = [];
      continue;
    }
    if (/^\s*#/.test(line)) {
      // A bare CR is NOT a line break to `String.split('\n')` but IS one to every
      // YAML parser. So a comment containing one is re-emitted verbatim, and
      // everything after the CR becomes real YAML at a column of its author's
      // choosing. Verified against pnpm 11: a comment carrying
      // `\r  left-pad: 9.9.9` installs as a workspace-wide `overrides` entry —
      // an arbitrary version force in every generated project — while the line
      // still renders as an ordinary comment in editors and diffs.
      //
      // Dropping the whole block is the right response rather than sanitising it:
      // a rationale nobody can read is worth less than the risk of guessing what
      // the author meant.
      if (CONTROL_CHARS.test(line)) {
        pending = [];
        continue;
      }
      pending.push(line.trimStart());
      continue;
    }
    const entry = /^\s*((?:'[^']*')|(?:"[^"]*")|(?:[^\s:#][^:]*?))\s*:/.exec(line);
    if (!entry) {
      pending = [];
      continue;
    }
    // Nested deeper than the first entry level (e.g. `auditConfig.ignoreGhsas`
    // items) — the block belongs to the inner key, which this pass does not carry.
    if (fieldIndent === 0) fieldIndent = indent;
    if (indent === fieldIndent && pending.length) {
      out.set(commentKey(field, unquoteYamlKey(entry[1])), pending.join('\n'));
    }
    pending = [];
  }

  return out;
}

/**
 * Put the harvested comment blocks back above their keys in dumped YAML.
 *
 * A key whose comment is already present is left alone, so re-running the hoist
 * over an already-annotated file is idempotent rather than stuttering.
 */
export function reattachKeyComments(
  yaml: string,
  comments: KeyComments,
  fields: readonly string[] = WORKSPACE_SCOPED_PNPM_FIELDS,
): string {
  if (comments.size === 0) return yaml;
  const lines = yaml.split('\n');
  const out: string[] = [];

  let field: null | string = null;
  let fieldIndent = 0;

  for (const line of lines) {
    const topLevel = /^([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (topLevel) {
      field = fields.includes(topLevel[1]) ? topLevel[1] : null;
      fieldIndent = 0;
      out.push(line);
      continue;
    }

    if (field !== null && !/^\s*$/.test(line)) {
      const indent = line.search(/\S/);
      if (indent === 0) {
        field = null;
      } else {
        const entry = /^\s*((?:'[^']*')|(?:"[^"]*")|(?:[^\s:#][^:]*?))\s*:/.exec(line);
        if (entry) {
          if (fieldIndent === 0) fieldIndent = indent;
          if (indent === fieldIndent) {
            const block = comments.get(commentKey(field, unquoteYamlKey(entry[1])));
            // `out[out.length - 1]`, not `.at(-1)`: this project's tsconfig lib
            // predates ES2022.
            const already = (out[out.length - 1] ?? '').trim().startsWith('#');
            // Second gate on purpose: harvest is one source of blocks today, and a
            // control character reaching the emitted file is the whole exploit.
            if (block && !already && !CONTROL_CHARS.test(block)) {
              const pad = ' '.repeat(indent);
              out.push(...block.split('\n').map((l) => `${pad}${l}`));
            }
          }
        }
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

/** `'msgpackr-extract'` / `"foo"` / `foo` all denote the same mapping key. */
function unquoteYamlKey(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

/** Provenance note written above a hoisted `auditConfig` — see `annotateAuditConfig`. */
const AUDIT_CONFIG_NOTE =
  '# Hoisted from the sub-projects by the lt CLI. These advisory suppressions now\n' +
  '# apply to EVERY package in this workspace, not just the one that justified\n' +
  '# them — review before adding, and drop entries once the advisory is fixed.';
type PnpmConfigField = (typeof WORKSPACE_SCOPED_PNPM_FIELDS)[number];

const isArrayField = (field: PnpmConfigField): boolean => (ARRAY_FIELDS as readonly string[]).includes(field);

const isNestedArrayField = (field: PnpmConfigField): boolean =>
  (NESTED_ARRAY_FIELDS as readonly string[]).includes(field);

interface PackageJson {
  [k: string]: unknown;
  packageManager?: string;
  pnpm?: Record<string, unknown>;
}

/**
 * Hoist the Corepack `packageManager` pin from sub-projects into the monorepo
 * root `package.json`, keeping the highest version and stripping the pin from
 * every sub-project.
 *
 * Unlike the fields above this is a TOP-LEVEL package.json field (not part of the
 * `pnpm` block), and its destination is the root `package.json` — not
 * `pnpm-workspace.yaml` — because Corepack, not pnpm, reads it. Hence its own pass.
 *
 * Why it must not stay in a sub-project: inside a workspace only the ROOT pin governs
 * `pnpm install`. A pin left in `projects/app` is worse than inert — Corepack resolves
 * the NEAREST package.json, so `cd projects/app && pnpm run build` (exactly what
 * projects/app/Dockerfile does) provisions the sub-project's pnpm while the root
 * install ran on another version. One build, two pnpm versions.
 *
 * Why the root needs a pin at all: without `packageManager`, Corepack silently
 * downloads the LATEST pnpm from the registry (verified with an isolated cache, i.e.
 * a fresh container). Together with the root `engines.pnpm: "^11.0.0"` shipped by
 * lt-monorepo, that breaks the day pnpm 12 is released — pnpm enforces `engines.pnpm`
 * hard (`ERR_PNPM_UNSUPPORTED_ENGINE`), so the Docker build dies without a single
 * repo change. The starters carry an exact pin incl. integrity hash
 * (`pnpm@11.13.1+sha512.…`, maintained via `corepack up`); hoisting it preserves both
 * the determinism and the supply-chain check.
 *
 * Mixed package managers (e.g. api pinning yarn, app pinning pnpm) are left untouched
 * rather than silently picking a winner — that is a template bug, not something to
 * paper over.
 *
 * Idempotent: running twice has the same effect as running once.
 *
 * @param options.filesystem  Gluegun filesystem tool
 * @param options.projectDir  Workspace root (contains the root package.json)
 * @param options.subProjects Sub-project dirs relative to projectDir
 */
export function hoistPackageManager(options: {
  filesystem: GluegunFilesystem;
  projectDir: string;
  subProjects: string[];
}): void {
  const { filesystem, projectDir, subProjects } = options;
  const rootPkgPath = `${projectDir}/package.json`;
  const rootPkg = filesystem.exists(rootPkgPath) ? (filesystem.read(rootPkgPath, 'json') as null | PackageJson) : null;
  if (!rootPkg) return;

  const candidates: string[] = [];
  const strippedSubs: { path: string; pkg: PackageJson }[] = [];

  for (const subDir of subProjects) {
    const subPath = `${projectDir}/${subDir}`;
    if (!filesystem.exists(subPath)) continue;
    // Never mutate a symlinked sub-project — it points at the user's own checkout.
    if (isSymlink(subPath)) continue;

    const subPkgPath = `${subPath}/package.json`;
    if (!filesystem.exists(subPkgPath)) continue;
    const subPkg = filesystem.read(subPkgPath, 'json') as null | PackageJson;
    if (typeof subPkg?.packageManager !== 'string') continue;

    candidates.push(subPkg.packageManager);
    strippedSubs.push({ path: subPkgPath, pkg: subPkg });
  }

  if (candidates.length === 0) return;

  const rootPin = typeof rootPkg.packageManager === 'string' ? rootPkg.packageManager : undefined;
  const all = rootPin ? [rootPin, ...candidates] : candidates;

  // Bail out on mixed managers instead of guessing which one is authoritative.
  const names = new Set(all.map(pmName));
  if (names.size > 1) return;

  const winner = all.reduce((best, pin) => (comparePmVersions(pin, best) > 0 ? pin : best));

  if (rootPin !== winner) {
    rootPkg.packageManager = winner;
    filesystem.write(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
  }
  for (const { path, pkg } of strippedSubs) {
    delete pkg.packageManager;
    filesystem.write(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

/**
 * Hoist workspace-scoped pnpm config from sub-projects into the monorepo
 * root `pnpm-workspace.yaml`. After this runs, sub-project pnpm config
 * (package.json#pnpm or a settings-only pnpm-workspace.yaml) is gone, and
 * the root pnpm-workspace.yaml carries the merged union next to `packages:`.
 *
 * Why pnpm-workspace.yaml and not package.json#pnpm: the monorepo runs
 * pnpm 11 (lt-monorepo ships `engines.pnpm: "^11.0.0"`; the exact version
 * comes from the `packageManager` pin that `hoistPackageManager` lifts to
 * the root), and pnpm 11 SILENTLY IGNORES the
 * `pnpm` block in package.json — overrides/build-allowlists/etc. declared
 * there never take effect, regressing `pnpm audit` and the minimum-release
 * -age exemptions. pnpm-workspace.yaml is the pnpm-recommended home and is
 * read by both pnpm 10 and 11.
 *
 * Two sources are read per sub-project, because the two starters store
 * their pnpm config differently:
 *
 *   1. `<sub>/package.json` `pnpm` block — nest-server-starter, and any
 *      template that has not migrated to the pnpm-11 layout yet.
 *   2. `<sub>/pnpm-workspace.yaml` — nuxt-base-template (pnpm-11 layout).
 *      Inside a monorepo that nested file would (a) not be hoisted if we
 *      only read package.json, regressing the CVE overrides, and (b)
 *      declare a nested workspace root that conflicts with the monorepo's
 *      own pnpm-workspace.yaml. We hoist its fields into the root and
 *      remove the now-redundant nested file.
 *
 * Symlinked sub-projects are skipped entirely: in `--frontend-link` /
 * `--api-link` mode `projects/app` (or `projects/api`) points at the
 * user's local framework checkout, and stripping its config or deleting
 * its pnpm-workspace.yaml would corrupt that source repo.
 *
 * Idempotent: running twice has the same effect as running once.
 *
 * @param options.filesystem  Gluegun filesystem tool
 * @param options.projectDir  Workspace root (contains pnpm-workspace.yaml)
 * @param options.subProjects Sub-project dirs relative to projectDir
 */
export function hoistWorkspacePnpmConfig(options: {
  filesystem: GluegunFilesystem;
  projectDir: string;
  subProjects: string[];
}): void {
  const { filesystem, projectDir, subProjects } = options;
  const rootWsPath = `${projectDir}/pnpm-workspace.yaml`;

  // The root pnpm-workspace.yaml is the destination. It normally exists (the
  // lt-monorepo clone ships one declaring `packages:`); start from it so
  // `packages:` and any root-owned settings are preserved.
  const rootWs = readYaml(filesystem, rootWsPath) ?? {};

  // Why the reasons are harvested rather than regenerated: they are prose written
  // by whoever added the entry, and no rule can reconstruct them. The root's own
  // comments are collected FIRST so that where two sources annotate the same key,
  // the root's wording wins — it is the file a maintainer of THIS workspace edits.
  const comments: KeyComments = extractKeyComments(filesystem.read(rootWsPath) ?? '');

  let rootChanged = false;

  for (const subDir of subProjects) {
    const subPath = `${projectDir}/${subDir}`;
    if (!filesystem.exists(subPath)) continue;
    // Never mutate a symlinked sub-project — it points at the user's own
    // checkout in link mode.
    if (isSymlink(subPath)) continue;

    if (hoistFromSubPackageJson({ filesystem, rootWs, subPath })) {
      rootChanged = true;
    }
    if (hoistFromSubWorkspaceYaml({ comments, filesystem, rootWs, subPath })) {
      rootChanged = true;
    }
  }

  if (rootChanged) {
    // Keep allowBuilds (pnpm 11) and onlyBuiltDependencies (pnpm 10) in sync so
    // the build-script allowlist survives regardless of which key pnpm reads.
    syncBuildAllowlists(rootWs);
    const dumped = dump(rootWs, { lineWidth: -1, sortKeys: false });
    filesystem.write(rootWsPath, annotateAuditConfig(reattachKeyComments(dumped, comments)));
  }
}

/**
 * Mark a hoisted `auditConfig` as workspace-wide, in the file itself.
 *
 * `auditConfig.ignoreGhsas` / `.ignoreCves` are not ordinary settings — they
 * SUPPRESS vulnerability findings, and the CI audit job is deploy-blocking.
 * Hoisting changes their blast radius: an advisory a sub-project justified for
 * one dev-only transitive dep now also silences that same advisory when it turns
 * up in a sibling's RUNTIME tree, and pnpm's `auditConfig` has no expiry. That is
 * the correct trade (the alternative — deleting the settings-only sub file
 * unhoisted — destroys the allowlist and reddens the first pipeline), but it must
 * not be invisible.
 *
 * A comment in the YAML is where a reviewer actually looks: it survives in the
 * file, shows up in the `git diff` that introduces it, and needs no plumbing
 * through the void-returning scaffolding call chain.
 */
function annotateAuditConfig(yaml: string): string {
  if (!/^auditConfig:/m.test(yaml) || yaml.includes(AUDIT_CONFIG_NOTE)) {
    return yaml;
  }
  return yaml.replace(/^auditConfig:/m, `${AUDIT_CONFIG_NOTE}\nauditConfig:`);
}

/**
 * Compare the versions of two `packageManager` pins (`pnpm@11.13.1+sha512.…`).
 * Returns >0 if `a` is newer, <0 if older, 0 if equal. Numeric segment-wise
 * comparison; the integrity hash and any pre-release suffix are ignored, which is
 * enough for the exact pins Corepack writes (no ranges are legal here).
 */
function comparePmVersions(a: string, b: string): number {
  const segments = (pin: string): number[] =>
    pmVersion(pin)
      .split('.')
      .map((s) => Number.parseInt(s, 10) || 0);
  const av = segments(a);
  const bv = segments(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Move the workspace-scoped pnpm fields from `source` into `rootWs`,
 * deleting each moved field from `source`. Returns true if anything moved.
 */
function hoistFields(rootWs: Record<string, unknown>, source: Record<string, unknown>): boolean {
  let changed = false;
  for (const field of WORKSPACE_SCOPED_PNPM_FIELDS) {
    if (source[field] === undefined) continue;
    rootWs[field] = mergePnpmFieldValue(field, rootWs[field], source[field]);
    delete source[field];
    changed = true;
  }
  return changed;
}

/** Source 1: the sub-project's package.json `pnpm` block. */
function hoistFromSubPackageJson(options: {
  filesystem: GluegunFilesystem;
  rootWs: Record<string, unknown>;
  subPath: string;
}): boolean {
  const { filesystem, rootWs, subPath } = options;
  const subPkgPath = `${subPath}/package.json`;
  if (!filesystem.exists(subPkgPath)) return false;
  const subPkg = filesystem.read(subPkgPath, 'json') as null | PackageJson;
  if (!subPkg?.pnpm) return false;

  if (!hoistFields(rootWs, subPkg.pnpm)) return false;

  // If the sub-project's pnpm section is now empty, drop it entirely.
  if (Object.keys(subPkg.pnpm).length === 0) {
    delete subPkg.pnpm;
  }
  filesystem.write(subPkgPath, `${JSON.stringify(subPkg, null, 2)}\n`);
  return true;
}

/** Source 2: the sub-project's pnpm-workspace.yaml. */
function hoistFromSubWorkspaceYaml(options: {
  comments: KeyComments;
  filesystem: GluegunFilesystem;
  rootWs: Record<string, unknown>;
  subPath: string;
}): boolean {
  const { comments, filesystem, rootWs, subPath } = options;
  const subWsPath = `${subPath}/pnpm-workspace.yaml`;
  if (!filesystem.exists(subWsPath)) return false;

  const raw = filesystem.read(subWsPath) ?? '';
  const ws = readYaml(filesystem, subWsPath);
  if (!ws) return false;

  // Harvest BEFORE hoisting: this file is about to be deleted (or stripped of
  // exactly these keys), and with it the only copy of the reasoning. An entry
  // already annotated by the root keeps the root's wording.
  for (const [key, block] of extractKeyComments(raw)) {
    if (!comments.has(key)) comments.set(key, block);
  }

  if (!hoistFields(rootWs, ws)) return false;

  // A settings-only file (no `packages:`) exists solely to carry these
  // hoisted keys — once emptied it would only declare a nested workspace
  // root, so remove it. A file that declares `packages:` is a real (rare)
  // nested workspace; keep it minus the hoisted keys.
  if (Array.isArray(ws.packages) && ws.packages.length > 0) {
    filesystem.write(subWsPath, dump(ws, { lineWidth: -1, sortKeys: false }));
  } else {
    filesystem.remove(subWsPath);
  }
  return true;
}

/**
 * Merge two values for a pnpm workspace-scoped field.
 *
 * Arrays (`onlyBuiltDependencies`, `ignoredOptionalDependencies`,
 * `minimumReleaseAgeExclude`): deduplicated, alphabetically sorted union.
 *
 * Objects (`overrides`, `allowBuilds`): key-by-key merge where sub-project
 * values take precedence over root (sub-projects like nest-server-starter
 * own the authoritative CVE override list for their transitive deps; the
 * root usually only seeds cross-cutting patches).
 */
function mergePnpmFieldValue(field: PnpmConfigField, rootValue: unknown, subValue: unknown): unknown {
  if (isArrayField(field)) {
    const rootArr = Array.isArray(rootValue) ? (rootValue as string[]) : [];
    const subArr = Array.isArray(subValue) ? (subValue as string[]) : [];
    return Array.from(new Set([...rootArr, ...subArr])).sort((a, b) => a.localeCompare(b));
  }
  // Nested (`auditConfig.ignoreGhsas` / `.ignoreCves`): union each inner array
  // instead of letting the sub-project's object replace the root's. A plain
  // key-by-key merge would drop every advisory the root had already justified.
  if (isNestedArrayField(field)) {
    const asObj = (v: unknown): Record<string, unknown> =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const rootObj = asObj(rootValue);
    const subObj = asObj(subValue);
    const merged: Record<string, unknown> = { ...rootObj };
    for (const [key, value] of Object.entries(subObj)) {
      if (Array.isArray(value) || Array.isArray(merged[key])) {
        const a = Array.isArray(merged[key]) ? (merged[key] as string[]) : [];
        const b = Array.isArray(value) ? (value as string[]) : [];
        merged[key] = Array.from(new Set([...a, ...b])).sort((x, y) => x.localeCompare(y));
      } else {
        merged[key] = value;
      }
    }
    return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  }
  const rootObj =
    rootValue && typeof rootValue === 'object' && !Array.isArray(rootValue)
      ? (rootValue as Record<string, unknown>)
      : {};
  const subObj =
    subValue && typeof subValue === 'object' && !Array.isArray(subValue) ? (subValue as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = { ...rootObj, ...subObj };
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/** Extract the manager name from a pin (`pnpm@11.13.1+sha512.…` -> `pnpm`). */
function pmName(pin: string): string {
  return pin.slice(0, Math.max(0, pin.lastIndexOf('@'))) || pin;
}

/** Extract the bare version from a pin (`pnpm@11.13.1+sha512.…` -> `11.13.1`). */
function pmVersion(pin: string): string {
  const afterAt = pin.slice(pin.lastIndexOf('@') + 1);
  return afterAt.split('+')[0];
}

/** Parse a YAML file into a plain object, or null on missing/malformed/non-object. */
function readYaml(filesystem: GluegunFilesystem, path: string): null | Record<string, unknown> {
  if (!filesystem.exists(path)) return null;
  const raw = filesystem.read(path);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch {
    // Malformed YAML — leave it untouched rather than risk data loss.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Keep the two build-allowlist forms consistent and complete after hoisting:
 * - `allowBuilds` (pnpm 11) is a `{ pkg: boolean }` map.
 * - `onlyBuiltDependencies` (pnpm 10) is a `string[]` of allowed packages.
 *
 * Sub-templates carry one or both (nest-server-starter only `allowBuilds`,
 * nuxt-base-template both). After merging we derive the full set of allowed
 * packages from BOTH forms and write back canonical, sorted twins so the
 * allowlist survives whichever key the active pnpm version reads. Explicit
 * `false` entries in `allowBuilds` are preserved (and excluded from the
 * array). No-op when neither key is present. Mutates `ws` in place.
 */
function syncBuildAllowlists(ws: Record<string, unknown>): void {
  const arr = Array.isArray(ws.onlyBuiltDependencies) ? (ws.onlyBuiltDependencies as string[]) : [];
  const obj =
    ws.allowBuilds && typeof ws.allowBuilds === 'object' && !Array.isArray(ws.allowBuilds)
      ? (ws.allowBuilds as Record<string, unknown>)
      : {};
  if (arr.length === 0 && Object.keys(obj).length === 0) return;

  // Every array entry implies allowBuilds[entry] = true unless already set.
  const map: Record<string, boolean> = {};
  for (const [pkg, enabled] of Object.entries(obj)) map[pkg] = enabled === true;
  for (const pkg of arr) if (map[pkg] === undefined) map[pkg] = true;

  const allowed = Object.entries(map)
    .filter(([, enabled]) => enabled)
    .map(([pkg]) => pkg)
    .sort((a, b) => a.localeCompare(b));

  ws.allowBuilds = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  ws.onlyBuiltDependencies = allowed;
}
