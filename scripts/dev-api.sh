#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${ROOT}:${ROOT}/backend:${PYTHONPATH:-}"
cd "${ROOT}/backend"
exec "${ROOT}/.venv/bin/uvicorn" app.main:app --reload --host 0.0.0.0 --port 8000
