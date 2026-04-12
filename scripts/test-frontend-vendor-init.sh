#!/usr/bin/env bash
#
# Smoke-test for frontend vendoring of @lenne.tech/nuxt-extensions.
#
# The test clones https://github.com/lenneTech/nuxt-base-starter into a
# temporary cache once and reuses it for all scenarios. No dependency on
# local filesystem paths — runs unchanged on CI.
#
# Scenarios:
#
#   1. Fresh `lt fullstack init --frontend-framework-mode vendor`
#      (frontend vendored, backend npm)
#   2. `lt frontend convert-mode --to vendor` on an existing npm-mode project
#   3. `lt frontend convert-mode --to npm` round-trip from a vendored project
#   4. Fullstack init with BOTH backend vendor AND frontend vendor
#
# For each scenario:
#   - Structural sanity check (app/core/VENDOR.md, nuxt.config.ts, package.json)
#   - Consumer import codemod verification (4 explicit imports in nuxt-base-starter)
#   - `pnpm run build` in projects/app
#
# Usage:
#
#   bash scripts/test-frontend-vendor-init.sh              # run all scenarios
#   bash scripts/test-frontend-vendor-init.sh init-vendor  # just one
#   bash scripts/test-frontend-vendor-init.sh --keep       # keep /tmp/lt-fvt/* on success
#
# Runs against the LOCAL CLI build at bin/lt. Rebuild first via:
#   pnpm run clean-build && pnpm run compile && pnpm run copy-templates
#
# Exit code 0 = all scenarios passed.
# Exit code 1 = any scenario failed.

set -e
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI_BIN="${CLI_ROOT}/bin/lt"
WORK_DIR="/tmp/lt-fvt"
TEMPLATE_CACHE="/tmp/lt-fvt-template-cache"
TEMPLATE_REPO="https://github.com/lenneTech/nuxt-base-starter.git"
TEMPLATE_REF="main"
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
info() { echo -e "  ${YELLOW}[INFO]${RESET} $*"; }

assert_file() {
  local file="$1"
  local desc="$2"
  if [ -f "$file" ]; then
    pass "$desc: $file"
  else
    fail "$desc missing: $file"
  fi
}

assert_dir() {
  local dir="$1"
  local desc="$2"
  if [ -d "$dir" ]; then
    pass "$desc: $dir"
  else
    fail "$desc missing: $dir"
  fi
}

assert_not_file() {
  local file="$1"
  local desc="$2"
  if [ ! -f "$file" ]; then
    pass "$desc absent: $file"
  else
    fail "$desc still exists: $file"
  fi
}

assert_not_dir() {
  local dir="$1"
  local desc="$2"
  if [ ! -d "$dir" ]; then
    pass "$desc absent: $dir"
  else
    fail "$desc still exists: $dir"
  fi
}

assert_grep() {
  local pattern="$1"
  local file="$2"
  local desc="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    pass "$desc"
  else
    fail "$desc (pattern '$pattern' not found in $file)"
  fi
}

assert_not_grep() {
  local pattern="$1"
  local file="$2"
  local desc="$3"
  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    pass "$desc"
  else
    fail "$desc (pattern '$pattern' unexpectedly present in $file)"
  fi
}

ensure_template_cache() {
  if [ -d "$TEMPLATE_CACHE/nuxt-base-template" ]; then
    return 0
  fi
  echo "  [SETUP] Cloning $TEMPLATE_REPO ($TEMPLATE_REF) into $TEMPLATE_CACHE..."
  rm -rf "$TEMPLATE_CACHE"
  git clone --depth 1 --branch "$TEMPLATE_REF" "$TEMPLATE_REPO" "$TEMPLATE_CACHE" >/dev/null 2>&1 || {
    echo -e "  ${RED}[FAIL]${RESET} Failed to clone $TEMPLATE_REPO"
    return 1
  }
  if [ ! -d "$TEMPLATE_CACHE/nuxt-base-template" ]; then
    echo -e "  ${RED}[FAIL]${RESET} Cloned repo does not contain nuxt-base-template/ subdirectory"
    return 1
  fi
  echo "  [SETUP] Template cache ready."
}

copy_template_to() {
  local dest="$1"
  cp -R "$TEMPLATE_CACHE/nuxt-base-template/." "$dest/"
  rm -rf "$dest/node_modules" "$dest/.git"
}

run_scenario() {
  local name="$1"
  shift
  if [ -n "$SCENARIO_FILTER" ] && [ "$SCENARIO_FILTER" != "$name" ]; then
    return 0
  fi
  echo ""
  echo -e "${BOLD}━━━ Scenario: ${name} ━━━${RESET}"
  SCENARIO_FAILED=0
  FAILED=0
  "$@"
  if [ "$FAILED" -eq 1 ]; then
    SCENARIO_FAILED=1
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    echo -e "${RED}${BOLD}✗ Scenario ${name} FAILED${RESET}"
  else
    echo -e "${GREEN}${BOLD}✓ Scenario ${name} PASSED${RESET}"
  fi
}

