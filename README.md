# Orbital Viewer — Tasking Demo

A mini mission-control satellite tasking visualization.

## Stack

- **DB**: PostgreSQL 16 + PostGIS 3.4 (kartoza/postgis:16-3.4)
- **API**: FastAPI + asyncpg (no ORM), port 8200
- **Frontend**: React 18 + TypeScript + Vite + MapLibre GL JS v5 (globe projection)

## Quick Start

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD at minimum
docker compose up --build
cd web && npm install && npm run dev
```

Frontend: http://localhost:5173  
API: http://localhost:8200/api/health

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/passes` | Pass footprints GeoJSON (filter: sensor, max_cloud, start, end) |
| GET | `/api/needs` | Collection needs GeoJSON |
| GET | `/api/needs/{id}/matches` | Intersecting passes for a need |
| GET | `/api/health` | Health check |
| GET | `/metrics` | Prometheus metrics |

## Architecture Notes

- Isolated Docker network `orbital-net`, no coupling to other services.
- PostGIS binds `127.0.0.1:5440` (avoids conflicts with existing :5432/:5433).
- API binds `127.0.0.1:8200`.
- No secrets in tracked files — use `.env` (see `.env.example`).
