#!/usr/bin/env python3
"""
Ingest real Sentinel-2 L2A acquisition footprints from the Copernicus STAC API
into the real_acquisitions PostGIS table.

Usage (from repo root):
    DATABASE_URL=postgresql://... python api/scripts/ingest_sentinel.py

Or with .env:
    python api/scripts/ingest_sentinel.py   # loads .env automatically
"""
import asyncio
import json
import os
import sys
from datetime import date, datetime, timedelta

import asyncpg
import httpx
from dotenv import load_dotenv

load_dotenv()

STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search"
COLLECTION = "sentinel-2-l2a"
# UAE / Gulf of Oman bounding box
AOI = {
    "type": "Polygon",
    "coordinates": [[[51, 22], [57, 22], [57, 27], [51, 27], [51, 22]]],
}
MAX_ITEMS = 40
CLOUD_MAX = 30

DDL = """
CREATE TABLE IF NOT EXISTS real_acquisitions (
    id              SERIAL PRIMARY KEY,
    source          TEXT         NOT NULL DEFAULT 'sentinel-2',
    product_id      TEXT         NOT NULL UNIQUE,
    footprint       GEOMETRY(POLYGON, 4326) NOT NULL,
    acquired_at     TIMESTAMPTZ  NOT NULL,
    cloud_cover_pct NUMERIC(5,2) NOT NULL CHECK (cloud_cover_pct >= 0 AND cloud_cover_pct <= 100),
    sensor          TEXT         NOT NULL DEFAULT 'optical'
);
CREATE INDEX IF NOT EXISTS idx_real_acquisitions_geom
    ON real_acquisitions USING GIST (footprint);
"""


async def fetch_stac_items(start: str, end: str) -> list[dict]:
    body = {
        "collections": [COLLECTION],
        "limit": MAX_ITEMS,
        "datetime": f"{start}/{end}",
        "filter-lang": "cql2-json",
        "filter": {
            "op": "and",
            "args": [
                {
                    "op": "s_intersects",
                    "args": [{"property": "geometry"}, AOI],
                },
                {
                    "op": "<=",
                    "args": [{"property": "eo:cloud_cover"}, CLOUD_MAX],
                },
            ],
        },
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(STAC_URL, json=body)
        resp.raise_for_status()
    return resp.json().get("features", [])


async def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("DATABASE_URL not set")

    end_date = date.today()
    start_date = end_date - timedelta(days=14)
    start = f"{start_date}T00:00:00Z"
    end = f"{end_date}T23:59:59Z"

    print(
        f"Fetching Sentinel-2 L2A over UAE/Gulf "
        f"{start_date} – {end_date}, cloud ≤ {CLOUD_MAX}% …"
    )
    items = await fetch_stac_items(start, end)
    print(f"STAC returned {len(items)} item(s)")

    if not items:
        print("Nothing to ingest.")
        return

    conn = await asyncpg.connect(db_url)
    try:
        await conn.execute(DDL)

        inserted = skipped = errors = 0
        for item in items:
            try:
                product_id: str = item["id"]
                geom_data: dict = item["geometry"]
                # Sentinel-2 tiles are always Polygons; guard against rare MultiPolygon
                if geom_data["type"] == "MultiPolygon":
                    geom_data = {"type": "Polygon", "coordinates": geom_data["coordinates"][0]}
                geom_json = json.dumps(geom_data)
                props = item["properties"]
                acquired_at: datetime = datetime.fromisoformat(
                    props["datetime"].replace("Z", "+00:00")
                )
                cloud = float(props.get("eo:cloud_cover", 0))

                row = await conn.fetchrow(
                    """
                    INSERT INTO real_acquisitions
                        (source, product_id, footprint, acquired_at, cloud_cover_pct, sensor)
                    VALUES ('sentinel-2', $1, ST_GeomFromGeoJSON($2), $3, $4, 'optical')
                    ON CONFLICT (product_id) DO NOTHING
                    RETURNING id
                    """,
                    product_id,
                    geom_json,
                    acquired_at,
                    cloud,
                )
                if row:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as exc:
                print(f"  ERROR {item.get('id', '?')}: {exc}")
                errors += 1

        total = await conn.fetchval("SELECT COUNT(*) FROM real_acquisitions")
        print(
            f"\nDone — inserted: {inserted}, skipped (already existed): {skipped}, "
            f"errors: {errors}"
        )
        print(f"real_acquisitions table now has {total} row(s)")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