# ── Shared assertions ────────────────────────────────────────────────────

assert_vendor_structure() {
  local app_dir="$1"
  assert_file "$app_dir/app/core/VENDOR.md" "VENDOR.md marker"
  assert_file "$app_dir/app/core/module.ts" "vendored module.ts"
  assert_dir "$app_dir/app/core/runtime" "vendored runtime/"
  assert_dir "$app_dir/app/core/runtime/composables" "vendored composables"
  assert_dir "$app_dir/app/core/runtime/components" "vendored components"
  assert_dir "$app_dir/app/core/runtime/lib" "vendored lib"
  assert_dir "$app_dir/app/core/runtime/testing" "vendored testing"

  assert_grep "@lenne.tech/nuxt-extensions" "$app_dir/app/core/VENDOR.md" "VENDOR.md references nuxt-extensions"
  assert_grep "Baseline-Version:" "$app_dir/app/core/VENDOR.md" "VENDOR.md has baseline version"

  assert_grep "'./app/core/module'" "$app_dir/nuxt.config.ts" "nuxt.config.ts uses local module path"
  assert_not_grep "'@lenne.tech/nuxt-extensions'" "$app_dir/nuxt.config.ts" "nuxt.config.ts no longer references npm module"

  # package.json checks
  if grep -q '"@lenne.tech/nuxt-extensions"' "$app_dir/package.json" 2>/dev/null; then
    fail "package.json still has @lenne.tech/nuxt-extensions dependency"
  else
    pass "package.json: @lenne.tech/nuxt-extensions removed"
  fi

  assert_grep "check:vendor-freshness" "$app_dir/package.json" "package.json has freshness check script"
}

assert_npm_structure() {
  local app_dir="$1"
  assert_not_dir "$app_dir/app/core" "app/core/"
  assert_grep "'@lenne.tech/nuxt-extensions'" "$app_dir/nuxt.config.ts" "nuxt.config.ts references npm module"
  assert_not_grep "'./app/core/module'" "$app_dir/nuxt.config.ts" "nuxt.config.ts no longer has local path"
  assert_grep '"@lenne.tech/nuxt-extensions"' "$app_dir/package.json" "package.json has @lenne.tech/nuxt-extensions"
  assert_not_grep "check:vendor-freshness" "$app_dir/package.json" "package.json freshness script removed"
}

assert_consumer_imports_vendor() {
  local app_dir="$1"
  # The 4 explicit imports in nuxt-base-starter:
  #   app/interfaces/user.interface.ts
  #   app/components/Upload/TusFileUpload.vue
  #   tests/e2e/auth-lifecycle.spec.ts
  #   tests/e2e/auth-feature-order.spec.ts
  local stale
  stale=$(grep -rE "from ['\"]@lenne\.tech/nuxt-extensions" "$app_dir/app" "$app_dir/tests" 2>/dev/null | grep -v "app/core" || true)
  if [ -z "$stale" ]; then
    pass "Consumer imports rewritten (no stale '@lenne.tech/nuxt-extensions' imports)"
  else
    fail "Stale consumer imports found:"
    echo "$stale" | head -5
  fi
}

build_project() {
  local app_dir="$1"
  info "Running pnpm install in $app_dir..."
  (cd "$app_dir" && pnpm install --silent >/dev/null 2>&1) || {
    fail "pnpm install failed"
    return 1
  }
  pass "pnpm install"

  info "Running pnpm run build in $app_dir..."
  (cd "$app_dir" && pnpm run build >/tmp/lt-fvt-build.log 2>&1) || {
    fail "pnpm run build failed. Last 20 lines:"
    tail -20 /tmp/lt-fvt-build.log
    return 1
  }
  pass "pnpm run build"
}

# ── Scenarios ────────────────────────────────────────────────────────────

scenario_convert_to_vendor() {
  local dest="$WORK_DIR/convert-to-vendor"
  rm -rf "$dest"
  mkdir -p "$dest"
  copy_template_to "$dest"

  (cd "$dest" && "$CLI_BIN" frontend convert-mode --to vendor --upstream-branch 1.5.3 --noConfirm) || {
    fail "CLI conversion failed"
    return 1
  }

  assert_vendor_structure "$dest"
  assert_consumer_imports_vendor "$dest"
  build_project "$dest"
}

