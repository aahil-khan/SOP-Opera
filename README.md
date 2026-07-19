# SOP Opera

Operational Review platform for high-risk industrial work authorization.

## Prerequisites

- **Python 3.11+**
- **Node.js 20+**
- **Postgres + pgvector** on `localhost:5433` (easiest: `docker compose up -d db` — DB only, not the whole app)

## Docs

- [Technical Design Spec](docs/Technical%20Design%20Spec.md) — implementation source of truth
- [Implementation Guide](docs/implementation-guide.md)
- [Build phases](.cursor/plans/sop_opera_build_phases_e0765491.plan.md)

## Run (pick your OS)

First time: copy env once if you do not have it yet — the scripts also create `.env` from `.env.example` when missing.

| OS | Command |
| --- | --- |
| **Linux** | `chmod +x scripts/run-linux.sh && ./scripts/run-linux.sh` |
| **macOS** | `chmod +x scripts/run-mac.sh && ./scripts/run-mac.sh` |
| **Windows** | Double-click `scripts\run-windows.bat` **or** in PowerShell: `.\scripts\run-windows.ps1` |

Each script will:

1. Create `.env` if needed  
2. Start Postgres via `docker compose up -d db` when Docker is available  
3. Create the Python venv / install deps if needed  
4. Install frontend deps if needed  
5. Start the API (`:8000`) and the Next.js app (`:3000`)

Then open **http://localhost:3000**. Ctrl+C stops the stack.

## Repo layout

```
shared/              TypeScript + Python contracts, fixtures.json (source of truth)
frontend/shared/     Copied TS contracts + fixtures
backend/             FastAPI
docker-compose.yml   Postgres + pgvector only (optional helper)
scripts/
  run-linux.sh       Start on Linux
  run-mac.sh         Start on macOS
  run-windows.ps1    Start on Windows (PowerShell)
  run-windows.bat    Start on Windows (double-click)
  sync-shared.mjs    Copy shared/ → frontend/shared/
  dev-api.py         API with reload
```

After editing root `shared/`, run `node scripts/sync-shared.mjs` (also runs automatically on `npm run dev` / `build`).
