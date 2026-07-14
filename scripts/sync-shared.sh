#!/usr/bin/env bash
# Copy TypeScript contracts + fixtures into frontend/shared (Turbopack forbids
# symlinks / imports that escape the Next.js project root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "${ROOT}/frontend/shared"
cp "${ROOT}/shared/enums.ts" \
   "${ROOT}/shared/schemas.ts" \
   "${ROOT}/shared/api_contracts.ts" \
   "${ROOT}/shared/fixtures.json" \
   "${ROOT}/frontend/shared/"
echo "synced shared → frontend/shared"
