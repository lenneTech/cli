#!/usr/bin/env bash
#
# Smoke-test for `lt fullstack init` in all four mode combinations:
#
#   - npm    / Rest
#   - vendor / Rest
#   - vendor / GraphQL
#   - vendor / Both
#
# For each combination:
#   1. Fresh `lt fullstack init --noConfirm`
#   2. Structural sanity check (VENDOR.md, package.json deps, etc.)
#   3. `pnpm exec tsc --noEmit` in projects/api
#   4. `pnpm run build` in projects/api
#   5. `pnpm run migrate:list` in projects/api
#   6. `lt server module`, `object`, `addProp`, `test` generation
#   7. Re-run tsc after generation
#
# Usage:
#
#   bash scripts/test-vendor-init.sh                  # run all 4 scenarios
#   bash scripts/test-vendor-init.sh npm-rest         # just one
#   bash scripts/test-vendor-init.sh --keep           # keep /tmp/lt-it/* on success
#
# Runs against the LOCAL CLI build at bin/lt. Make sure to rebuild first
# via `pnpm run clean-build && pnpm run compile && pnpm run copy-templates`.
#
# Exit code 0 = all scenarios passed.
# Exit code 1 = any scenario failed (see [FAIL] markers in the log).

set -e
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI_BIN="${CLI_ROOT}/bin/lt"
WORK_DIR="/tmp/lt-it"
KEEP_ON_SUCCESS=0
SCENARIO_FILTER=""

for arg in "$@"; do
  case "${arg}" in
    --keep) KEEP_ON_SUCCESS=1 ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) SCENARIO_FILTER="${arg}" ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────

RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
BOLD="\033[1m"
RESET="\033[0m"

pass() { echo -e "  ${GREEN}[PASS]${RESET} $*"; }
fail() { echo -e "  ${RED}[FAIL]${RESET} $*"; FAILED=1; }
section() { echo -e "\n${BOLD}── $* ──${RESET}"; }

FAILED=0
SCENARIOS_RUN=0

# ── Pre-flight ──────────────────────────────────────────────────────────

if [[ ! -x "${CLI_BIN}" ]]; then
  echo -e "${RED}Error: ${CLI_BIN} not found or not executable.${RESET}"
  echo "  Run: cd ${CLI_ROOT} && pnpm run clean-build && pnpm run compile && pnpm run copy-templates"
  exit 2
fi

# Require git
if ! command -v git >/dev/null 2>&1; then
  echo -e "${RED}Error: git is required.${RESET}"
  exit 2
fi

# Require pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "${RED}Error: pnpm is required.${RESET}"
  exit 2
fi

# Fresh work dir — guarantee clean state even if previous run was aborted
# (Ctrl+C, crash, or overlapping parallel runs). Without this, stale
# `it-*` directories from prior failed runs can cause race conditions with
# `lt fullstack init` trying to write into a partially-existing tree.
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

# ── Scenario runner ─────────────────────────────────────────────────────

