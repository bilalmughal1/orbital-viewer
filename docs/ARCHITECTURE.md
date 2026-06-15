# Orbital Viewer — Architecture & Technical Documentation

**Live:** https://geo.fahadbilal.com  ·  **Repo:** https://github.com/bilalmughal1/orbital-viewer

A satellite tasking visualization — a working miniature of the problem space addressed by
constellation operators' Collection Needs Command & Control (CNC2) and geospatial catalogue
systems. It matches collection needs (where a customer wants imagery) against satellite passes
and real archived acquisitions (where satellites actually looked), on an interactive 3D globe.

---

## 1. What it does, in one paragraph

A **collection need** is a request: photograph *this area*, within *this time window*, with
*this sensor*, under *this much cloud*. A **pass footprint** is where a satellite swept and
could image. The system answers the core tasking question — *which passes (and which real
past acquisitions) satisfy a given need?* — by computing spatial intersection, time-window
eligibility, and cloud-cover compliance in the database, and rendering the result on a globe.
Users can also **draw a new need live** and get matches back immediately.

---

## 2. Data honesty (the most important section)

This is a portfolio demonstration, and what is real vs. simulated is stated plainly
everywhere it appears:

| Element | Real or simulated | Notes |
|---|---|---|
| Basemap imagery | **Real** | EOX Sentinel-2 cloudless 2023 mosaic (actual satellite imagery) |
| Geography / coordinates | **Real** | AOIs placed at real Gulf locations (Ruwais, Musaffah, etc.) |
| Spatial computation | **Real** | PostGIS `ST_Intersects` / `ST_Area`, genuine math |
| Satellite orbit tracks | **Real** | Live TLEs from CelesTrak, propagated with SGP4 |
| Archived acquisitions | **Real** | Live Sentinel-2 L2A from Copernicus STAC — real footprints, dates, cloud cover |
| Simulated passes ("Altair") | **Simulated** | 36 seeded rows; a fictional constellation for the tasking demo |
| Collection needs | **Simulated** | Seeded + user-drawn; real customer tasking is confidential |

The design principle: **real where it can be, simulated only where it must be (customer
tasking data is commercially confidential), labelled honestly throughout.**

---

## 3. System architecture

```
                          Browser (client)
        ┌──────────────────────────────────────────────────┐
        │  React 19 + TypeScript + Vite                     │
        │  MapLibre GL JS v5  — globe projection, WebGL     │
        │  satellite.js       — SGP4 orbit propagation      │
        │  Layers: passes · needs · acquisitions · orbits   │
        │          · drawn AOI · tasking matches            │
        └───────────────┬──────────────────────────────────┘
                        │  HTTPS, same-origin /api/*
                        ▼
        ┌──────────────────────────────────────────────────┐
        │  Cloudflare (DNS + TLS, proxied)                  │
        │  Nginx Proxy Manager  (geo.fahadbilal.com → web)  │
        └───────────────┬──────────────────────────────────┘
                        │  Docker network (n8n_default)
                        ▼
        ┌──────────────────────────────────────────────────┐
        │  web container — nginx                            │
        │   · serves built static frontend                  │
        │   · proxies /api/* → api container                │
        └───────────────┬──────────────────────────────────┘
                        │  internal network (orbital-prod-net)
                        ▼
        ┌──────────────────────────────────────────────────┐
        │  api container — FastAPI + asyncpg (uvicorn)      │
        │   · GET  /api/passes /needs /acquisitions         │
        │   · GET  /api/needs/{need_id}/matches             │
        │   · POST /api/match     (ephemeral AOI)           │
        │   · GET  /api/tles      (CelesTrak proxy, cached) │
        │   · GET  /api/health /metrics                     │
        └───────────────┬──────────────────────────────────┘
                        │  asyncpg pool (internal only)
                        ▼
        ┌──────────────────────────────────────────────────┐
        │  db container — PostgreSQL 16 + PostGIS 3.4       │
        │   · pass_footprints     (GiST-indexed geometry)   │
        │   · collection_needs    (GiST-indexed geometry)   │
        │   · real_acquisitions   (GiST-indexed geometry)   │
        │   not exposed to host — internal network only     │
        └──────────────────────────────────────────────────┘

   External data sources (server-side, not browser):
     · CelesTrak  — TLE orbital elements   (api proxies + caches 1h)
     · Copernicus STAC — Sentinel-2 L2A    (manual ingest script → db)
```

