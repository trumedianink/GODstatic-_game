#!/usr/bin/env bash
set -Eeuo pipefail

# Local preview of the packaged static build.
#   npm run preview        serves the game until Ctrl+C
#   npm run preview:check  runs browser + Lighthouse checks, then exits

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd -- "$REPO_ROOT"

MODE="${1:-serve}"
if [[ "$MODE" == "--check" ]]; then
  exec npm run validate
elif [[ "$MODE" != "serve" ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

PORT="${PAGES_DEV_PORT:-8788}"
SITE_DIR="$REPO_ROOT/public"
URL="http://127.0.0.1:${PORT}/"
LOG_FILE="$(mktemp -t godstatic-pages-preview.XXXXXX.log)"
WRANGLER_PID=""
TAIL_PID=""

if [[ ! -f "$SITE_DIR/index.html" ]]; then
  echo "ERROR: game page not found: $SITE_DIR/index.html" >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required to check the local preview." >&2
  exit 2
fi
if [[ -x "$REPO_ROOT/node_modules/.bin/wrangler" ]]; then
  WRANGLER="$REPO_ROOT/node_modules/.bin/wrangler"
elif command -v wrangler >/dev/null 2>&1; then
  WRANGLER="$(command -v wrangler)"
else
  echo "ERROR: Wrangler not found. Run 'npm ci' first." >&2
  exit 2
fi

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$TAIL_PID" ]] && kill -0 "$TAIL_PID" 2>/dev/null; then
    kill "$TAIL_PID" 2>/dev/null || true
    wait "$TAIL_PID" 2>/dev/null || true
  fi
  if [[ -n "$WRANGLER_PID" ]] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Starting local Cloudflare Pages preview…\n'
printf 'Build folder: %s\n' "$SITE_DIR"
"$WRANGLER" pages dev "$SITE_DIR" --ip 127.0.0.1 --port "$PORT" --show-interactive-dev-session=false >"$LOG_FILE" 2>&1 &
WRANGLER_PID=$!

ready=0
for _ in $(seq 1 60); do
  if curl --silent --fail "$URL" -o /dev/null 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
    echo "ERROR: Wrangler Pages Dev exited before the preview was ready." >&2
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.5
done
if [[ "$ready" -ne 1 ]]; then
  echo "ERROR: local preview did not become ready at $URL within 30 seconds." >&2
  cat "$LOG_FILE" >&2 || true
  exit 1
fi

printf '\nLocal preview is ready: %s\n' "$URL"
printf 'Open that address in your browser. Press Ctrl+C here to stop the local server.\n\n'
tail -n +1 -f "$LOG_FILE" &
TAIL_PID=$!
wait "$WRANGLER_PID"
