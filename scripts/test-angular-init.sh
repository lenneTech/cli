#!/usr/bin/env bash
#
# Integration test for Angular fullstack workspaces (ng-base-starter + @lenne.tech/ng-base).
#
# Scenarios:
#
#   init-npm      `lt fullstack init --frontend angular --frontend-framework-mode npm`
#   init-vendor   `lt fullstack init --frontend angular --frontend-framework-mode vendor`,
#                 then `lt frontend convert-mode --to npm` and back to vendor
#
# Both run the API in npm mode: this script tests the frontend; the backend paths
# are covered by test-vendor-init.sh.
#
# For each scenario:
#   - workspace shape: projects/app named `app`, no husky, no nested lockfile, no
#     starter repo files, root CLAUDE.md and README.md without frontend markers or Nuxt blocks,
#     a clean working tree after init, AGENTS.md = CLAUDE.md in projects/app, site.ts named
#     after the project without the starter's repository link (starter 22.0.1+)
#   - vendor: src/core/VENDOR.md + ng-package.json, tsconfig paths per entry point, no @lenne.tech/ng-base dependency
#   - `pnpm run build` in projects/app produces the .output/server/index.mjs shim
#   - `pnpm run typecheck` when the app has the script
#   - `pnpm run check` at the workspace root (skip with LT_IT_SKIP_CHECK=1); it runs the API's
#     vitest suites on a per-run test database (MongoDB on 127.0.0.1), no Playwright
#
# Sources (until the ng-base 22 release, both are needed for vendor mode):
#
#   LT_IT_NG_STARTER=/path/to/ng-base-starter   copied with --frontend-copy (working tree)
#                                               instead of cloning GitHub main
#   LT_IT_NG_BASE=/path/to/ng-base              --frontend-framework-copy: vendored (init-vendor)
#                                               or its build injected (init-npm)
#
# With LT_IT_NG_BASE, npm mode uses its build as injected file: dependency (build the
# library first, it must exist at the dest of its ng-package.json); without it, npm mode
# installs @lenne.tech/ng-base from the registry and init-npm can only pass once the
# version the starter pins is published.
#
# Usage:
#
#   bash scripts/test-angular-init.sh                # all scenarios
#   bash scripts/test-angular-init.sh init-vendor    # just one
#   bash scripts/test-angular-init.sh --keep         # keep /tmp/lt-ait/* on success
#
# Runs against the LOCAL CLI build at bin/lt. Rebuild first via:
#   npm run build
#
# Exit code 0 = all scenarios passed, 1 = any scenario failed.

set -e
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# LT_IT_CLI_BIN: a packed CLI (`npm pack`, then `npm i <tgz>` into an empty directory) runs the
# compiled build in npm's flat layout, as `npx -p @lenne.tech/cli` does. bin/lt from this checkout
# runs the TypeScript sources instead and cannot show a packaging fault.
CLI_BIN="${LT_IT_CLI_BIN:-${CLI_ROOT}/bin/lt}"
WORK_DIR="/tmp/lt-ait"
KEEP_ON_SUCCESS=0
SCENARIO_FILTER=""

for arg in "$@"; do
  case "${arg}" in
    --keep) KEEP_ON_SUCCESS=1 ;;
    --help|-h)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *) SCENARIO_FILTER="${arg}" ;;
  esac
done

RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RESET="\033[0m"
FAILED=0

pass() { echo -e "  ${GREEN}[PASS]${RESET} $*"; }
fail() { echo -e "  ${RED}[FAIL]${RESET} $*"; FAILED=1; }
info() { echo -e "  ${YELLOW}[INFO]${RESET} $*"; }

assert_exists() { if [ -e "$1" ]; then pass "$2"; else fail "$2 (missing: $1)"; fi; }
assert_absent() { if [ ! -e "$1" ]; then pass "$2"; else fail "$2 (still there: $1)"; fi; }
assert_contains() { if grep -qF -- "$2" "$1" 2>/dev/null; then pass "$3"; else fail "$3 ('$2' not in $1)"; fi; }
assert_not_contains() { if ! grep -qF -- "$2" "$1" 2>/dev/null; then pass "$3"; else fail "$3 ('$2' in $1)"; fi; }

# `lt fullstack init` registers every new project with `lt dev`; keep that out of the
# developer's own registry (see CLAUDE.md, "jest → vitest").
mkdir -p "${WORK_DIR}"
export LT_DEV_REGISTRY_PATH="${WORK_DIR}/projects.json"