**Dependency direction:** browser asks → Cloudflare/NPM route → nginx proxies → FastAPI
handles → asyncpg connects → PostGIS computes. The database is the brain; everything above
it is transport and presentation.

---

## 4. Data model

Three tables, all with `GEOMETRY(POLYGON, 4326)` columns and GiST spatial indexes.

### pass_footprints (simulated passes — 36 rows)
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| satellite | TEXT | e.g. 'Altair-1' (fictional constellation) |
| sensor_type | TEXT | CHECK in (optical, thermal, hyperspectral, SWIR, RF) |
| pass_start / pass_end | TIMESTAMPTZ | CHECK pass_end > pass_start |
| cloud_cover_pct | NUMERIC(5,2) | 0–100 |
| footprint | GEOMETRY(POLYGON,4326) | GiST-indexed; also a btree index on (pass_start, pass_end) |

### collection_needs (customer requests)
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | TEXT | e.g. 'Ruwais Energy Complex' |
| aoi | GEOMETRY(POLYGON,4326) | GiST-indexed |
| priority | INTEGER | 1–5 |
| window_start / window_end | TIMESTAMPTZ | CHECK window_end > window_start |
| max_cloud_pct | NUMERIC(5,2) | 0–100 |
| status | TEXT | pending / scheduled / collected / cancelled |
| sensor_pref | TEXT | nullable preference (note: not enforced in match — see §8) |
| notes | TEXT | nullable; descriptive text (tasking purpose) |

### real_acquisitions (real Sentinel-2 — 40 rows, manually ingested)
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| source | TEXT | 'sentinel-2' |
| product_id | TEXT UNIQUE | real STAC product ID (upsert key) |
| footprint | GEOMETRY(POLYGON,4326) | GiST-indexed; ~110 km tiles |
| acquired_at | TIMESTAMPTZ | real acquisition time |
| cloud_cover_pct | NUMERIC(5,2) | real measured `eo:cloud_cover` |
| sensor | TEXT | 'optical' |

---

## 5. The match query (the core logic)

Both the per-need endpoint and the live AOI endpoint use the same three-filter logic, run
against `pass_footprints` and `real_acquisitions`, `UNION`ed with a `source` discriminator:

```sql
WHERE ST_Intersects(footprint, aoi)          -- spatial overlap (GiST-accelerated)
  AND <time field> BETWEEN window_start AND window_end   -- temporal eligibility
  AND cloud_cover_pct <= max_cloud            -- quality compliance
```

Coverage is the real intersection area in km²:
`ROUND((ST_Area(ST_Intersection(footprint, aoi)::geography) / 1e6)::numeric, 2)`.
The `::geography` cast is deliberate — `ST_Area` on raw SRID-4326 geometry returns square
degrees, not metres; casting to geography yields true surface area.

**Performance:** the GiST index lets PostGIS pre-filter candidates by bounding box (the `&&`
operator) before running exact intersection tests, turning a full scan into an index scan.

---

## 6. API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + DB connectivity (`{status, db}`) |
| GET | `/api/passes` | Simulated passes as GeoJSON; filters: `sensor`, `max_cloud`, `start`, `end` |
| GET | `/api/needs` | Collection needs as GeoJSON |
| GET | `/api/acquisitions` | Real Sentinel-2 acquisitions as GeoJSON |
| GET | `/api/needs/{need_id}/matches` | Passes + real acquisitions satisfying a seeded need; `source`-tagged |
| POST | `/api/match` | **Ephemeral** — match a user-drawn AOI + constraints; no DB write |
| GET | `/api/tles` | CelesTrak TLE proxy for 5 real satellites; cached 1h, stale-fallback |
| GET | `/metrics` | Prometheus metrics (request count, latency histogram, passes gauge) |

**Security note on `/api/match`:** the user-supplied GeoJSON is bound as a parameter and
parsed by PostGIS via `ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)` inside a CTE — never
string-interpolated into SQL. Filter values are likewise parameterised (`$2`, `$3`, …).
Geometry type is validated (Polygon/MultiPolygon) before the query runs.

---

## 7. Frontend layers (MapLibre v5, globe projection)

