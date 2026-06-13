import os
import time
import json
import asyncio
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import (
    Counter, Histogram, Gauge,
    generate_latest, CONTENT_TYPE_LATEST,
)

# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------
REQUEST_COUNT = Counter(
    "orbital_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)
REQUEST_LATENCY = Histogram(
    "orbital_request_latency_seconds",
    "HTTP request latency",
    ["endpoint"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)
PASSES_TOTAL = Gauge("orbital_passes_total", "Total pass footprints in DB")


# ---------------------------------------------------------------------------
# DB pool
# ---------------------------------------------------------------------------
_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    return _pool  # type: ignore[return-value]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pool
    dsn = os.environ["DATABASE_URL"]
    for attempt in range(10):
        try:
            _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
            break
        except Exception:
            await asyncio.sleep(2)
    else:
        raise RuntimeError("Could not connect to database after 10 attempts")

    async with _pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM pass_footprints")
        PASSES_TOTAL.set(count)

    yield

    await _pool.close()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Orbital Viewer API", lifespan=lifespan)

FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _record(endpoint: str, status: int, method: str, elapsed: float):
    REQUEST_COUNT.labels(method=method, endpoint=endpoint, status=str(status)).inc()
    REQUEST_LATENCY.labels(endpoint=endpoint).observe(elapsed)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _row_to_feature(row: asyncpg.Record, geom_key: str = "geojson") -> dict:
    props = {k: v for k, v in dict(row).items() if k != geom_key}
    # Convert non-serialisable types
    for k, v in props.items():
        if hasattr(v, "isoformat"):
            props[k] = v.isoformat()
        elif hasattr(v, "__float__"):
            props[k] = float(v)
    return {
        "type": "Feature",
        "geometry": json.loads(row[geom_key]),
        "properties": props,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    t0 = time.perf_counter()
    db_ok = False
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        pass
    _record("/api/health", 200, "GET", time.perf_counter() - t0)
    return {"status": "ok", "db": "ok" if db_ok else "error"}


@app.get("/api/passes")
async def get_passes(
    sensor: str | None = Query(None),
    max_cloud: float | None = Query(None, ge=0, le=100),
    start: str | None = Query(None),
    end: str | None = Query(None),
):
    t0 = time.perf_counter()
    pool = await get_pool()

    conditions = ["1=1"]
    args: list = []

    if sensor:
        args.append(sensor)
        conditions.append(f"sensor_type = ${len(args)}")
    if max_cloud is not None:
        args.append(max_cloud)
        conditions.append(f"cloud_cover_pct <= ${len(args)}")
    if start:
        args.append(start)
        conditions.append(f"pass_start >= ${len(args)}::timestamptz")
    if end:
        args.append(end)
        conditions.append(f"pass_end <= ${len(args)}::timestamptz")

    where = " AND ".join(conditions)
    sql = f"""
        SELECT id, satellite, sensor_type, pass_start, pass_end, cloud_cover_pct,
               ST_AsGeoJSON(footprint)::text AS geojson
        FROM pass_footprints
        WHERE {where}
        ORDER BY pass_start
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)

    features = [_row_to_feature(r) for r in rows]
    _record("/api/passes", 200, "GET", time.perf_counter() - t0)
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/needs")
async def get_needs():
    t0 = time.perf_counter()
    pool = await get_pool()
    sql = """
        SELECT id, name, priority, window_start, window_end,
               max_cloud_pct, status, sensor_pref, notes,
               ST_AsGeoJSON(aoi)::text AS geojson
        FROM collection_needs
        ORDER BY priority, id
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)

    features = [_row_to_feature(r) for r in rows]
    _record("/api/needs", 200, "GET", time.perf_counter() - t0)
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/needs/{need_id}/matches")
async def get_matches(need_id: int):
    t0 = time.perf_counter()
    pool = await get_pool()

    sql = """
        SELECT
            p.id                                                      AS pass_id,
            p.satellite,
            p.sensor_type,
            p.pass_start,
            p.pass_end,
            p.cloud_cover_pct,
            ROUND(
                (ST_Area(
                    ST_Intersection(p.footprint, n.aoi)::geography
                ) / 1e6)::numeric,
                2
            )                                                         AS coverage_km2
        FROM pass_footprints p
        JOIN collection_needs n ON n.id = $1
        WHERE
            ST_Intersects(p.footprint, n.aoi)
            AND p.pass_start >= n.window_start
            AND p.pass_end   <= n.window_end
            AND p.cloud_cover_pct <= n.max_cloud_pct
        ORDER BY p.cloud_cover_pct, p.pass_start
    """
    async with pool.acquire() as conn:
        need_exists = await conn.fetchval(
            "SELECT id FROM collection_needs WHERE id = $1", need_id
        )
        if not need_exists:
            _record("/api/needs/{id}/matches", 404, "GET", time.perf_counter() - t0)
            raise HTTPException(status_code=404, detail="Need not found")
        rows = await conn.fetch(sql, need_id)

    result = []
    for r in rows:
        result.append({
            "pass_id": r["pass_id"],
            "satellite": r["satellite"],
            "sensor_type": r["sensor_type"],
            "pass_start": r["pass_start"].isoformat(),
            "pass_end": r["pass_end"].isoformat(),
            "cloud_cover_pct": float(r["cloud_cover_pct"]),
            "coverage_km2": float(r["coverage_km2"]) if r["coverage_km2"] is not None else 0.0,
        })

    _record("/api/needs/{id}/matches", 200, "GET", time.perf_counter() - t0)
    return result


@app.get("/metrics")
async def metrics():
    data = generate_latest()
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)
