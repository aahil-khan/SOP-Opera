# SOP Opera

Operational Review platform for high-risk industrial work authorization.

## Docs

- [Technical Design Spec](docs/Technical%20Design%20Spec.md) — implementation source of truth
- [Implementation Guide](docs/implementation-guide.md)
- [Build phases](.cursor/plans/sop_opera_build_phases_e0765491.plan.md)

## Repo layout (Phase 0)

```
shared/           TypeScript + Python contracts, fixtures.json (source of truth)
frontend/shared/  Copied TS contracts + fixtures (Turbopack cannot follow out-of-root symlinks)
backend/          FastAPI (SQLAlchemy async, schema.sql, config)
docker-compose.yml   Postgres + pgvector
```

After editing root `shared/`, run `./scripts/sync-shared.sh` (also runs automatically on `npm run dev` / `build`).

## Phase 0 — run locally

```bash
# Postgres + pgvector (host port 5433 — avoids clashing with local :5432)
docker compose up -d db

cp .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt

# API (:8000) — applies schema.sql on startup when DB is up
chmod +x scripts/dev-api.sh
./scripts/dev-api.sh
# Windows
.\scripts\dev-api.ps1

# Frontend (:3000) — separate terminal
cd frontend && npm install && npm run dev
```

Open http://localhost:3000 — should show:
- REST ping from `GET /api/ping`
- WebSocket echo from `/ws`
- Fixture assessment + retrieved references (path/score)

Exit criteria met when both apps boot, contracts import on both sides, and schema applies when Postgres is up.
