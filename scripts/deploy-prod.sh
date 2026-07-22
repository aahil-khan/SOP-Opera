#!/usr/bin/env bash
# Build and run the full production stack (db + api + web).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.prod.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.prod.example"
  echo "Edit NEXT_PUBLIC_* and CORS_ORIGINS for your server IP/hostname, then re-run."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine + Compose plugin."
  exit 1
fi

echo "==> Building and starting production stack…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo ""
echo "==> Stack running"
echo "    Web  → http://localhost:$(grep -E '^WEB_PORT=' "$ENV_FILE" | cut -d= -f2 || echo 3000)"
echo "    API  → http://localhost:$(grep -E '^API_PORT=' "$ENV_FILE" | cut -d= -f2 || echo 8000)"
echo ""
echo "    Logs:  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f"
echo "    Stop:  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE down"
