-- Orbital Viewer seed data
-- ~30 simulated Altair passes over UAE/Gulf region, June 8-15 2026
-- Swath widths vary by sensor type: optical ~20km, thermal ~30km,
-- hyperspectral ~15km, SWIR ~25km, RF ~50km
-- Footprints use ST_MakeEnvelope(minX, minY, maxX, maxY, 4326)

INSERT INTO pass_footprints
    (satellite, sensor_type, pass_start, pass_end, cloud_cover_pct, footprint)
VALUES
-- June 8 passes
('Altair-1', 'optical',        '2026-06-08 06:12:00+00', '2026-06-08 06:16:00+00',  2.5,
 ST_MakeEnvelope(54.10, 24.20, 54.30, 24.38, 4326)),
('Altair-2', 'thermal',        '2026-06-08 08:45:00+00', '2026-06-08 08:50:00+00',  8.0,
 ST_MakeEnvelope(56.20, 24.05, 56.47, 24.32, 4326)),
('Altair-1', 'hyperspectral',  '2026-06-08 10:31:00+00', '2026-06-08 10:34:00+00',  0.0,
 ST_MakeEnvelope(55.10, 25.05, 55.24, 25.18, 4326)),
('Altair-3', 'SWIR',           '2026-06-08 13:05:00+00', '2026-06-08 13:09:00+00', 12.0,
 ST_MakeEnvelope(54.35, 24.40, 54.58, 24.63, 4326)),
('Altair-2', 'RF',             '2026-06-08 15:50:00+00', '2026-06-08 15:55:00+00',  5.0,
 ST_MakeEnvelope(55.80, 23.90, 56.25, 24.35, 4326)),

-- June 9 passes
('Altair-1', 'optical',        '2026-06-09 05:58:00+00', '2026-06-09 06:02:00+00',  3.0,
 ST_MakeEnvelope(54.50, 24.35, 54.68, 24.53, 4326)),
('Altair-3', 'thermal',        '2026-06-09 09:20:00+00', '2026-06-09 09:25:00+00', 18.5,
 ST_MakeEnvelope(55.25, 25.15, 55.52, 25.42, 4326)),
('Altair-2', 'SWIR',           '2026-06-09 11:45:00+00', '2026-06-09 11:49:00+00',  7.0,
 ST_MakeEnvelope(56.00, 24.50, 56.22, 24.72, 4326)),
('Altair-1', 'hyperspectral',  '2026-06-09 14:10:00+00', '2026-06-09 14:13:00+00',  0.0,
 ST_MakeEnvelope(54.20, 24.10, 54.35, 24.23, 4326)),
('Altair-3', 'RF',             '2026-06-09 16:35:00+00', '2026-06-09 16:40:00+00', 22.0,
 ST_MakeEnvelope(55.00, 24.00, 55.45, 24.45, 4326)),

-- June 10 passes
('Altair-2', 'optical',        '2026-06-10 06:30:00+00', '2026-06-10 06:34:00+00',  5.5,
 ST_MakeEnvelope(54.38, 24.38, 54.56, 24.56, 4326)),
('Altair-1', 'thermal',        '2026-06-10 08:05:00+00', '2026-06-10 08:10:00+00', 30.0,
 ST_MakeEnvelope(55.55, 25.10, 55.82, 25.37, 4326)),
('Altair-3', 'hyperspectral',  '2026-06-10 10:55:00+00', '2026-06-10 10:58:00+00', 15.0,
 ST_MakeEnvelope(56.15, 24.80, 56.29, 24.93, 4326)),
('Altair-2', 'SWIR',           '2026-06-10 13:40:00+00', '2026-06-10 13:44:00+00',  9.0,
 ST_MakeEnvelope(54.15, 24.22, 54.38, 24.45, 4326)),
('Altair-1', 'RF',             '2026-06-10 17:15:00+00', '2026-06-10 17:20:00+00', 38.0,
 ST_MakeEnvelope(55.30, 24.80, 55.78, 25.28, 4326)),

-- June 11 passes
('Altair-3', 'optical',        '2026-06-11 07:00:00+00', '2026-06-11 07:04:00+00',  1.0,
 ST_MakeEnvelope(55.00, 25.00, 55.18, 25.18, 4326)),
('Altair-2', 'thermal',        '2026-06-11 09:40:00+00', '2026-06-11 09:45:00+00', 25.0,
 ST_MakeEnvelope(54.60, 24.55, 54.87, 24.82, 4326)),
('Altair-1', 'SWIR',           '2026-06-11 12:20:00+00', '2026-06-11 12:24:00+00',  4.0,
 ST_MakeEnvelope(56.10, 24.60, 56.33, 24.83, 4326)),
('Altair-3', 'hyperspectral',  '2026-06-11 15:00:00+00', '2026-06-11 15:03:00+00',  0.0,
 ST_MakeEnvelope(54.40, 24.30, 54.54, 24.44, 4326)),
