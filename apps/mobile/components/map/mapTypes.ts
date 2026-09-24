import type { MarkerAvailability } from "../../lib/filters";

/**
 * The platform-neutral map interface. MapView.tsx (native, react-native-maps)
 * and MapView.web.tsx (Google Maps JavaScript API) both implement it; the
 * screen imports "./MapView" and Metro picks the right file per platform.
 */

export interface MapPoint {
  /** Campground facility id. */
  id: number;
  lat: number;
  lng: number;
  /** Marker color semantics: green available, amber soon, gray none. */
  availability: MarkerAvailability;
  /** Stale snapshots get the dashed-ring treatment (web) / ring overlay (native). */
  stale: boolean;
  /** Marker label — campground name. */
  label: string;
  /** Free sites for the current filters; null when unknown. Shown on web markers. */
  count: number | null;
}

export interface MapRegion {
  lat: number;
  lng: number;
  latDelta: number;
  lngDelta: number;
}

export interface MapViewProps {
  points: MapPoint[];
  region: MapRegion;
  /** Google Maps API key; when absent the web view renders a labeled fallback. */
  apiKey: string | undefined;
  /** The campground whose detail sheet is open — highlighted where the platform supports it. */
  selectedId: number | null;
  onMarkerPress: (id: number) => void;
}

/** Marker palette shared by both platforms (kept in one place for the legend). */
export const MARKER_COLORS = {
  available: "#15803d", // green — sites free on the selected night
  soon: "#b45309", // amber — none that night but some within 7 days
  none: "#6b7280", // gray — nothing within the horizon
  staleRing: "#9ca3af", // dashed/translucent ring for stale data
} as const;

export function markerColor(availability: MarkerAvailability): string {
  return MARKER_COLORS[availability];
}

/** Initial map region covering every point with a margin. */
export function regionForPoints(points: MapPoint[]): MapRegion {
  if (points.length === 0) {
    // Continental US-ish default; the real region is computed from data.
    return { lat: 38.5, lng: -98, latDelta: 50, lngDelta: 50 };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    latDelta: Math.max(maxLat - minLat, 0) * 1.6 || 0.08,
    lngDelta: Math.max(maxLng - minLng, 0) * 1.6 || 0.08,
  };
}
