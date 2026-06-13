-- Orbital Viewer schema
-- PostGIS extension is already loaded by the kartoza image via POSTGRES_MULTIPLE_EXTENSIONS

CREATE TABLE IF NOT EXISTS pass_footprints (
    id              SERIAL PRIMARY KEY,
    satellite       TEXT        NOT NULL,
    sensor_type     TEXT        NOT NULL CHECK (sensor_type IN ('optical','thermal','hyperspectral','SWIR','RF')),
    pass_start      TIMESTAMPTZ NOT NULL,
    pass_end        TIMESTAMPTZ NOT NULL,
    cloud_cover_pct NUMERIC(5,2) NOT NULL CHECK (cloud_cover_pct >= 0 AND cloud_cover_pct <= 100),
    footprint       GEOMETRY(POLYGON, 4326) NOT NULL,
    CHECK (pass_end > pass_start)
);

CREATE INDEX IF NOT EXISTS idx_pass_footprints_geom
    ON pass_footprints USING GIST (footprint);

CREATE INDEX IF NOT EXISTS idx_pass_footprints_time
    ON pass_footprints (pass_start, pass_end);


CREATE TABLE IF NOT EXISTS collection_needs (
    id              SERIAL PRIMARY KEY,
    name            TEXT        NOT NULL,
    aoi             GEOMETRY(POLYGON, 4326) NOT NULL,
    priority        INTEGER     NOT NULL CHECK (priority BETWEEN 1 AND 5),
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    max_cloud_pct   NUMERIC(5,2) NOT NULL CHECK (max_cloud_pct >= 0 AND max_cloud_pct <= 100),
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','scheduled','collected','cancelled')),
    sensor_pref     TEXT,
    notes           TEXT,
    CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS idx_collection_needs_geom
    ON collection_needs USING GIST (aoi);


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
