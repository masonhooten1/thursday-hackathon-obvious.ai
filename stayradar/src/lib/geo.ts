/**
 * Client-side geo helpers (traveler UX task). The database owns the real
 * geo math — ST_DWithin over PostGIS — so these only serve presentational
 * needs: distance labels and drawing the search radius on the map.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles between two points (haversine). */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Approximate map zoom that frames a radius of the given size (miles).
 * Small lookup over a formula — predictable framing beats a clever fit
 * for the five radius options the UI offers.
 */
export function zoomForRadius(radiusMiles: number): number {
  const meters = radiusMiles * 1609.34;
  // Screen spans ~2 radii; world is 40,075,016 m around at zoom 0.
  return Math.max(1, Math.min(14, Math.round(Math.log2(40075016.7 / (meters * 4)))));
}

/**
 * Polygon approximating a circle of `radiusMiles` around `center`, as a
 * GeoJSON Polygon — the source data for the radius overlay on the map.
 * The ring is closed (first point repeated last).
 */
export function circleToGeoJson(center: GeoPoint, radiusMiles: number, steps = 64): {
  type: "Polygon";
  coordinates: [number, number][][];
} {
  const meters = radiusMiles * 1609.34;
  // Degrees per meter at the center's latitude for each axis.
  const latDeg = meters / 111_320;
  const lngDeg = meters / (111_320 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([
      center.longitude + lngDeg * Math.cos(angle),
      center.latitude + latDeg * Math.sin(angle),
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}