SOURCE_FLAGS=()
if [ -n "${LT_IT_NG_STARTER:-}" ]; then SOURCE_FLAGS+=(--frontend-copy "${LT_IT_NG_STARTER}"); fi

check_workspace_shape() {
  local ws="$1"
  local app="${ws}/projects/app"
  assert_exists "${app}/angular.json" "projects/app is an Angular app"
  if node -e "process.exit(require('${app}/package.json').name === 'app' ? 0 : 1)"; then
    pass "projects/app/package.json is named app"
  else
    fail "projects/app/package.json is not named app"
  fi
  for repo_only in .husky package-lock.json pnpm-lock.yaml CHANGELOG.md migration-guides .github extras; do
    assert_absent "${app}/${repo_only}" "no ${repo_only} in projects/app"
  done
  assert_not_contains "${ws}/CLAUDE.md" "<!-- lt:frontend" "root CLAUDE.md has no frontend markers"
  assert_not_contains "${ws}/CLAUDE.md" "{{FRONTEND_FRAMEWORK}}" "root CLAUDE.md placeholder replaced"
  assert_not_contains "${ws}/CLAUDE.md" "nuxt-extensions" "root CLAUDE.md carries no nuxt-extensions block"
  assert_not_contains "${ws}/README.md" "<!-- lt:frontend" "root README.md has no frontend markers"
  # Everything init writes is in the initial commit, `lt dev init` included.
  local dirty
  dirty="$(git -C "${ws}" status --porcelain)"
  if [ -z "${dirty}" ]; then pass "working tree clean after init"; else fail "working tree dirty after init: ${dirty//$'\n'/, }"; fi
  if [ -f "${app}/AGENTS.md" ]; then
    if cmp -s "${app}/AGENTS.md" "${app}/CLAUDE.md"; then
      pass "projects/app AGENTS.md and CLAUDE.md byte-identical"
    else
      fail "projects/app AGENTS.md differs from CLAUDE.md"
    fi
  fi
  if [ -f "${app}/src/app/shared/site.ts" ]; then
    assert_contains "${app}/src/app/shared/site.ts" "export const SITE_NAME = '$(basename "${ws}")';" "site.ts SITE_NAME is the project name"
    assert_contains "${app}/src/app/shared/site.ts" "export const SITE_REPO_URL: null | string = null;" "site.ts drops the starter repository link"
  fi
}

check_workspace_check() {
  local ws="$1"
  if [ -n "${LT_IT_SKIP_CHECK:-}" ]; then
    info "pnpm run check skipped (LT_IT_SKIP_CHECK)"
    return
  fi
  info "pnpm run check in ${ws} (API unit + API tests on a per-run test database, no Playwright)"
  if (cd "${ws}" && pnpm run check >"${ws}/check.log" 2>&1); then
    pass "pnpm run check at the workspace root"
  else
    fail "pnpm run check at the workspace root (log: ${ws}/check.log)"
  fi
}

check_build() {
  local app="$1"
  info "pnpm run build in ${app}"
  if (cd "${app}" && pnpm run build >"${app}/../../build.log" 2>&1); then
    pass "pnpm run build"
  else
    fail "pnpm run build (log: ${app}/../../build.log)"
    return
  fi
  assert_exists "${app}/.output/server/index.mjs" ".output/server/index.mjs shim exists"
  if node -e "process.exit(require('${app}/package.json').scripts?.typecheck ? 0 : 1)"; then
    if (cd "${app}" && pnpm run typecheck >"${app}/../../typecheck.log" 2>&1); then
      pass "pnpm run typecheck"
    else
      fail "pnpm run typecheck (log: ${app}/../../typecheck.log)"
    fi
  fi
}

check_vendored() {
  local app="$1"
  assert_exists "${app}/src/core/VENDOR.md" "src/core/VENDOR.md"
  assert_exists "${app}/src/core/ng-package.json" "src/core/ng-package.json (kept, the mapping is derived from it)"
  assert_contains "${app}/src/core/VENDOR.md" "@lenne.tech/ng-base" "VENDOR.md names @lenne.tech/ng-base"
  assert_contains "${app}/tsconfig.json" '"@lenne.tech/ng-base"' "tsconfig paths map the primary entry point"
  assert_contains "${app}/tsconfig.json" '"@lenne.tech/ng-base/auth"' "tsconfig paths map the secondary entry points"
  if node -e "const p=require('${app}/package.json');process.exit(p.dependencies?.['@lenne.tech/ng-base']||p.devDependencies?.['@lenne.tech/ng-base']||p.dependenciesMeta?.['@lenne.tech/ng-base']?1:0)"; then
    pass "no @lenne.tech/ng-base dependency or dependenciesMeta entry"
  else
    fail "@lenne.tech/ng-base still in dependencies, devDependencies or dependenciesMeta"
  fi
  if [ -f "${app}/src/styles.css" ]; then
    if grep -qE "@import[[:space:]]+(url\\([[:space:]]*)?['\"]@lenne\.tech/ng-base/" "${app}/src/styles.css"; then
      fail "styles.css still imports @lenne.tech/ng-base/… (Tailwind cannot resolve it in vendor mode)"
    else
      pass "styles.css has no npm-form ng-base import"
    fi
  fi
}

