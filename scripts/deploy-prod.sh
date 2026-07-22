#!/usr/bin/env bash
# Build and run the home-server production stack (db + api).
# Frontend lives on Vercel — not in this compose file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.prod.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.prod.example"
  echo "Edit CORS_ORIGINS (Vercel URL) and POSTGRES_PASSWORD, then re-run."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine + Compose plugin."
  exit 1
fi

echo "==> Building and starting db + api…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

API_PORT="$(grep -E '^API_PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
API_PORT="${API_PORT:-8000}"

echo ""
echo "==> API running"
echo "    Local  → http://localhost:${API_PORT}"
echo "    Public → https://sop-opera-api.aahil-khan.tech"
echo ""
echo "    Logs:  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f"
echo "    Stop:  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE down"
