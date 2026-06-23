import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import { buildSatGeoJSON, SAT_COLOR, type TleMap } from './satellites'

// ── Types ────────────────────────────────────────────────────────────────────

interface PassProps {
  id: number
  satellite: string
  sensor_type: string
  pass_start: string
  pass_end: string
  cloud_cover_pct: number
}

interface NeedProps {
  id: number
  name: string
  priority: number
  window_start: string
  window_end: string
  max_cloud_pct: number
  status: string
  sensor_pref: string | null
  notes: string | null
}

interface AcquisitionProps {
  id: number
  source: string
  product_id: string
  acquired_at: string
  cloud_cover_pct: number
  sensor: string
}

interface Match {
  pass_id: number
  satellite: string
  sensor_type: string
  pass_start: string
  pass_end: string
  cloud_cover_pct: number
  coverage_km2: number
  source: string
}

interface TaskingMatch {
  pass_id: number
  satellite: string
  sensor_type: string
  pass_start: string
  pass_end: string
  cloud_cover_pct: number
  coverage_km2: number
  source: string
  geojson: string
}

type DrawMode = 'idle' | 'waitingFirst' | 'waitingSecond' | 'drawn'

const ACQ_COLOR = '#22d3ee'
const MATCH_SIM_COLOR = '#fbbf24'   // amber for simulated tasking matches

// ── Sensor colour palette ────────────────────────────────────────────────────

const SENSOR_COLORS: Record<string, string> = {
  optical: '#38bdf8',
  thermal: '#f97316',
  hyperspectral: '#a78bfa',
  SWIR: '#34d399',
  RF: '#fb7185',
}

const SENSOR_ORDER = Object.keys(SENSOR_COLORS)

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  })
}

function bboxPolygon(
  lng1: number, lat1: number,
  lng2: number, lat2: number,
) {
  const minLng = Math.min(lng1, lng2)
  const maxLng = Math.max(lng1, lng2)
  const minLat = Math.min(lat1, lat2)
  const maxLat = Math.max(lat1, lat2)
  return {
    type: 'Polygon' as const,
    coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]],
  }
}

