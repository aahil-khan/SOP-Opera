#!/usr/bin/env bash
# Thin wrapper — prefer `python scripts/dev-api.py` on any OS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "${ROOT}/scripts/dev-api.py"
