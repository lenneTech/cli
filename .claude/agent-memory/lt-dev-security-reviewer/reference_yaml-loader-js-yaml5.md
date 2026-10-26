---
name: yaml-loader-js-yaml5
description: Verified security behaviour of src/lib/yaml.ts#loadYaml (js-yaml 5, CORE_SCHEMA + mergeTag) for lt.config.yaml / pnpm-workspace.yaml from untrusted repos
metadata:
  type: reference
---

Measured 2026-10-25 against js-yaml 5.5.0 with the CLI's own schema (`CORE_SCHEMA.withTags(mergeTag)`):

- **No prototype pollution.** `__proto__:` (top-level, nested, and via `<<: *anchor`) becomes an
  OWN property; the parsed object keeps `Object.prototype`. Fed through `config.ts#mergeConfigs`
  (lodash 4.18 `mergeWith`), `({}).x` stays undefined; `constructor.prototype` likewise.
- **Merge-key limits stay active** with the custom schema, because `mergeTag` is the library's
  own: a 12-level x50 merge chain throws `maxTotalMergeKeys (10000)` in ~13 ms; 200k empty
  merge sources throw `abnormal merge sequence size`.
- No `!!js/*`, `!!binary`, `!!timestamp` tags (throw); dates stay strings.

**How to apply:** do not re-flag YAML parsing as pollution/billion-laughs unless the schema or
the downstream merge changes (a hand-written `target[key] = …` recursive merge would need a
fresh look). See [[cli-repo-review-scope]].
