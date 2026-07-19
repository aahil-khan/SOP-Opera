# Windows equivalent of sync-shared.sh
# Copies TypeScript contracts + fixtures into frontend/shared/
# (Turbopack forbids symlinks / imports that escape the Next.js project root)

$ErrorActionPreference = "Stop"

$ROOT = (Resolve-Path "$PSScriptRoot\..").Path
$dest = "$ROOT\frontend\shared"

New-Item -ItemType Directory -Force -Path $dest | Out-Null

Copy-Item "$ROOT\shared\enums.ts"          $dest -Force
Copy-Item "$ROOT\shared\schemas.ts"        $dest -Force
Copy-Item "$ROOT\shared\api_contracts.ts"  $dest -Force
Copy-Item "$ROOT\shared\fixtures.json"     $dest -Force

Write-Host "synced shared -> frontend/shared"
