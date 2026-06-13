# Orbital Viewer — Project Brief

**Status**: Tier 1 MVP complete (Steps 1–5)

## Project Overview

Mini mission-control satellite tasking visualization demo.

## Stack

| Layer | Technology |
|-------|-----------|
| DB | PostgreSQL 16 + PostGIS 3.4 (`kartoza/postgis:16-3.4`) |
| API | FastAPI + asyncpg (no ORM) |
| Frontend | React 18 + TypeScript + Vite + MapLibre GL JS v5 |
| Map | Globe projection, EOX s2cloudless raster basemap |

## Ports

| Service | Bind |
|---------|------|
| PostGIS | `127.0.0.1:5440` |
| API | `127.0.0.1:8200` |
| Vite dev | `0.0.0.0:5173` |

## Architecture Constraints (FROZEN)

- Public-ready from commit 1: no secrets in tracked files.
- `.gitignore` and `.env.example` present from day 1.
- DB password via env var only (`POSTGRES_PASSWORD`).
- Zero coupling to Atlas: own Docker network (`orbital-net`), own volume (`orbital-pgdata`).
- `postgis-prep` container must never be touched/stopped/reused.
- Conventional commits, one logical change per commit.

## Data Model

### `pass_footprints`

| Column | Type |
|--------|------|
| id | SERIAL PK |
| satellite | TEXT |
| sensor_type | TEXT CHECK IN ('optical','thermal','hyperspectral','SWIR','RF') |
| pass_start | TIMESTAMPTZ |
| pass_end | TIMESTAMPTZ |
| cloud_cover_pct | NUMERIC(5,2) CHECK 0–100 |
| footprint | GEOMETRY(POLYGON,4326) |

GiST index on `footprint`, btree index on `(pass_start, pass_end)`.

### `collection_needs`

| Column | Type |
|--------|------|
| id | SERIAL PK |
| name | TEXT |
| aoi | GEOMETRY(POLYGON,4326) |
| priority | INTEGER CHECK 1–5 |
| window_start | TIMESTAMPTZ |
| window_end | TIMESTAMPTZ |
| max_cloud_pct | NUMERIC(5,2) |
| status | TEXT CHECK IN ('pending','scheduled','collected','cancelled') |
| sensor_pref | TEXT nullable |
| notes | TEXT nullable |

GiST index on `aoi`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/passes` | GeoJSON FeatureCollection, filters: `sensor`, `max_cloud`, `start`, `end` |
| GET | `/api/needs` | GeoJSON FeatureCollection |
| GET | `/api/needs/{id}/matches` | Intersecting passes (ST_Intersects + time window + cloud, coverage_km2 via `::geography`) |
| GET | `/api/health` | `{status, db}` |
| GET | `/metrics` | Prometheus: request count, latency histogram, passes_total gauge |

## Match Query Logic

```sql
SELECT p.*, ROUND((ST_Area(ST_Intersection(p.footprint, n.aoi)::geography)/1e6)::numeric, 2) AS coverage_km2
FROM pass_footprints p
JOIN collection_needs n ON n.id = $need_id
WHERE ST_Intersects(p.footprint, n.aoi)
  AND p.pass_start >= n.window_start
  AND p.pass_end   <= n.window_end
  AND p.cloud_cover_pct <= n.max_cloud_pct
ORDER BY p.cloud_cover_pct, p.pass_start
```

## Frontend Features

- Full-screen MapLibre GL v5 globe, EOX s2cloudless tiles, atmosphere/fog
- Pass footprints: fill coloured by sensor_type (35% opacity) + outline
- Collection needs: dashed yellow outline
- Click need → popup with match table from `/api/needs/{id}/matches`
- Click pass → popup with pass properties
- Legend (sensor colour key + needs key)
- Dark chrome, title "Orbital Viewer — Tasking Demo"

## Seed Data

- 32 Altair passes, June 8–15 2026, UAE/Gulf region, sensors: optical/thermal/hyperspectral/SWIR/RF, cloud 0–40%
- 5 collection needs: ADMA maritime (Abu Dhabi), Musaffah industrial, Ruwais energy, urban Abu Dhabi, Dubai coast

## Future Milestones (NOT this session)

- Public deployment
- NPM/Cloudflare CDN
- CI pipeline
- STAC endpoints
- Satellite track overlays
