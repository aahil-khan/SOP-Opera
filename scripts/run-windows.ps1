# SOP Opera — start on Windows (PowerShell)
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> SOP Opera (Windows)"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "    created .env from .env.example"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  Write-Host "==> Starting Postgres (docker compose db only)..."
  docker compose up -d db
} else {
  Write-Host "!!  Docker not found - ensure Postgres+pgvector is reachable at DATABASE_URL in .env"
}

$py = $null
foreach ($candidate in @("py", "python", "python3")) {
  $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
  if ($cmd) {
    $py = $candidate
    break
  }
}
if (-not $py) {
  throw "Python 3 not found. Install from https://www.python.org/ and re-run."
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  Write-Host "==> Creating Python venv..."
  if ($py -eq "py") {
    & py -3 -m venv .venv
  } else {
    & $py -m venv .venv
  }
}

Write-Host "==> Installing Python deps..."
& .\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt

if (-not (Test-Path "frontend\node_modules")) {
  Write-Host "==> Installing frontend deps..."
  Push-Location frontend
  npm install
  Pop-Location
}

Write-Host "==> Syncing shared contracts..."
node scripts\sync-shared.mjs

Write-Host "==> API  -> http://localhost:8000"
$api = Start-Process -FilePath ".\.venv\Scripts\python.exe" `
  -ArgumentList "scripts\dev-api.py" `
  -WorkingDirectory $Root `
  -PassThru `
  -WindowStyle Minimized

function Stop-Api {
  if ($api -and -not $api.HasExited) {
    Write-Host "`n==> Stopping API..."
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-Api } | Out-Null
try {
  Start-Sleep -Seconds 1
  Write-Host "==> App  -> http://localhost:3000"
  Write-Host "    Ctrl+C stops the frontend; API window is closed on exit"
  Push-Location frontend
  npm run dev
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  Stop-Api
}
