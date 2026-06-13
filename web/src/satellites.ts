import * as satellite from 'satellite.js'

export const SAT_COLOR = '#e879f9'

export type TleEntry = { name: string; tle1: string; tle2: string }
export type TleMap = Record<string, TleEntry>

type LonLat = [number, number]

function propagateAt(satrec: satellite.SatRec, t: Date): LonLat | null {
  const pv = satellite.propagate(satrec, t)
  if (typeof pv.position === 'boolean') return null
  const gmst = satellite.gstime(t)
  const geo = satellite.eciToGeodetic(pv.position, gmst)
  return [satellite.degreesLong(geo.longitude), satellite.degreesLat(geo.latitude)]
}

function groundTrackSegments(satrec: satellite.SatRec): LonLat[][] {
  const now = new Date()
  const pts: LonLat[] = []

  // ~100-minute LEO period; 1-minute steps
  for (let m = 0; m <= 100; m++) {
    const t = new Date(now.getTime() + m * 60_000)
    const pt = propagateAt(satrec, t)
    if (pt) pts.push(pt)
  }

  // Split into segments at antimeridian crossings (lon jump > 180°)
  const segs: LonLat[][] = []
  let seg: LonLat[] = []
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || Math.abs(pts[i][0] - pts[i - 1][0]) <= 180) {
      seg.push(pts[i])
    } else {
      if (seg.length >= 2) segs.push(seg)
      seg = [pts[i]]
    }
  }
  if (seg.length >= 2) segs.push(seg)
  return segs
}

export function buildSatGeoJSON(tles: TleMap) {
  const markerFeatures: {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: LonLat }
    properties: { name: string }
  }[] = []

  const trackFeatures: {
    type: 'Feature'
    geometry: { type: 'LineString'; coordinates: LonLat[] }
    properties: { name: string }
  }[] = []

  for (const [name, { tle1, tle2 }] of Object.entries(tles)) {
    try {
      const satrec = satellite.twoline2satrec(tle1, tle2)
      const pos = propagateAt(satrec, new Date())
      if (pos) {
        markerFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pos },
          properties: { name },
        })
      }
      for (const coords of groundTrackSegments(satrec)) {
        trackFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { name },
        })
      }
    } catch {
      // Skip satellites that fail to propagate; don't crash the layer
    }
  }

  return {
    markers: { type: 'FeatureCollection' as const, features: markerFeatures },
    tracks: { type: 'FeatureCollection' as const, features: trackFeatures },
  }
}
