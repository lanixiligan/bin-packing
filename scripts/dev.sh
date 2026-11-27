#!/usr/bin/env bash
# Run the API and the web app together; Ctrl+C stops both.
#   API_PORT=8000 WEB_PORT=5173 scripts/dev.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"

cd "$ROOT/backend"
"$ROOT/backend/.venv/bin/uvicorn" app.main:app --reload --port "$API_PORT" &
API_PID=$!
cd "$ROOT/frontend"
VITE_API_TARGET="http://localhost:$API_PORT" VITE_PORT="$WEB_PORT" npm run dev -- --strictPort &
WEB_PID=$!

stop_all() {
  trap - INT TERM EXIT
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap stop_all INT TERM EXIT

echo "API http://localhost:$API_PORT/docs | web http://localhost:$WEB_PORT | Ctrl+C to stop"
wait -n "$API_PID" "$WEB_PID"
