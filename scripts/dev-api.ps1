# Windows equivalent of dev-api.sh
# Starts the FastAPI backend with uvicorn using the project's .venv

$ErrorActionPreference = "Stop"

$ROOT = (Resolve-Path "$PSScriptRoot\..").Path

$env:PYTHONPATH = "$ROOT;$ROOT\backend"

Set-Location "$ROOT\backend"

& "$ROOT\.venv\Scripts\uvicorn.exe" app.main:app --reload --host 0.0.0.0 --port 8000
