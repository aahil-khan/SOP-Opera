#!/usr/bin/env bash
# Thin wrapper — prefer `node scripts/sync-shared.mjs` on any OS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "${ROOT}/scripts/sync-shared.mjs"