run_scenario() {
  local name="$1"
  if [ -n "${SCENARIO_FILTER}" ] && [ "${SCENARIO_FILTER}" != "${name}" ]; then return; fi
  echo ""
  echo "=== ${name} ==="
  local ws="${WORK_DIR}/${name}"
  rm -rf "${ws}"
  cd "${WORK_DIR}"

  local mode_flags=(--frontend-framework-mode npm)
  # npm mode against a local build: injected file: dependency on <ng-base>/dist/ng-base.
  if [ -n "${LT_IT_NG_BASE:-}" ]; then mode_flags+=(--frontend-framework-copy "${LT_IT_NG_BASE}"); fi
  if [ "${name}" = "init-vendor" ]; then
    mode_flags=(--frontend-framework-mode vendor)
    if [ -n "${LT_IT_NG_BASE:-}" ]; then mode_flags+=(--frontend-framework-copy "${LT_IT_NG_BASE}"); fi
  fi

  if node "${CLI_BIN}" fullstack init --name "${name}" --frontend angular --api-mode Rest \
    --framework-mode npm "${mode_flags[@]}" ${SOURCE_FLAGS[@]+"${SOURCE_FLAGS[@]}"} \
    --noConfirm >"${WORK_DIR}/${name}.init.log" 2>&1; then
    pass "lt fullstack init"
  else
    fail "lt fullstack init (log: ${WORK_DIR}/${name}.init.log)"
    return
  fi

  check_workspace_shape "${ws}"
  local app="${ws}/projects/app"
  if [ "${name}" = "init-vendor" ]; then
    check_vendored "${app}"
    assert_contains "${ws}/CLAUDE.md" "projects/app/src/core/" "root CLAUDE.md names the vendored ng-base"
  fi
  check_build "${app}"

  if [ "${name}" = "init-vendor" ]; then
    local to_npm=(--to npm --noConfirm)
    if [ -n "${LT_IT_NG_BASE:-}" ]; then to_npm+=(--frontend-framework-copy "${LT_IT_NG_BASE}"); fi
    (cd "${app}" && node "${CLI_BIN}" frontend convert-mode "${to_npm[@]}" >"${WORK_DIR}/${name}.to-npm.log" 2>&1) ||
      fail "convert-mode --to npm (log: ${WORK_DIR}/${name}.to-npm.log)"
    assert_absent "${app}/src/core" "--to npm removed src/core/"
    assert_contains "${app}/package.json" '"@lenne.tech/ng-base":' "--to npm restored the dependency"
    assert_not_contains "${app}/tsconfig.json" "@lenne.tech/ng-base" "--to npm removed the tsconfig paths"
    local back=(--to vendor --noConfirm)
    if [ -n "${LT_IT_NG_BASE:-}" ]; then back+=(--frontend-framework-copy "${LT_IT_NG_BASE}"); fi
    (cd "${app}" && node "${CLI_BIN}" frontend convert-mode "${back[@]}" >"${WORK_DIR}/${name}.to-vendor.log" 2>&1) ||
      fail "convert-mode --to vendor (log: ${WORK_DIR}/${name}.to-vendor.log)"
    check_vendored "${app}"
    # The round trip changed package.json; reinstall so `check` runs against the vendored state.
    (cd "${ws}" && pnpm install >"${WORK_DIR}/${name}.reinstall.log" 2>&1) ||
      fail "pnpm install after the round trip (log: ${WORK_DIR}/${name}.reinstall.log)"
  fi
  check_workspace_check "${ws}"
}

run_scenario init-npm
run_scenario init-vendor

echo ""
if [ "${FAILED}" -ne 0 ]; then
  echo -e "${RED}Angular init integration test FAILED${RESET} (work dir kept: ${WORK_DIR})"
  exit 1
fi
echo -e "${GREEN}Angular init integration test passed${RESET}"
if [ "${KEEP_ON_SUCCESS}" -eq 0 ]; then rm -rf "${WORK_DIR}"; fi
