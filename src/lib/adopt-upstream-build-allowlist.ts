import type { GluegunFilesystem } from 'gluegun';

import { dump, load } from 'js-yaml';

import { isSymlink } from './fs-utils';
import { extractKeyComments, reattachKeyComments } from './hoist-workspace-pnpm-config';

/**
 * Carry the framework's build-script allowlist into a project that has just
 * vendored it.
 *
 * `allowBuilds` decides which packages may run install scripts. pnpm 11 does not
 * treat an unlisted one as "deny" — it ABORTS the install with
 * `ERR_PNPM_IGNORED_BUILDS` and writes a `set this to true or false` placeholder
 * into the workspace file. So a single missing entry is not a hardening gap; it
 * is a project that cannot be installed at all, on the very first
 * `lt fullstack init`, before anyone has written a line of code.
 *
 * Vendoring is exactly where that gap opens. The conversion resolves the core's
 * import closure into DIRECT dependencies — `import('bullmq')` in
 * core-cron-jobs.service.ts becomes a real `bullmq` dep, which pulls
 * `msgpackr` → `msgpackr-extract`, a package with an install script. nest-server
 * knows about it and lists it. The project does not, and cannot: nest-server's
 * `pnpm-workspace.yaml` is not part of its npm tarball — `files` ships `dist`,
 * `src`, `bin` and the docs, never a repo-root config file — so nothing
 * downstream can read it. Until now the only bridge was a
 * human copying entries into nest-server-starter by hand — and that bridge has
 * already been observed to rot: `@scarf/scarf` sat at `true` in the starter while
 * the framework denied it, for long enough that the drift shipped.
 *
 * Deliberately additive. A key the project has already decided is left exactly as
 * it is, including an explicit `false`: the project is the more specific context,
 * and silently flipping its decision to match the framework would be a worse bug
 * than the one this fixes. Only genuinely absent keys are taken over — together
 * with the comment that explains them, because an entry like
 * `'msgpackr-extract': false` reads as dead weight without it and gets deleted by
 * the next person who runs `pnpm why`.
 *
 * @returns the keys actually adopted, for the caller to report.
 */
export function adoptUpstreamBuildAllowlist(options: {
  /** Project root holding the `pnpm-workspace.yaml` to extend. */
  dest: string;
  filesystem: GluegunFilesystem;
  /** Raw text of the framework's own `pnpm-workspace.yaml`, snapshotted before the clone is removed. */
  upstreamWorkspaceYaml: string;
}): string[] {
  const { dest, filesystem, upstreamWorkspaceYaml } = options;
  if (!upstreamWorkspaceYaml) return [];

  const upstream = parseYamlObject(upstreamWorkspaceYaml);
  const upstreamAllow = asStringBoolMap(upstream?.allowBuilds);
  if (Object.keys(upstreamAllow).length === 0) return [];

  // Never write through a symlinked project: with `--api-link` it points at the
  // user's own nest-server-starter checkout, and this would edit their repo. The
  // same guard already protects `hoistWorkspacePnpmConfig` and
  // `removeNestedLockfiles`; these two libs were the odd ones out.
  if (isSymlink(dest)) return [];

  const destPath = `${dest}/pnpm-workspace.yaml`;
  // No file to extend means no pnpm settings of the project's own. Writing one
  // here would invent a workspace root the scaffolding did not ask for, so the
  // absence is respected rather than filled in.
  if (!filesystem.exists(destPath)) return [];

  const destRaw = filesystem.read(destPath) ?? '';
  const destWs = parseYamlObject(destRaw);
  if (!destWs) return [];

  // The project's map is read RAW, not through `asStringBoolMap`. Narrowing it to
  // booleans first was a live deny-bypass with no attacker involved: js-yaml 4
  // uses the YAML 1.2 core schema, so `esbuild: no` and `esbuild: off` parse as
  // STRINGS. A maintainer writing `no` to mean "deny" was read as "no opinion",
  // upstream's `true` was adopted, and the original entry was dropped from the
  // rewritten map as well. Same for `'false'`, for an empty value (null), and for
  // pnpm's own `set this to true or false` placeholder — all five verified.
  //
  // `Object.create(null)` and `hasOwnProperty.call`: with a plain object,
  // `'constructor' in map` is true via the prototype, so eight real package names
  // ('constructor', 'toString', 'valueOf', …) would be treated as already decided
  // and silently never adopted — the ERR_PNPM_IGNORED_BUILDS abort this whole
  // function exists to prevent.
  const merged: Record<string, unknown> = Object.assign(Object.create(null), asRawMap(destWs.allowBuilds));
  const adopted: string[] = [];
  for (const [pkg, value] of Object.entries(upstreamAllow)) {
    // ANY existing key is a decision, whatever shape YAML gave it.
    if (Object.prototype.hasOwnProperty.call(merged, pkg)) continue;
    merged[pkg] = value;
    adopted.push(pkg);
  }
  if (adopted.length === 0) return [];

  destWs.allowBuilds = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));

  // The project's own annotations win where both files comment the same key; the
  // upstream ones fill in only for the keys just adopted, which by definition the
  // project had nothing to say about.
  const comments = extractKeyComments(destRaw);
  for (const [key, block] of extractKeyComments(upstreamWorkspaceYaml)) {
    if (!comments.has(key)) comments.set(key, block);
  }

  filesystem.write(destPath, reattachKeyComments(dump(destWs, { lineWidth: -1, sortKeys: false }), comments));
  return adopted;
}

/** The value as a plain key/value map, or an empty one — no narrowing of values. */
function asRawMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Narrow an unknown value to a `{ pkg: boolean }` map, dropping other shapes.
 *
 * Used for the UPSTREAM side only. There, dropping a non-boolean is right — we
 * adopt only decisions we understand. On the DEST side it is the opposite: see
 * the comment at the merge above.
 */
function asStringBoolMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

/** Parse YAML into a plain object, or null on empty/malformed/non-object input. */
function parseYamlObject(raw: string): null | Record<string, unknown> {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch {
    // Malformed upstream YAML must not take the conversion down with it — the
    // vendored project is still usable, it just does not inherit the allowlist.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
