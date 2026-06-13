import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

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

interface Match {
  pass_id: number
  satellite: string
  sensor_type: string
  pass_start: string
  pass_end: string
  cloud_cover_pct: number
  coverage_km2: number
}

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

// ── Main component ───────────────────────────────────────────────────────────

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [selectedNeed, setSelectedNeed] = useState<NeedProps | null>(null)

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
              'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
            ],
            tileSize: 256,
            attribution: '© EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)',
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
      const [passesRes, needsRes] = await Promise.all([
        fetch('/api/passes'),
        fetch('/api/needs'),
      ])
      const passes = await passesRes.json()
      const needs = await needsRes.json()

      // ── Pass footprints source ──────────────────────────────────────────
      m.addSource('passes', { type: 'geojson', data: passes })

      // Fill, coloured by sensor_type
      m.addLayer({
        id: 'passes-fill',
        type: 'fill',
        source: 'passes',
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

      // Outline
      m.addLayer({
        id: 'passes-outline',
        type: 'line',
        source: 'passes',
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

      // ── Pass click handler ──────────────────────────────────────────────
      m.on('click', 'passes-fill', (e) => {
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
      m.on('mouseleave', 'passes-fill', () => { m.getCanvas().style.cursor = '' })
      m.on('mouseenter', 'needs-outline', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'needs-outline', () => { m.getCanvas().style.cursor = '' })
    })

    map.current = m
    return () => { m.remove(); map.current = null }
  }, [fetchMatches])

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
      <div class="ov-matches-header">Matching passes (${matches.length})</div>
      <table class="ov-table ov-matches-table">
        <thead><tr><th>Satellite</th><th>Sensor</th><th>Time (UTC)</th><th>Cloud</th><th>Cov km²</th></tr></thead>
        <tbody>
          ${matches.map(m => `
            <tr>
              <td>${m.satellite}</td>
              <td><span class="ov-sensor-dot" style="background:${SENSOR_COLORS[m.sensor_type] ?? '#aaa'}"></span>${m.sensor_type}</td>
              <td>${fmtTime(m.pass_start)}</td>
              <td>${m.cloud_cover_pct}%</td>
              <td>${m.coverage_km2}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
  }, [matches, selectedNeed, loadingMatches])

  return (
    <div className="app">
      {/* Header */}
      <header className="ov-header">
        <span className="ov-title">Orbital Viewer — Tasking Demo</span>
      </header>

      {/* Map */}
      <div ref={mapContainer} className="map-container" />

      {/* Legend */}
      <aside className="ov-legend">
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
      </aside>
    </div>
  )
}