scenario_convert_round_trip() {
  local dest="$WORK_DIR/round-trip"
  rm -rf "$dest"
  mkdir -p "$dest"
  copy_template_to "$dest"

  # npm → vendor
  (cd "$dest" && "$CLI_BIN" frontend convert-mode --to vendor --upstream-branch 1.5.3 --noConfirm) || {
    fail "npm→vendor conversion failed"
    return 1
  }
  assert_vendor_structure "$dest"

  # vendor → npm
  (cd "$dest" && "$CLI_BIN" frontend convert-mode --to npm --noConfirm) || {
    fail "vendor→npm conversion failed"
    return 1
  }
  assert_npm_structure "$dest"

  # npm → vendor (second time, should have no stale warnings)
  (cd "$dest" && "$CLI_BIN" frontend convert-mode --to vendor --upstream-branch 1.5.3 --noConfirm) || {
    fail "second npm→vendor conversion failed"
    return 1
  }
  assert_vendor_structure "$dest"
}

scenario_init_both_vendor() {
  local dest="$WORK_DIR/init-both-vendor"
  rm -rf "$dest"
  mkdir -p "$dest"

  (cd "$dest" && "$CLI_BIN" fullstack init \
    --name test-both-vendor \
    --frontend nuxt \
    --api-mode Rest \
    --framework-mode vendor \
    --frontend-framework-mode vendor \
    --framework-upstream-branch 11.24.3 \
    --noConfirm) || {
    fail "fullstack init failed"
    return 1
  }

  local project="$dest/test-both-vendor"
  assert_dir "$project/projects/api" "API project"
  assert_dir "$project/projects/app" "App project"

  # Backend vendor checks
  assert_file "$project/projects/api/src/core/VENDOR.md" "Backend VENDOR.md"
  if ! grep -q '"@lenne.tech/nest-server"' "$project/projects/api/package.json" 2>/dev/null; then
    pass "Backend package.json: @lenne.tech/nest-server removed"
  else
    fail "Backend package.json still has @lenne.tech/nest-server"
  fi

  # Frontend vendor checks
  assert_vendor_structure "$project/projects/app"
  assert_consumer_imports_vendor "$project/projects/app"
}

scenario_init_frontend_vendor_only() {
  local dest="$WORK_DIR/init-frontend-vendor"
  rm -rf "$dest"
  mkdir -p "$dest"

  (cd "$dest" && "$CLI_BIN" fullstack init \
    --name test-frontend-vendor \
    --frontend nuxt \
    --api-mode Rest \
    --framework-mode npm \
    --frontend-framework-mode vendor \
    --noConfirm) || {
    fail "fullstack init failed"
    return 1
  }

  local project="$dest/test-frontend-vendor"
  # Backend should be npm mode
  if grep -q '"@lenne.tech/nest-server"' "$project/projects/api/package.json" 2>/dev/null; then
    pass "Backend remains in npm mode"
  else
    fail "Backend @lenne.tech/nest-server missing (should be npm mode)"
  fi

  # Frontend should be vendored
  assert_vendor_structure "$project/projects/app"
  assert_consumer_imports_vendor "$project/projects/app"
}

# ── Main ─────────────────────────────────────────────────────────────────

TOTAL_FAILED=0

# Fresh work dir — guarantee clean state even if previous run was aborted
# (Ctrl+C, crash, or overlapping parallel runs). Stale scenario directories
# from prior failed runs can cause race conditions with `lt fullstack init`.
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

echo -e "${BOLD}Frontend Vendor Integration Tests${RESET}"
echo "Work dir: $WORK_DIR"
echo "CLI:      $CLI_BIN"

if [ ! -x "$CLI_BIN" ]; then
  echo -e "${RED}ERROR:${RESET} CLI binary not found or not executable: $CLI_BIN"
  echo "Run: pnpm run clean-build && pnpm run compile && pnpm run copy-templates"
  exit 1
fi

# Clone the nuxt-base-starter template from GitHub once and reuse for all
# scenarios. This eliminates any dependency on local filesystem paths and
# makes the test suite runnable on any machine (incl. CI).
ensure_template_cache || exit 1

run_scenario "convert-to-vendor" scenario_convert_to_vendor
run_scenario "round-trip" scenario_convert_round_trip
run_scenario "init-frontend-vendor" scenario_init_frontend_vendor_only
run_scenario "init-both-vendor" scenario_init_both_vendor

echo ""
if [ "$TOTAL_FAILED" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All scenarios passed.${RESET}"
  if [ "$KEEP_ON_SUCCESS" -eq 0 ]; then
    rm -rf "$WORK_DIR" "$TEMPLATE_CACHE"
    echo "Work dir + template cache cleaned up."
  else
    echo "Work dir kept at $WORK_DIR (use --keep to preserve)."
    echo "Template cache kept at $TEMPLATE_CACHE."
  fi
  exit 0
else
  echo -e "${RED}${BOLD}$TOTAL_FAILED scenario(s) failed.${RESET}"
  echo "Work dir kept at $WORK_DIR for debugging."
  echo "Template cache kept at $TEMPLATE_CACHE."
  exit 1
fi