// ── Main component ───────────────────────────────────────────────────────────

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)

  // Existing state
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [selectedNeed, setSelectedNeed] = useState<NeedProps | null>(null)
  const [showSats, setShowSats] = useState(true)
  const [showPasses, setShowPasses] = useState(false)
  const [showAcq, setShowAcq] = useState(false)

  // Panel collapse state — both collapsed by default (map-first first impression).
  // On narrow screens this keeps the bare globe + real data visible on landing.
  const [taskingOpen, setTaskingOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)

  // Drawing state (refs for map handlers, state for UI re-render)
  const drawModeRef = useRef<DrawMode>('idle')
  const corner1Ref = useRef<{ lng: number; lat: number } | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode>('idle')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [aoiGeom, setAoiGeom] = useState<any>(null)

  // Tasking constraints
  const [taskingSensor, setTaskingSensor] = useState('any')
  const [taskingCloud, setTaskingCloud] = useState(50)
  const [taskingStart, setTaskingStart] = useState('2026-06-08')
  const [taskingEnd, setTaskingEnd] = useState('2026-06-15')
  const [taskingResults, setTaskingResults] = useState<TaskingMatch[] | null>(null)
  const [taskingLoading, setTaskingLoading] = useState(false)

  const fetchMatches = useCallback(async (needId: number) => {
    setLoadingMatches(true)
    try {
      const res = await fetch(`/api/needs/${needId}/matches`)
      const data: Match[] = await res.json()
      setMatches(data)
    } catch {
      setMatches([])
    } finally {
      setLoadingMatches(false)
    }
  }, [])

  // Clear all tasking state + map layers
  const clearTasking = useCallback(() => {
    drawModeRef.current = 'idle'
    corner1Ref.current = null
    setDrawMode('idle')
    setAoiGeom(null)
    setTaskingResults(null)
    const m = map.current
    if (!m) return
    m.getCanvas().style.cursor = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empty: any = { type: 'FeatureCollection', features: [] }
    const aoiSrc = m.getSource('aoi-draw') as maplibregl.GeoJSONSource | undefined
    if (aoiSrc) aoiSrc.setData(empty)
    const matchSrc = m.getSource('tasking-matches') as maplibregl.GeoJSONSource | undefined
    if (matchSrc) matchSrc.setData(empty)
  }, [])

  // Enter rectangle-draw mode
  const startDrawing = useCallback(() => {
    drawModeRef.current = 'waitingFirst'
    corner1Ref.current = null
    setDrawMode('waitingFirst')
    setAoiGeom(null)
    setTaskingResults(null)
    const m = map.current
    if (!m) return
    m.getCanvas().style.cursor = 'crosshair'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empty: any = { type: 'FeatureCollection', features: [] }
    const aoiSrc = m.getSource('aoi-draw') as maplibregl.GeoJSONSource | undefined
    if (aoiSrc) aoiSrc.setData(empty)
    const matchSrc = m.getSource('tasking-matches') as maplibregl.GeoJSONSource | undefined
    if (matchSrc) matchSrc.setData(empty)
  }, [])

  // Submit AOI to /api/match
  const submitTasking = useCallback(async () => {
    if (!aoiGeom) return
    setTaskingLoading(true)
    setTaskingResults(null)
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: aoiGeom,
          sensor: taskingSensor === 'any' ? null : taskingSensor,
          max_cloud: taskingCloud,
          window_start: taskingStart ? `${taskingStart}T00:00:00Z` : null,
          window_end: taskingEnd ? `${taskingEnd}T23:59:59Z` : null,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: TaskingMatch[] = await res.json()
      setTaskingResults(data)
      const m = map.current
      if (m) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fc: any = {
          type: 'FeatureCollection',
          features: data.map(d => ({
            type: 'Feature',
            geometry: JSON.parse(d.geojson),
            properties: { source: d.source, satellite: d.satellite, sensor_type: d.sensor_type },
          })),
        }
        const matchSrc = m.getSource('tasking-matches') as maplibregl.GeoJSONSource | undefined
        if (matchSrc) matchSrc.setData(fc)
      }
    } catch {
      setTaskingResults([])
    } finally {
      setTaskingLoading(false)
    }
  }, [aoiGeom, taskingSensor, taskingCloud, taskingStart, taskingEnd])

  useEffect(() => {
    if (map.current || !mapContainer.current) return

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        name: 'EOX S2Cloudless Globe',
        projection: { type: 'globe' },
        sources: {
          's2cloudless': {
            type: 'raster',
            tiles: [
              'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
            ],
            tileSize: 256,
            attribution: 'Sentinel-2 cloudless 2025 by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
            maxzoom: 15,
          },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#0d1b2a' },
          },
          {
            id: 's2cloudless',
            type: 'raster',
            source: 's2cloudless',
          },
        ],
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      },
      center: [54.5, 24.5],
      zoom: 6.5,
      // @ts-expect-error MapLibre GL 5 types do not yet include top-level projection option
      projection: 'globe' as unknown as maplibregl.ProjectionSpecification,
    })

    // Atmosphere / sky
    m.on('style.load', () => {
      // @ts-expect-error setFog not yet in MapLibre GL 5 type definitions
      m.setFog({
        color: 'rgb(10, 20, 40)',
        'high-color': 'rgb(15, 30, 80)',
        'horizon-blend': 0.05,
        'space-color': 'rgb(5, 5, 20)',
        'star-intensity': 0.6,
      })
    })

    m.addControl(new maplibregl.NavigationControl(), 'top-right')

    popup.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '340px',
      className: 'ov-popup',
    })

    m.on('load', async () => {
      // ── Fetch data ──────────────────────────────────────────────────────
      const [passesRes, needsRes, acqRes] = await Promise.all([
        fetch('/api/passes'),
        fetch('/api/needs'),
        fetch('/api/acquisitions'),
      ])
      const passes = await passesRes.json()
      const needs = await needsRes.json()
      const acquisitions = await acqRes.json()

      // ── Pass footprints source ──────────────────────────────────────────
      m.addSource('passes', { type: 'geojson', data: passes })

      m.addLayer({
        id: 'passes-fill',
        type: 'fill',
        source: 'passes',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'match', ['get', 'sensor_type'],
            'optical',        SENSOR_COLORS.optical,
            'thermal',        SENSOR_COLORS.thermal,
            'hyperspectral',  SENSOR_COLORS.hyperspectral,
            'SWIR',           SENSOR_COLORS.SWIR,
            'RF',             SENSOR_COLORS.RF,
            '#aaa',
          ],
          'fill-opacity': 0.35,
        },
      })

      m.addLayer({
        id: 'passes-outline',
        type: 'line',
        source: 'passes',
        layout: { visibility: 'none' },
        paint: {
          'line-color': [
            'match', ['get', 'sensor_type'],
            'optical',        SENSOR_COLORS.optical,
            'thermal',        SENSOR_COLORS.thermal,
            'hyperspectral',  SENSOR_COLORS.hyperspectral,
            'SWIR',           SENSOR_COLORS.SWIR,
            'RF',             SENSOR_COLORS.RF,
            '#aaa',
          ],
          'line-width': 1,
          'line-opacity': 0.8,
        },
      })

      // ── Collection needs source ─────────────────────────────────────────
      m.addSource('needs', { type: 'geojson', data: needs })

      m.addLayer({
        id: 'needs-fill',
        type: 'fill',
        source: 'needs',
        paint: {
          'fill-color': '#facc15',
          'fill-opacity': 0.05,
        },
      })

      m.addLayer({
        id: 'needs-outline',
        type: 'line',
        source: 'needs',
        paint: {
          'line-color': '#facc15',
          'line-width': 2,
          'line-dasharray': [4, 3],
          'line-opacity': 0.9,
        },
      })

      // ── Real Sentinel-2 acquisitions source ────────────────────────────
      m.addSource('acquisitions', { type: 'geojson', data: acquisitions })

      m.addLayer({
        id: 'acquisitions-fill',
        type: 'fill',
        source: 'acquisitions',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': ACQ_COLOR,
          'fill-opacity': 0.18,
        },
      })

      m.addLayer({
        id: 'acquisitions-outline',
        type: 'line',
        source: 'acquisitions',
        layout: { visibility: 'none' },
        paint: {
          'line-color': ACQ_COLOR,
          'line-width': 1.5,
          'line-opacity': 0.9,
        },
      })

      // ── AOI draw source/layers ─────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emptyFC: any = { type: 'FeatureCollection', features: [] }
      m.addSource('aoi-draw', { type: 'geojson', data: emptyFC })
      m.addLayer({
        id: 'aoi-fill',
        type: 'fill',
        source: 'aoi-draw',
        paint: { 'fill-color': '#f97316', 'fill-opacity': 0.10 },
      })
      m.addLayer({
        id: 'aoi-outline',
        type: 'line',
        source: 'aoi-draw',
        paint: { 'line-color': '#f97316', 'line-width': 2, 'line-dasharray': [5, 3] },
      })

      // ── Tasking match results source/layers ────────────────────────────
      m.addSource('tasking-matches', { type: 'geojson', data: emptyFC })
      m.addLayer({
        id: 'tasking-matches-fill',
        type: 'fill',
        source: 'tasking-matches',
        paint: {
          'fill-color': [
            'match', ['get', 'source'],
            'real-s2', ACQ_COLOR,
            MATCH_SIM_COLOR,
          ],
          'fill-opacity': 0.45,
        },
      })
      m.addLayer({
        id: 'tasking-matches-outline',
        type: 'line',
        source: 'tasking-matches',
        paint: {
          'line-color': [
            'match', ['get', 'source'],
            'real-s2', ACQ_COLOR,
            MATCH_SIM_COLOR,
          ],
          'line-width': 2.5,
          'line-opacity': 1.0,
        },
      })

      // ── Acquisition click handler ───────────────────────────────────────
      m.on('click', 'acquisitions-fill', (e) => {
        if (drawModeRef.current === 'waitingFirst' || drawModeRef.current === 'waitingSecond') return
        const feat = e.features?.[0]
        if (!feat) return
        const a = feat.properties as AcquisitionProps
        const html = `
          <div class="ov-popup-inner">
            <div class="ov-popup-title">
              <span class="ov-sensor-dot" style="background:${ACQ_COLOR}"></span>
              Real Sentinel-2 Acquisition
            </div>
            <table class="ov-table">
              <tr><td>Product</td><td style="font-size:10px;word-break:break-all">${a.product_id}</td></tr>
              <tr><td>Acquired</td><td>${fmtTime(a.acquired_at)}</td></tr>
              <tr><td>Cloud</td><td>${a.cloud_cover_pct}%</td></tr>
            </table>
          </div>`
        popup.current!
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(m)
        setSelectedNeed(null)
        setMatches(null)
      })

      m.on('mouseenter', 'acquisitions-fill', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'acquisitions-fill', () => {
        if (drawModeRef.current === 'waitingFirst' || drawModeRef.current === 'waitingSecond') {
          m.getCanvas().style.cursor = 'crosshair'
        } else {
          m.getCanvas().style.cursor = ''
        }
      })

      // ── Pass click handler ──────────────────────────────────────────────
      m.on('click', 'passes-fill', (e) => {
        if (drawModeRef.current === 'waitingFirst' || drawModeRef.current === 'waitingSecond') return
        const feat = e.features?.[0]
        if (!feat) return
        const p = feat.properties as PassProps
        const html = `
          <div class="ov-popup-inner">
            <div class="ov-popup-title">
              <span class="ov-sensor-dot" style="background:${SENSOR_COLORS[p.sensor_type] ?? '#aaa'}"></span>
              ${p.satellite} — ${p.sensor_type}
            </div>
            <table class="ov-table">
              <tr><td>Start</td><td>${fmtTime(p.pass_start)}</td></tr>
              <tr><td>End</td><td>${fmtTime(p.pass_end)}</td></tr>
              <tr><td>Cloud</td><td>${p.cloud_cover_pct}%</td></tr>
            </table>
          </div>`
        popup.current!
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(m)
        setSelectedNeed(null)
        setMatches(null)
      })

      // ── Need click handler ──────────────────────────────────────────────
      m.on('click', 'needs-outline', (e) => {
        if (drawModeRef.current === 'waitingFirst' || drawModeRef.current === 'waitingSecond') return
        const feat = e.features?.[0]
        if (!feat) return
        const n = feat.properties as NeedProps
        setSelectedNeed(n)
        setMatches(null)
        fetchMatches(n.id)

        const html = `
          <div class="ov-popup-inner">
            <div class="ov-popup-title ov-need-title">
              📍 ${n.name}
            </div>
            <table class="ov-table">
              <tr><td>Priority</td><td>${n.priority}</td></tr>
              <tr><td>Status</td><td>${n.status}</td></tr>
              <tr><td>Window</td><td>${fmtTime(n.window_start)}</td></tr>
              <tr><td></td><td>→ ${fmtTime(n.window_end)}</td></tr>
              <tr><td>Max cloud</td><td>${n.max_cloud_pct}%</td></tr>
              ${n.sensor_pref ? `<tr><td>Sensor</td><td>${n.sensor_pref}</td></tr>` : ''}
            </table>
            <div id="ov-matches-container" style="margin-top:8px">
              <em style="color:#94a3b8">Loading matches…</em>
            </div>
          </div>`
        popup.current!
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(m)
      })

      m.on('mouseenter', 'passes-fill', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'passes-fill', () => {
        if (drawModeRef.current === 'waitingFirst' || drawModeRef.current === 'waitingSecond') {
          m.getCanvas().style.cursor = 'crosshair'
        } else {
          m.getCanvas().style.cursor = ''
        }
      })
      m.on('mouseenter', 'needs-outline', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'needs-outline', () => {
        if (drawModeRef.current === 'waitingFirst' || drawModeRef.current === 'waitingSecond') {
          m.getCanvas().style.cursor = 'crosshair'
        } else {
          m.getCanvas().style.cursor = ''
        }
      })

      // ── Rectangle draw: two-click with live preview ────────────────────
      m.on('mousemove', (e) => {
        if (drawModeRef.current !== 'waitingSecond') return
        const c1 = corner1Ref.current
        if (!c1) return
        const poly = bboxPolygon(c1.lng, c1.lat, e.lngLat.lng, e.lngLat.lat)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fc: any = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: poly, properties: {} }] }
        const aoiSrc = m.getSource('aoi-draw') as maplibregl.GeoJSONSource | undefined
        if (aoiSrc) aoiSrc.setData(fc)
      })

      m.on('click', (e) => {
        const mode = drawModeRef.current
        if (mode === 'waitingFirst') {
          corner1Ref.current = { lng: e.lngLat.lng, lat: e.lngLat.lat }
          drawModeRef.current = 'waitingSecond'
          setDrawMode('waitingSecond')
        } else if (mode === 'waitingSecond') {
          const c1 = corner1Ref.current!
          const poly = bboxPolygon(c1.lng, c1.lat, e.lngLat.lng, e.lngLat.lat)
          drawModeRef.current = 'drawn'
          setDrawMode('drawn')
          setAoiGeom(poly)
          m.getCanvas().style.cursor = ''
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fc: any = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: poly, properties: {} }] }
          const aoiSrc = m.getSource('aoi-draw') as maplibregl.GeoJSONSource | undefined
          if (aoiSrc) aoiSrc.setData(fc)
        }
      })

      // ── Live satellite ground tracks (real TLE orbits) ──────────────────
      try {
        const tleRes = await fetch('/api/tles')
        if (tleRes.ok) {
          const tles = (await tleRes.json()) as TleMap
          const { markers, tracks } = buildSatGeoJSON(tles)

          m.addSource('sat-tracks', { type: 'geojson', data: tracks })
          m.addSource('sat-markers', { type: 'geojson', data: markers })

          m.addLayer({
            id: 'sat-tracks-line',
            type: 'line',
            source: 'sat-tracks',
            paint: {
              'line-color': SAT_COLOR,
              'line-width': 1,
              'line-opacity': 0.55,
            },
          })
          m.addLayer({
            id: 'sat-dots',
            type: 'circle',
            source: 'sat-markers',
            paint: {
              'circle-color': SAT_COLOR,
              'circle-radius': 5,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5,
            },
          })
          m.addLayer({
            id: 'sat-labels',
            type: 'symbol',
            source: 'sat-markers',
            layout: {
              'text-field': ['get', 'name'],
              'text-size': 11,
              'text-offset': [0, 1.4],
              'text-anchor': 'top',
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            },
            paint: {
              'text-color': SAT_COLOR,
              'text-halo-color': '#0d1b2a',
              'text-halo-width': 1.5,
            },
          })
        }
      } catch {
        // Satellite layer is optional; map loads fine without it
      }
    })

    map.current = m
    return () => { m.remove(); map.current = null }
  }, [fetchMatches])

  // Toggle satellite layer visibility
  useEffect(() => {
    const m = map.current
    if (!m) return
    const vis = showSats ? 'visible' : 'none'
    for (const id of ['sat-tracks-line', 'sat-dots', 'sat-labels']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis)
    }
  }, [showSats])

  // Toggle simulated-pass footprint visibility (off by default to keep the
  // default view clean; these are simulated geometry, labelled as such).
  useEffect(() => {
    const m = map.current
    if (!m) return
    const vis = showPasses ? 'visible' : 'none'
    for (const id of ['passes-fill', 'passes-outline']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis)
    }
  }, [showPasses])

  // Toggle real Sentinel-2 acquisition visibility (off by default for a clean
  // first view; clicking a shown footprint reveals its real Copernicus metadata).
  useEffect(() => {
    const m = map.current
    if (!m) return
    const vis = showAcq ? 'visible' : 'none'
    for (const id of ['acquisitions-fill', 'acquisitions-outline']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis)
    }
  }, [showAcq])

  // Update matches panel inside popup whenever matches arrive
  useEffect(() => {
    if (!selectedNeed || matches === null) return
    const el = document.getElementById('ov-matches-container')
    if (!el) return
    if (matches.length === 0) {
      el.innerHTML = '<em style="color:#94a3b8">No matching passes found.</em>'
      return
    }
    el.innerHTML = `
      <div class="ov-matches-header">Matches (${matches.length})</div>
      <table class="ov-table ov-matches-table">
        <thead><tr><th>Satellite</th><th>Sensor</th><th>Time (UTC)</th><th>Cloud</th><th>Cov km²</th><th>Source</th></tr></thead>
        <tbody>
          ${matches.map(m => `
            <tr>
              <td>${m.satellite}</td>
              <td><span class="ov-sensor-dot" style="background:${m.source === 'real-s2' ? ACQ_COLOR : (SENSOR_COLORS[m.sensor_type] ?? '#aaa')}"></span>${m.sensor_type}</td>
              <td>${fmtTime(m.pass_start)}</td>
              <td>${m.cloud_cover_pct}%</td>
              <td>${m.coverage_km2}</td>
              <td style="color:${m.source === 'real-s2' ? ACQ_COLOR : '#64748b'}">${m.source === 'real-s2' ? 'Real S2' : 'Simulated'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
  }, [matches, selectedNeed, loadingMatches])

  // ── Draw status text ─────────────────────────────────────────────────────

  const drawStatusText: Record<DrawMode, string> = {
    idle: 'No AOI drawn',
    waitingFirst: 'Click to set first corner',
    waitingSecond: 'Click to set opposite corner',
    drawn: 'AOI ready — adjust constraints and submit',
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="ov-header">
        <span className="ov-title">Orbital Viewer — Tasking Demo</span>
        <button className="ov-sat-toggle ov-passes-toggle" onClick={() => setShowPasses(v => !v)}>
          {showPasses ? 'Hide sim passes' : 'Show sim passes'}
        </button>
        <button className="ov-sat-toggle ov-acq-toggle" onClick={() => setShowAcq(v => !v)}>
          {showAcq ? 'Hide acquisitions' : 'Show acquisitions'}
        </button>
        <button className="ov-sat-toggle" onClick={() => setShowSats(v => !v)}>
          {showSats ? 'Hide orbits' : 'Show orbits'}
        </button>
      </header>

      {/* Map */}
      <div ref={mapContainer} className="map-container" />

      {/* ── Tasking Request panel ─────────────────────────────────────── */}
      <aside className={`ov-tasking-panel ${taskingOpen ? '' : 'ov-panel-collapsed'}`}>
        <button
          className="ov-panel-header"
          onClick={() => setTaskingOpen(v => !v)}
          aria-expanded={taskingOpen}
        >
          <span className="ov-panel-caret">{taskingOpen ? '▾' : '▸'}</span>
          <span className="ov-panel-title">Tasking Request</span>
          {!taskingOpen && <span className="ov-panel-hint">draw an AOI to find coverage</span>}
        </button>

        {taskingOpen && (
        <div className="ov-panel-body">
        <div className="ov-panel-section-label">1 · Draw AOI</div>
        <div className="ov-draw-controls">
          <button
            className={`ov-btn ${drawMode === 'idle' || drawMode === 'drawn' ? 'ov-btn-draw' : 'ov-btn-draw-active'}`}
            onClick={startDrawing}
          >
            {drawMode === 'drawn' ? 'Redraw Rectangle' : 'Draw Rectangle'}
          </button>
          {drawMode !== 'idle' && (
            <button className="ov-btn ov-btn-ghost" onClick={clearTasking}>
              Clear
            </button>
          )}
        </div>
        <div className="ov-draw-status">{drawStatusText[drawMode]}</div>

        <div className="ov-panel-section-label" style={{ marginTop: 12 }}>2 · Constraints</div>

        <div className="ov-form-row">
          <span className="ov-form-label">Sensor</span>
          <select
            value={taskingSensor}
            onChange={e => setTaskingSensor(e.target.value)}
            className="ov-select"
          >
            <option value="any">Any</option>
            <option value="optical">Optical</option>
            <option value="thermal">Thermal</option>
            <option value="hyperspectral">Hyperspectral</option>
            <option value="SWIR">SWIR</option>
            <option value="RF">RF</option>
          </select>
        </div>

        <div className="ov-form-row">
          <span className="ov-form-label">Max cloud</span>
          <div className="ov-slider-wrap">
            <input
              type="range" min={0} max={100} value={taskingCloud}
              onChange={e => setTaskingCloud(Number(e.target.value))}
              className="ov-slider"
            />
            <span className="ov-cloud-val">{taskingCloud}%</span>
          </div>
        </div>

        <div className="ov-form-row">
          <span className="ov-form-label">From</span>
          <input
            type="date" value={taskingStart}
            onChange={e => setTaskingStart(e.target.value)}
            className="ov-date-input"
          />
        </div>

        <div className="ov-form-row">
          <span className="ov-form-label">To</span>
          <input
            type="date" value={taskingEnd}
            onChange={e => setTaskingEnd(e.target.value)}
            className="ov-date-input"
          />
        </div>

        <button
          className="ov-btn ov-btn-primary"
          onClick={submitTasking}
          disabled={!aoiGeom || taskingLoading}
        >
          {taskingLoading ? 'Searching…' : 'Find Coverage'}
        </button>

        {taskingResults !== null && (
          <div className="ov-results">
            <div className="ov-results-header">
              {taskingResults.length === 0
                ? 'No matches in window'
                : `${taskingResults.length} match${taskingResults.length !== 1 ? 'es' : ''} found`}
            </div>
            {taskingResults.map((r, i) => (
              <div key={`${r.source}-${r.pass_id}-${i}`} className="ov-result-item">
                <div className="ov-result-top">
                  <span
                    className="ov-sensor-dot"
                    style={{ background: r.source === 'real-s2' ? ACQ_COLOR : (SENSOR_COLORS[r.sensor_type] ?? '#aaa') }}
                  />
                  <span className="ov-result-sat">{r.satellite}</span>
                  <span className={`ov-source-badge ${r.source === 'real-s2' ? 'ov-badge-real' : 'ov-badge-sim'}`}>
                    {r.source === 'real-s2' ? 'Real S2' : 'Simulated'}
                  </span>
                </div>
                <div className="ov-result-meta">
                  <span>{r.sensor_type}</span>
                  <span>{fmtTime(r.pass_start)}</span>
                  <span>{r.cloud_cover_pct}% cloud · {r.coverage_km2} km²</span>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
        )}
      </aside>

      {/* Legend */}
      <aside className={`ov-legend ${legendOpen ? '' : 'ov-panel-collapsed'}`}>
        <button
          className="ov-panel-header"
          onClick={() => setLegendOpen(v => !v)}
          aria-expanded={legendOpen}
        >
          <span className="ov-panel-caret">{legendOpen ? '▾' : '▸'}</span>
          <span className="ov-panel-title">Legend</span>
        </button>
        {legendOpen && (
        <div className="ov-panel-body">
        <div className="ov-legend-section">
          <div className="ov-legend-label">Pass sensor type</div>
          {SENSOR_ORDER.map(s => (
            <div key={s} className="ov-legend-item">
              <span className="ov-legend-swatch" style={{ background: SENSOR_COLORS[s] }} />
              {s}
            </div>
          ))}
        </div>
        <div className="ov-legend-section" style={{ marginTop: 12 }}>
          <div className="ov-legend-item">
            <span className="ov-legend-need-swatch" />
            Collection need
          </div>
        </div>
        <div className="ov-legend-section" style={{ marginTop: 12 }}>
          <div className="ov-legend-item">
            <span className="ov-legend-swatch" style={{ background: ACQ_COLOR }} />
            Real Sentinel-2
          </div>
        </div>
        <div className="ov-legend-section" style={{ marginTop: 12 }}>
          <div className="ov-legend-label">Tasking matches</div>
          <div className="ov-legend-item">
            <span className="ov-legend-swatch" style={{ background: MATCH_SIM_COLOR }} />
            Simulated match
          </div>
          <div className="ov-legend-item">
            <span className="ov-legend-swatch" style={{ background: ACQ_COLOR, opacity: 1 }} />
            Real-S2 match
          </div>
        </div>
        <div className="ov-legend-section" style={{ marginTop: 12 }}>
          <div className="ov-legend-label">Live orbits (TLE)</div>
          <div className="ov-legend-item">
            <span
              className="ov-legend-swatch"
              style={{ background: SAT_COLOR, borderRadius: '50%' }}
            />
            Real satellite
          </div>
        </div>
        </div>
        )}
      </aside>
    </div>
  )
}
