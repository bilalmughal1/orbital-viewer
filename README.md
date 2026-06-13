# Orbital Viewer

Satellite tasking visualization — a miniature mission-control demo.

**Live demo: https://geo.fahadbilal.com**

![Orbital Viewer globe view](./web/src/assets/hero.png)

## Overview

Orbital Viewer matches simulated satellite passes against customer collection needs on an
interactive 3D globe, computing spatial intersection, time-window eligibility, and cloud-cover
compliance in real time. The geography and basemap are real (EOX Sentinel-2 cloudless 2023
imagery, PostGIS spatial queries against WGS-84 geometries); the tasking data is not — passes
and collection needs are seeded from a fixed dataset, not ingested from a live satellite feed.
This is a portfolio demonstration, not an operational system.

## Stack

| Layer | Technology |
|---|---|
| Spatial database | PostgreSQL 16 + PostGIS 3.4, GiST-indexed footprints |
| API | FastAPI + asyncpg (no ORM), GeoJSON responses |
| Frontend | React 19 + TypeScript + Vite, MapLibre GL JS v5 (globe projection) |
| Basemap | EOX Sentinel-2 cloudless 2023 (WMTS, free tier) |
| Infrastructure | Docker Compose, nginx reverse proxy, Cloudflare, GitHub Actions CI |

## How it works

The core query joins `pass_footprints` against `collection_needs` using three filters:

```sql
WHERE ST_Intersects(p.footprint, n.aoi)
  AND p.pass_start >= n.window_start
  AND p.pass_end   <= n.window_end
  AND p.cloud_cover_pct <= n.max_cloud_pct
```

Coverage is computed as `ST_Area(ST_Intersection(...):geography) / 1e6` (km²). Both tables
carry GiST spatial indexes; a production-scale version would sit behind a STAC catalogue
rather than a hand-rolled match query.

Clicking a collection need on the map fires `GET /api/needs/{id}/matches` and renders the
results inline in the popup, ordered by cloud cover ascending.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness + DB connectivity check |
| GET | `/api/passes` | Pass footprints as GeoJSON FeatureCollection (filters: `sensor`, `max_cloud`, `start`, `end`) |
| GET | `/api/needs` | Collection needs as GeoJSON FeatureCollection |
| GET | `/api/needs/{id}/matches` | Intersecting, time- and cloud-eligible passes for a need |
| GET | `/metrics` | Prometheus metrics (request counts, latency, pass total gauge) |

## Running locally

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD at minimum; other defaults are fine for local dev
docker compose up --build -d
```

The API is available at `http://localhost:8200/api/health`.

For frontend hot-reload during development:

```bash
cd web
npm install
npm run dev   # http://localhost:5173
```

Vite proxies `/api/*` to `http://localhost:8200` in dev mode, so there is no CORS
configuration needed locally.

## Design decisions

**Docker Compose over Kubernetes.** One VPS, three containers, no autoscaling requirement.
Compose is proportionate; Kubernetes would be operational overhead with no benefit here.

**Simulated tasking data.** Real customer collection needs and satellite schedules are
commercially sensitive. Seeding a representative dataset is both ethically correct and
sufficient to demonstrate the spatial query logic.

**Hand-rolled match query.** A production tasking system would query a STAC catalogue
(e.g. EODAG or a custom ingest pipeline). The SQL here is intentionally transparent so
the matching logic is auditable without domain-specific tooling.

**AI-assisted development.** This project was built with Claude Code under human review.
Architecture decisions, data design, and correctness checks remained with the author.

## CI

GitHub Actions runs on every push and pull request to `main`:

- **api job**: PostGIS service container, ruff lint, schema + seed load, pytest against the live DB
- **web job**: `npm ci`, TypeScript typecheck (`tsc -b --noEmit`), Vite production build
