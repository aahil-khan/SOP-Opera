#!/usr/bin/env bash
# SOP Opera — start on Linux
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> SOP Opera (Linux)"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "    created .env from .env.example"
fi

if command -v docker >/dev/null 2>&1; then
  echo "==> Starting Postgres (docker compose db only)…"
  docker compose up -d db
else
  echo "!!  Docker not found — ensure Postgres+pgvector is reachable at DATABASE_URL in .env"
fi

if [[ ! -d .venv ]]; then
  echo "==> Creating Python venv…"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
echo "==> Installing Python deps…"
pip install -q -r backend/requirements.txt

if [[ ! -d frontend/node_modules ]]; then
  echo "==> Installing frontend deps…"
  (cd frontend && npm install)
fi

echo "==> Syncing shared contracts…"
node scripts/sync-shared.mjs

cleanup() {
  echo ""
  echo "==> Stopping…"
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "==> API  → http://localhost:8000"
python scripts/dev-api.py &
API_PID=$!

# Give the API a moment before the UI starts hitting it
sleep 1

echo "==> App  → http://localhost:3000"
echo "    Ctrl+C stops both"
(cd frontend && npm run dev)