('Altair-2', 'RF',             '2026-06-11 18:10:00+00', '2026-06-11 18:15:00+00', 10.0,
 ST_MakeEnvelope(54.80, 24.20, 55.25, 24.65, 4326)),

-- June 12 passes
('Altair-1', 'optical',        '2026-06-12 06:15:00+00', '2026-06-12 06:19:00+00',  6.0,
 ST_MakeEnvelope(55.20, 25.08, 55.38, 25.26, 4326)),
('Altair-3', 'thermal',        '2026-06-12 10:00:00+00', '2026-06-12 10:05:00+00', 20.0,
 ST_MakeEnvelope(54.30, 24.40, 54.57, 24.67, 4326)),
('Altair-2', 'hyperspectral',  '2026-06-12 14:30:00+00', '2026-06-12 14:33:00+00',  0.0,
 ST_MakeEnvelope(55.90, 25.20, 56.04, 25.34, 4326)),

-- June 13 passes
('Altair-1', 'SWIR',           '2026-06-13 07:45:00+00', '2026-06-13 07:49:00+00', 35.0,
 ST_MakeEnvelope(55.60, 24.90, 55.83, 25.13, 4326)),
('Altair-3', 'optical',        '2026-06-13 11:30:00+00', '2026-06-13 11:34:00+00',  2.0,
 ST_MakeEnvelope(54.45, 24.42, 54.63, 24.60, 4326)),
('Altair-2', 'RF',             '2026-06-13 16:00:00+00', '2026-06-13 16:05:00+00', 15.0,
 ST_MakeEnvelope(55.40, 24.50, 55.85, 24.95, 4326)),

-- June 14 passes
('Altair-1', 'thermal',        '2026-06-14 08:20:00+00', '2026-06-14 08:25:00+00', 28.0,
 ST_MakeEnvelope(56.00, 24.35, 56.27, 24.62, 4326)),
('Altair-3', 'hyperspectral',  '2026-06-14 12:10:00+00', '2026-06-14 12:13:00+00',  3.0,
 ST_MakeEnvelope(54.22, 24.25, 54.36, 24.39, 4326)),
('Altair-2', 'optical',        '2026-06-14 15:55:00+00', '2026-06-14 15:59:00+00',  8.0,
 ST_MakeEnvelope(55.00, 25.10, 55.18, 25.28, 4326)),

-- June 15 passes
('Altair-1', 'SWIR',           '2026-06-15 06:50:00+00', '2026-06-15 06:54:00+00',  0.0,
 ST_MakeEnvelope(54.55, 24.50, 54.78, 24.73, 4326)),
('Altair-3', 'RF',             '2026-06-15 10:40:00+00', '2026-06-15 10:45:00+00', 40.0,
 ST_MakeEnvelope(55.70, 24.70, 56.15, 25.15, 4326)),
('Altair-2', 'optical',        '2026-06-15 14:20:00+00', '2026-06-15 14:24:00+00',  5.0,
 ST_MakeEnvelope(55.15, 24.95, 55.33, 25.13, 4326));


-- Collection needs: UAE/Gulf AOIs
INSERT INTO collection_needs
    (name, aoi, priority, window_start, window_end, max_cloud_pct, status, sensor_pref, notes)
VALUES
(
    'ADMA Maritime — Abu Dhabi Port & Coastal',
    ST_MakeEnvelope(54.30, 24.30, 54.60, 24.55, 4326),
    1,
    '2026-06-08 00:00:00+00',
    '2026-06-15 23:59:59+00',
    15.0,
    'pending',
    'optical',
    'ADMA-OPCO vessel traffic monitoring, port approach and coastal zone'
),
(
    'Musaffah Industrial Zone',
    ST_MakeEnvelope(54.45, 24.32, 54.62, 24.48, 4326),
    2,
    '2026-06-09 00:00:00+00',
    '2026-06-14 23:59:59+00',
    20.0,
    'pending',
    'thermal',
    'Industrial heat signature survey, Musaffah manufacturing district'
),
(
    'Ruwais Energy Complex',
    ST_MakeEnvelope(52.65, 24.05, 52.95, 24.30, 4326),
    1,
    '2026-06-08 00:00:00+00',
    '2026-06-13 23:59:59+00',
    10.0,
    'pending',
    'hyperspectral',
    'ADNOC Ruwais refinery and petrochemical complex change detection'
),
(
    'Urban Abu Dhabi — Downtown Core',
    ST_MakeEnvelope(54.32, 24.44, 54.55, 24.60, 4326),
    3,
    '2026-06-10 00:00:00+00',
    '2026-06-15 23:59:59+00',
    25.0,
    'pending',
    NULL,
    'Urban development monitoring, Corniche and downtown districts'
),
(
    'Dubai Coast — JBR to Palm',
    ST_MakeEnvelope(55.08, 25.05, 55.20, 25.22, 4326),
    2,
    '2026-06-08 00:00:00+00',
    '2026-06-15 23:59:59+00',
    15.0,
    'pending',
    'optical',
    'Coastal zone monitoring: JBR, Dubai Marina, Palm Jumeirah approach'
);