run_scenario() {
  local scenario="$1"   # "npm-rest" | "vendor-rest" | "vendor-graphql" | "vendor-both"
  local framework_mode="$2"  # "npm" | "vendor"
  local api_mode="$3"   # "Rest" | "GraphQL" | "Both"

  if [[ -n "${SCENARIO_FILTER}" && "${SCENARIO_FILTER}" != "${scenario}" ]]; then
    return 0
  fi

  SCENARIOS_RUN=$((SCENARIOS_RUN + 1))

  local name="it-${scenario}"
  local project_root="${WORK_DIR}/${name}"
  local api_dir="${project_root}/projects/api"

  section "Scenario: ${scenario} (framework=${framework_mode}, api=${api_mode})"

  rm -rf "${project_root}"

  # 1. Init
  (cd "${WORK_DIR}" && \
    "${CLI_BIN}" fullstack init \
      --name "${name}" \
      --frontend nuxt \
      --api-mode "${api_mode}" \
      --framework-mode "${framework_mode}" \
      --noConfirm) >/dev/null 2>&1 \
    && pass "init completed" \
    || { fail "init failed"; return 0; }

  # 2. Structural checks
  if [[ ! -d "${api_dir}" ]]; then
    fail "api directory not created"
    return 0
  fi

  if [[ "${framework_mode}" == "vendor" ]]; then
    [[ -f "${api_dir}/src/core/VENDOR.md" ]] \
      && pass "src/core/VENDOR.md present" \
      || fail "src/core/VENDOR.md missing"
    [[ -f "${api_dir}/src/core/index.ts" ]] \
      && pass "src/core/index.ts present (flatten-fix applied)" \
      || fail "src/core/index.ts missing"
    [[ -f "${api_dir}/bin/migrate.js" ]] \
      && pass "bin/migrate.js present" \
      || fail "bin/migrate.js missing"
    [[ -f "${api_dir}/migrations-utils/ts-compiler.js" ]] \
      && pass "migrations-utils/ts-compiler.js present" \
      || fail "migrations-utils/ts-compiler.js missing"
    # migrate.js should explicitly load the ts-compiler bootstrap
    if grep -q "require('./ts-compiler')" "${api_dir}/migrations-utils/migrate.js"; then
      pass "migrations-utils/migrate.js explicitly loads ts-compiler"
    else
      fail "migrations-utils/migrate.js does NOT load ts-compiler"
    fi
    # Vendor freshness check (inline in package.json, no separate files)
    if grep -q '"check:vendor-freshness"' "${api_dir}/package.json"; then
      pass "package.json has check:vendor-freshness script"
    else
      fail "package.json missing check:vendor-freshness script"
    fi
    # check / check:fix / check:naf wired to freshness check
    if node -e "const s=require('${api_dir}/package.json').scripts; process.exit(s.check && s.check.includes('check:vendor-freshness') ? 0 : 1)"; then
      pass "check script hooks check:vendor-freshness"
    else
      fail "check script does NOT hook check:vendor-freshness"
    fi
    # CLAUDE.md vendor block
    if grep -q 'lt-vendor-marker' "${api_dir}/CLAUDE.md"; then
      pass "CLAUDE.md has vendor-mode notice block"
    else
      fail "CLAUDE.md missing vendor-mode notice block"
    fi
    # Functional: freshness check runs and exits 0
    if (cd "${api_dir}" && pnpm run check:vendor-freshness >/dev/null 2>&1); then
      pass "pnpm run check:vendor-freshness exits 0"
    else
      fail "pnpm run check:vendor-freshness failed"
    fi
    # No @lenne.tech/nest-server dep in vendor
    if grep -q '"@lenne.tech/nest-server"' "${api_dir}/package.json"; then
      fail "package.json still lists @lenne.tech/nest-server"
    else
      pass "@lenne.tech/nest-server dep removed"
    fi
    # Baseline version recorded
    if grep -q "Baseline-Version:.*[0-9]" "${api_dir}/src/core/VENDOR.md"; then
      pass "VENDOR.md has Baseline-Version"
    else
      fail "VENDOR.md Baseline-Version not recorded"
    fi
  else
    [[ -d "${api_dir}/node_modules/@lenne.tech/nest-server" ]] \
      && pass "@lenne.tech/nest-server installed" \
      || fail "@lenne.tech/nest-server not in node_modules"
    if ! grep -q '"@lenne.tech/nest-server"' "${api_dir}/package.json"; then
      fail "package.json does not list @lenne.tech/nest-server"
    else
      pass "@lenne.tech/nest-server dep present"
    fi
  fi

  # 3. tsc clean
  (cd "${api_dir}" && pnpm exec tsc --noEmit >/dev/null 2>&1) \
    && pass "tsc --noEmit clean" \
    || fail "tsc --noEmit errors"

  # 4. build
  (cd "${api_dir}" && pnpm run build >/dev/null 2>&1) \
    && pass "pnpm run build successful" \
    || fail "pnpm run build failed"

  # 5. migrate:list
  if (cd "${api_dir}" && pnpm run migrate:list 2>/dev/null | grep -q "Migration Status"); then
    pass "migrate:list works"
  else
    fail "migrate:list broken"
  fi

  # 6. Generate module/object/addProp/test
  (cd "${api_dir}/src" && \
    "${CLI_BIN}" server module --name Product --controller "${api_mode}" --noConfirm --skipLint \
      --prop-name-0 name --prop-type-0 string --prop-name-1 price --prop-type-1 number >/dev/null 2>&1) \
    && pass "server module generated" \
    || fail "server module generation failed"

  (cd "${api_dir}/src" && \
    "${CLI_BIN}" server object --name Address --noConfirm --skipLint \
      --prop-name-0 street --prop-type-0 string >/dev/null 2>&1) \
    && pass "server object generated" \
    || fail "server object generation failed"

  (cd "${api_dir}/src" && \
    "${CLI_BIN}" server addProp --type Module --element product --noConfirm --skipLint \
      --prop-name-0 stock --prop-type-0 number >/dev/null 2>&1) \
    && pass "server addProp generated" \
    || fail "server addProp generation failed"

  (cd "${api_dir}/src" && \
    "${CLI_BIN}" server test MyTest >/dev/null 2>&1) \
    && pass "server test generated" \
    || fail "server test generation failed"

  # 7. Verify generated imports match the mode
  local service_import
  service_import=$(head -1 "${api_dir}/src/server/modules/product/product.service.ts" 2>/dev/null || echo "")
  if [[ "${framework_mode}" == "vendor" ]]; then
    if [[ "${service_import}" == *"../../../core"* ]]; then
      pass "product.service.ts uses relative vendor import"
    else
      fail "product.service.ts does NOT use relative vendor import (got: ${service_import})"
    fi
  else
    if [[ "${service_import}" == *"@lenne.tech/nest-server"* ]]; then
      pass "product.service.ts uses bare npm specifier"
    else
      fail "product.service.ts does NOT use npm specifier (got: ${service_import})"
    fi
  fi

  # 8. Re-run tsc after generation
  (cd "${api_dir}" && pnpm exec tsc --noEmit >/dev/null 2>&1) \
    && pass "tsc --noEmit still clean after generation" \
    || fail "tsc --noEmit errors after generation"

  # 9. lt fullstack update should detect the mode correctly
  local update_output
  update_output=$((cd "${api_dir}" && "${CLI_BIN}" fullstack update 2>&1) || true)
  if [[ "${framework_mode}" == "vendor" ]]; then
    if echo "${update_output}" | grep -q "Vendor-mode update flow"; then
      pass "lt fullstack update detects vendor mode"
    else
      fail "lt fullstack update did not detect vendor mode"
    fi
  else
    if echo "${update_output}" | grep -q "npm-mode update flow"; then
      pass "lt fullstack update detects npm mode"
    else
      fail "lt fullstack update did not detect npm mode"
    fi
  fi

  # 10. lt status should report the correct framework mode
  local status_output
  status_output=$((cd "${api_dir}" && "${CLI_BIN}" status 2>&1) || true)
  if [[ "${framework_mode}" == "vendor" ]]; then
    if echo "${status_output}" | grep -q "Framework: vendor"; then
      pass "lt status reports vendor mode"
    else
      fail "lt status did not report vendor mode"
    fi
  else
    if echo "${status_output}" | grep -q "Framework: npm"; then
      pass "lt status reports npm mode"
    else
      fail "lt status did not report npm mode"
    fi
  fi
}

