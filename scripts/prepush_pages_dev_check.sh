#!/usr/bin/env bash
set -Eeuo pipefail

# Start a local Cloudflare Pages dev server, smoke-check its response, and run
# the GODstatic browser regression suite against the served URL.
#
# Usage:
#   ./scripts/prepush_pages_dev_check.sh [static-assets-directory]
#   PAGES_DEV_PORT=8790 CHROMIUM_PATH=/path/to/chromium ./scripts/prepush_pages_dev_check.sh ./public
#
# Keep test files outside the static-assets directory so they are not deployed.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${REPO_ROOT:-}" ]]; then
  REPO_ROOT="$(cd -- "$REPO_ROOT" && pwd)"
elif git -C "$SCRIPT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
else
  REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
fi

cd -- "$REPO_ROOT"

SITE_DIR="${1:-$REPO_ROOT/public}"
if [[ "$SITE_DIR" != /* ]]; then
  SITE_DIR="$REPO_ROOT/$SITE_DIR"
fi
SITE_DIR="$(cd -- "$SITE_DIR" 2>/dev/null && pwd)" || {
  echo "ERROR: static assets directory not found: ${1:-$REPO_ROOT/public}" >&2
  exit 2
}

PORT="${PAGES_DEV_PORT:-8788}"
BASE_URL="http://127.0.0.1:${PORT}/"
TEST_RUNNER="${BROWSER_TEST_RUNNER:-$REPO_ROOT/tests/test_godstatic_game_browser.cjs}"
LHCI_CONFIG="${LHCI_CONFIG:-$REPO_ROOT/lighthouserc.js}"
LOG_FILE="$(mktemp -t wrangler-pages-dev.XXXXXX.log)"
BODY_FILE="$(mktemp -t wrangler-pages-dev.XXXXXX.html)"
WRANGLER_PID=""

if [[ ! -f "$SITE_DIR/index.html" ]]; then
  echo "ERROR: expected $SITE_DIR/index.html" >&2
  exit 2
fi
if [[ ! -f "$TEST_RUNNER" ]]; then
  echo "ERROR: browser test runner not found: $TEST_RUNNER" >&2
  echo "Place test_godstatic_game_browser.cjs in the repository's tests/ folder or set BROWSER_TEST_RUNNER." >&2
  exit 2
fi
if [[ ! -f "$LHCI_CONFIG" ]]; then
  echo "ERROR: Lighthouse CI config not found: $LHCI_CONFIG" >&2
  echo "Place lighthouserc.js at the repository root or set LHCI_CONFIG." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required." >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required." >&2
  exit 2
fi

if [[ -n "${WRANGLER_BIN:-}" ]]; then
  WRANGLER="$WRANGLER_BIN"
elif [[ -x "$REPO_ROOT/node_modules/.bin/wrangler" ]]; then
  WRANGLER="$REPO_ROOT/node_modules/.bin/wrangler"
elif command -v wrangler >/dev/null 2>&1; then
  WRANGLER="$(command -v wrangler)"
else
  echo "ERROR: Wrangler not found. Install it in the project with: npm install --save-dev wrangler" >&2
  exit 2
fi
if [[ ! -x "$WRANGLER" ]]; then
  echo "ERROR: Wrangler executable is not executable: $WRANGLER" >&2
  exit 2
fi

if [[ -n "${LHCI_BIN:-}" ]]; then
  LHCI="$LHCI_BIN"
elif [[ -x "$REPO_ROOT/node_modules/.bin/lhci" ]]; then
  LHCI="$REPO_ROOT/node_modules/.bin/lhci"
elif command -v lhci >/dev/null 2>&1; then
  LHCI="$(command -v lhci)"
else
  echo "ERROR: Lighthouse CI not found. Install it in the project with: npm install --save-dev @lhci/cli" >&2
  exit 2
fi
if [[ ! -x "$LHCI" ]]; then
  echo "ERROR: Lighthouse CI executable is not executable: $LHCI" >&2
  exit 2
fi

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$WRANGLER_PID" ]] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  rm -f "$BODY_FILE"
  if [[ $status -eq 0 ]]; then
    rm -f "$LOG_FILE"
  else
    echo "\n--- Wrangler Pages Dev log ---" >&2
    cat "$LOG_FILE" >&2 || true
    echo "Wrangler log retained at: $LOG_FILE" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Starting Wrangler Pages Dev for: %s\n' "$SITE_DIR"
printf 'Local URL: %s\n' "$BASE_URL"
"$WRANGLER" pages dev "$SITE_DIR" --ip 127.0.0.1 --port "$PORT" --show-interactive-dev-session=false >"$LOG_FILE" 2>&1 &
WRANGLER_PID=$!

ready=0
for _ in $(seq 1 60); do
  if curl --silent --show-error --fail "$BASE_URL" --output "$BODY_FILE" 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
    echo "ERROR: Wrangler Pages Dev exited before becoming ready." >&2
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.5
done

if [[ "$ready" -ne 1 ]]; then
  echo "ERROR: Wrangler Pages Dev did not return HTTP 200 from $BASE_URL within 30 seconds." >&2
  exit 1
fi
if ! grep -qi '<html' "$BODY_FILE"; then
  echo "ERROR: $BASE_URL responded, but the body does not look like HTML." >&2
  exit 1
fi
printf 'PASS: Wrangler served index.html successfully.\n\n'

if [[ -n "${CHROMIUM_PATH:-}" ]]; then
  export CHROMIUM_PATH
  if [[ -z "${CHROME_PATH:-}" ]]; then
    export CHROME_PATH="$CHROMIUM_PATH"
  fi
fi
export PAGES_DEV_URL="$BASE_URL"
node "$TEST_RUNNER" "$BASE_URL"
if [[ -z "${CHROME_PATH:-}" ]]; then
  detected_chrome="$(node -e "for (const name of ['playwright', 'playwright-core']) { try { console.log(require(name).chromium.executablePath()); process.exit(0); } catch {} } process.exit(1)" 2>/dev/null || true)"
  if [[ -n "$detected_chrome" && -x "$detected_chrome" ]]; then
    export CHROME_PATH="$detected_chrome"
  fi
fi
if [[ -z "${CHROME_PATH:-}" || ! -x "$CHROME_PATH" ]]; then
  echo "ERROR: Lighthouse Chrome binary not found. Run 'npx playwright install chromium' or set CHROME_PATH." >&2
  exit 2
fi
printf '\nRunning Lighthouse CI against %s\n' "$BASE_URL"
"$LHCI" autorun --config="$LHCI_CONFIG"
printf '\nPASS: Lighthouse reports saved under %s/.lighthouseci\n' "$REPO_ROOT"