| Layer | Source | Meaning |
|---|---|---|
| s2cloudless basemap | EOX WMTS raster | Real Earth imagery |
| passes-fill / -outline | `/api/passes` | Simulated passes, coloured by sensor type |
| needs-fill / -outline | `/api/needs` | Seeded collection needs (dashed) |
| acquisitions-fill / -outline | `/api/acquisitions` | Real Sentinel-2 tiles (distinct colour) |
| sat-tracks-line / sat-dots / sat-labels | `/api/tles` + satellite.js | Live orbit tracks (near-polar) |
| aoi-fill / -outline | local draw state | The rectangle the user draws |
| tasking-matches-fill / -outline | `/api/match` response | Footprints matching the drawn AOI |

Globe projection is set both at construction and in the style object. MapLibre v5's type
defs lag the runtime API: one `@ts-expect-error` suppression covers the top-level
`projection` option at the Map constructor, and a second covers the `setFog` call used for
the atmosphere/sky effect.  The AOI draw uses a custom two-click bbox rather than an
external draw library, because draw libraries fight the globe projection.

---

## 8. Known limitations (stated honestly)

- **Sensor preference not enforced in matching.** `collection_needs.sensor_pref` exists but
  the match query does not filter on it — a hyperspectral need can currently match an optical
  pass. A production version would rank or filter by sensor preference.
- **Footprints are axis-aligned rectangles** for simulated passes (`ST_MakeEnvelope`), not
  true orbit-following swaths. Real acquisitions (from STAC) have authentic geometry.
- **Single-region, bounded dataset** — 36 simulated passes, 40 real tiles over the Gulf.
  Demonstrates the logic, not production scale. At scale, a vector-tile (`ST_AsMVT`) endpoint
  and a STAC catalogue (e.g. pgstac) would replace direct GeoJSON and the hand-rolled query.
- **STAC ingestion is manual**, by design — `api/scripts/ingest_sentinel.py` is run by hand,
  not in CI/CD, because real-data ingestion is a deliberate supervised action.

---

## 9. Infrastructure & deployment

- **Containers (prod):** `db` (PostGIS, internal only, named volume), `api` (FastAPI on
  127.0.0.1:8200), `web` (nginx static + `/api` proxy on 127.0.0.1:8201).
- **Networks:** `db`+`api` on private `orbital-prod-net`; `web` additionally on the shared
  `n8n_default` network so Nginx Proxy Manager can reach it by container name.
- **Edge:** Cloudflare (DNS A-record `geo` → VPS, proxied, TLS) → NPM (`geo.fahadbilal.com`
  → `orbital-prod-web:80`, Let's Encrypt).
- **Frontend↔API:** same-origin `/api/*` (nginx proxies to the api container) — no CORS in
  production, no hardcoded localhost URLs.

### CI/CD (GitHub Actions, `.github/workflows/ci.yml`)
```
push / PR to main
   ├── job: api   → PostGIS service container, ruff lint,
   │                load init.sql + seed.sql, pytest (3 tests)
   ├── job: web   → npm ci, tsc --noEmit, vite build
   └── job: deploy (push to main only, needs: [api, web])
                  → SSH to VPS, git pull, docker compose up -d --build
```
The deploy key is a dedicated SSH key (separate from the personal key), stored in GitHub
Secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PATH`).

---

## 10. Stack summary

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16 + PostGIS 3.4 (kartoza image), GiST indexes |
| API | FastAPI + asyncpg (no ORM), uvicorn, prometheus_client |
| Frontend | React 19, TypeScript, Vite, MapLibre GL JS v5, satellite.js |
| Basemap | EOX s2cloudless-2023 (WMTS, free tier) |
| External data | CelesTrak (TLEs), Copernicus Data Space STAC (Sentinel-2 L2A) |
| Infra | Docker Compose, nginx, Nginx Proxy Manager, Cloudflare, GitHub Actions |

---

## 11. Design decisions

- **PostGIS is the brain.** Spatial reasoning lives in the database, not Python — this is
  what scales and what makes the query auditable.
- **Docker Compose over Kubernetes.** A single-node, three-container deployment; an
  orchestrator would be unjustified complexity. (K8s manifests deliberately omitted.)
- **Hand-rolled match query over a heavyweight catalogue.** Transparent and auditable for a
  demo; the production path is a STAC catalogue (pgstac) + vector tiles.
- **Ephemeral AOI matching.** The draw tool runs an in-memory match, with no DB writes —
  the value is the live spatial query, not persistence.
- **Built with AI-assisted development under human review** — architecture, data design,
  and correctness checks held with the author; every change verified against the running
  system before commit.