# ── Dry-run check (fast) ────────────────────────────────────────────────

run_dry_run_check() {
  section "Dry-run check (no init)"
  local out
  out=$((cd "${WORK_DIR}" && "${CLI_BIN}" fullstack init \
      --name dry-check \
      --frontend nuxt \
      --api-mode Rest \
      --framework-mode vendor \
      --framework-upstream-branch 11.24.1 \
      --dry-run \
      --noConfirm 2>&1) || true)
  if echo "${out}" | grep -q "Dry-run plan"; then
    pass "dry-run prints plan"
  else
    fail "dry-run did not print plan"
  fi
  if echo "${out}" | grep -q "frameworkUpstreamBranch:.*11.24.1"; then
    pass "dry-run shows framework-upstream-branch"
  else
    fail "dry-run does not show framework-upstream-branch"
  fi
  if echo "${out}" | grep -q "vendor core/ + flatten-fix"; then
    pass "dry-run lists vendor-specific operations"
  else
    fail "dry-run does not list vendor-specific operations"
  fi
  # Should not have created anything on disk
  if [[ -d "${WORK_DIR}/dry-check" ]]; then
    fail "dry-run created directory (should not)"
    rm -rf "${WORK_DIR}/dry-check"
  else
    pass "dry-run did not touch the filesystem"
  fi
}

# ── Run ─────────────────────────────────────────────────────────────────

echo -e "${BOLD}lt fullstack init integration test${RESET}"
echo "  CLI binary: ${CLI_BIN}"
echo "  Work dir:   ${WORK_DIR}"
if [[ -n "${SCENARIO_FILTER}" ]]; then
  echo "  Filter:     ${SCENARIO_FILTER}"
fi

run_dry_run_check
run_scenario "npm-rest"        "npm"    "Rest"
run_scenario "vendor-rest"     "vendor" "Rest"
run_scenario "vendor-graphql"  "vendor" "GraphQL"
run_scenario "vendor-both"     "vendor" "Both"

echo ""
echo -e "${BOLD}──────────────────────────────────────────────────────${RESET}"
if [[ "${FAILED}" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All ${SCENARIOS_RUN} scenario(s) passed.${RESET}"
  if [[ "${KEEP_ON_SUCCESS}" -eq 0 ]]; then
    echo "Cleaning up ${WORK_DIR}/it-*"
    rm -rf "${WORK_DIR}"/it-*
  else
    echo "Kept ${WORK_DIR}/it-* (--keep)"
  fi
  exit 0
else
  echo -e "${RED}${BOLD}Some scenarios failed — see [FAIL] markers above.${RESET}"
  echo "Work dir left intact for inspection: ${WORK_DIR}"
  exit 1
fi
