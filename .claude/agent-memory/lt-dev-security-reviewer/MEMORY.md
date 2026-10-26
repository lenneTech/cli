# Security Reviewer Memory

- [CLI-repo review scope](project_cli-repo-review-scope.md) — this repo is the CLI itself; audit CLI code + GENERATED config, not NestJS/Nuxt runtime patterns
- [CLI generated-file injection sinks](reference_cli-generated-file-injection.md) — where user/config values reach generated source/config (angular env, .turboops.json, .dockerignore, Caddyfile); validate before write
- [Gluegun flag parsing fails open](reference_gluegun-flag-parsing-fail-open.md) — yargs-parser makes `--flag=true` a STRING; strict `=== true` on a destruction-PREVENTING flag destroys data
- [spawnDetached sh -c exec is SAFE](reference_spawndetached-sh-exec-safe.md) — `sh -c 'ulimit…; exec "$0" "$@"'` binds cmd/args as positional params, not into the script; injection-safe, do not re-flag
- [heal\* overwrite family](reference_heal-overwrite-family.md) — `lt fullstack update` overwrites user files with no confirm/dry-run; its git-porcelain guard fails OPEN for non-git + gitignored; fixed `.lt-tmp` follows planted symlinks
- [npm reinit shell sinks are SAFE](reference_npm-reinit-shell-string-safe.md) — dir is now `{ cwd }`, ncu via spawnArgs; only pm-table literals reach a shell; do not re-flag
- [Regex lexing decides destruction](reference_regex-lexing-decides-destruction.md) — regex "is this code safe?" detectors gating an overwrite: guard vocabulary is a closed list, comment-stripping is not lexing
- [Bridge normaliser is not a boundary](reference_bridge-normaliser-not-a-boundary.md) — normaliseBridgeBlock leniency probed; only regex-literal edits slip through, committer-only; do not re-flag
- [Claude Code Bash rule matching](reference_claude-code-bash-rule-matching.md) — `*` = `.*` crossing `../`; `:*` literal prefix; auto mode keeps `node /abs/*` rules
- [Shell-sink facts](reference_shell-sink-facts.md) — git refs allow `;|&$()`; safeRef is option-guard only; cross-spawn double-escapes only node_modules\.bin shims
- [loadYaml (js-yaml 5) verified](reference_yaml-loader-js-yaml5.md) — CORE+mergeTag: no __proto__ pollution through lodash merge, merge-key limits active; do not re-flag
- [convert-esm trust boundary](reference_convert-esm-trust-boundary.md) — verify sh -c of nodemon exec + node -e import of specifiers run project code by design; do not re-flag
