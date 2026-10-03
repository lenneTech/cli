# Security Reviewer Memory

- [CLI-repo review scope](project_cli-repo-review-scope.md) — this repo is the CLI itself; audit CLI code + GENERATED config, not NestJS/Nuxt runtime patterns
- [CLI generated-file injection sinks](reference_cli-generated-file-injection.md) — where user/config values reach generated source/config (angular env, .turboops.json, .dockerignore); validate before write
- [Gluegun flag parsing fails open](reference_gluegun-flag-parsing-fail-open.md) — yargs-parser makes `--flag=true` a STRING; strict `=== true` on a destruction-PREVENTING flag destroys data
- [spawnDetached sh -c exec is SAFE](reference_spawndetached-sh-exec-safe.md) — `sh -c 'ulimit…; exec "$0" "$@"'` binds cmd/args as positional params, not into the script; injection-safe, do not re-flag
- [heal\* overwrite family](reference_heal-overwrite-family.md) — `lt fullstack update` overwrites user files with no confirm/dry-run; its git-porcelain guard fails OPEN for non-git + gitignored
- [npm reinit shell string is SAFE](reference_npm-reinit-shell-string-safe.md) — only `dir` varies, from find-file-up walking UP from cwd; pm literals fixed; do not re-flag
- [Regex lexing decides destruction](reference_regex-lexing-decides-destruction.md) — regex "is this code safe?" detectors gating an overwrite: guard vocabulary is a closed list, comment-stripping is not lexing
