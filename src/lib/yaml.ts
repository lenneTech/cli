import { CORE_SCHEMA, loadAll, mergeTag, YAMLException } from 'js-yaml';

/**
 * YAML 1.2 core plus merge keys: the schema js-yaml 4 loaded by default.
 *
 * Core and not YAML 1.1 on purpose: `esbuild: no` / `off` have to stay STRINGS,
 * because the allowBuilds deny logic reads them that way
 * (`adopt-upstream-build-allowlist.ts`, `hoist-workspace-pnpm-config.ts`).
 * js-yaml 5 ships the core schema WITHOUT `!!merge`, so a `<<: *defaults` in an
 * lt.config.yaml or a pnpm-workspace.yaml would arrive as a literal `'<<'` key,
 * while pnpm itself resolves it when it reads the same file.
 */
const LOAD_SCHEMA = CORE_SCHEMA.withTags(mergeTag);

/**
 * Parse one YAML document with the semantics js-yaml 4's `load()` had.
 *
 * js-yaml 5's `load()` throws on a source without a document: an empty file, or
 * a pnpm-workspace.yaml whose every setting is commented out. 4.x returned
 * `undefined` / `null` there, and every call site reads that as "no content".
 * `loadAll` returns an empty list for those sources, which is mapped back here.
 * More than one document still throws, as it did in 4.x.
 *
 * Two 4.x behaviours are deliberately NOT carried over. A date stays a string:
 * 4.x built a `Date` from `2026-10-24`, and dumping the file back wrote
 * `2026-10-24T00:00:00.000Z`. The YAML 1.1 collection tags (`!!omap`, `!!pairs`,
 * `!!set`) throw. Neither has a use in lt.config.* or pnpm-workspace.yaml, the
 * files the CLI reads.
 *
 * Throws `YAMLException` on invalid YAML, like `load()`.
 */
export function loadYaml(content: string): unknown {
  const documents = loadAll(content, { schema: LOAD_SCHEMA });
  if (documents.length > 1) {
    throw new YAMLException('expected a single document in the stream, but found more');
  }
  if (documents.length === 0) {
    // 4.x: '' → undefined, whitespace or comments only → null.
    return content === '' ? undefined : null;
  }
  return documents[0];
}
