/// <reference types="google.maps" />
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { loadGoogleMaps } from "./googleMapsLoader";
import { markerIconDataUrl } from "./markerIcons";
import { markerColor, type MapPoint, type MapViewProps } from "./mapTypes";

type LoaderStatus = "loading" | "ready" | "fallback";

/**
 * Web map over the Google Maps JavaScript API (spec D5): terrain tiles and
 * SVG marker discs carrying the free-site count, dashed gray ring when the
 * snapshot is stale. Without a key the component degrades to an honest
 * labeled fallback — same points, same interactions, no terrain tiles — so
 * filters and the detail sheet stay demoable before the key is configured.
 */
export default function WebCampgroundMap({ points, region, apiKey, selectedId, onMarkerPress }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef(new Map<number, google.maps.Marker>());
  const pressRef = useRef(onMarkerPress);

  const [status, setStatus] = useState<LoaderStatus>(apiKey ? "loading" : "fallback");

  useEffect(() => {
    pressRef.current = onMarkerPress;
  });

  useEffect(() => {
    if (!apiKey) return; // initial state is already "fallback"
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        // Failed to load (bad key, referrer restriction, offline) — degrade
        // to the labeled fallback rather than a blank screen.
        if (!cancelled) setStatus("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  // First region wins — data updates move markers, not the camera.
  const initialRegionRef = useRef(region);

  useEffect(() => {
    if (status !== "ready" || !containerRef.current || mapRef.current) return;
    const { lat, lng, latDelta, lngDelta } = initialRegionRef.current;
    mapRef.current = new google.maps.Map(containerRef.current, {
      center: { lat, lng },
      zoom: zoomFor(lngDelta, latDelta),
      mapTypeId: "terrain",
      clickableIcons: false,
    });
  }, [status]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;

    const seen = new Set<number>();
    for (const point of points) {
      seen.add(point.id);
      const icon: google.maps.Icon = {
        url: markerIconDataUrl(point, point.id === selectedId),
        scaledSize: new google.maps.Size(44, 44),
      };
      const existing = markersRef.current.get(point.id);
      if (existing) {
        existing.setPosition({ lat: point.lat, lng: point.lng });
        existing.setIcon(icon);
        existing.setTitle(point.label);
      } else {
        const marker = new google.maps.Marker({
          map,
          position: { lat: point.lat, lng: point.lng },
          icon,
          title: point.label,
        });
        marker.addListener("click", () => pressRef.current(point.id));
        markersRef.current.set(point.id, marker);
      }
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    }
  }, [points, status, selectedId]);

  if (status !== "ready") {
    return (
      <FallbackMap
        points={points}
        selectedId={selectedId}
        onMarkerPress={onMarkerPress}
        note={apiKey ? undefined : "Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to render Google terrain tiles"}
      />
    );
  }
  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function zoomFor(lngDelta: number, latDelta: number): number {
  const span = Math.max(Math.min(lngDelta, latDelta * 2), 1e-6);
  return Math.min(15, Math.max(3, Math.round(Math.log2(360 / span))));
}

/**
 * The no-key fallback: linear projection of points into the panel. Honest by
 * construction — it labels itself and draws no fake terrain.
 */
function FallbackMap({
  points,
  selectedId,
  onMarkerPress,
  note,
}: {
  points: MapPoint[];
  selectedId: number | null;
  onMarkerPress: (id: number) => void;
  note?: string;
}) {
  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const pad = 0.15;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad,
    };
  }, [points]);

  return (
    <View style={styles.fallback}>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {bounds && points.length > 0
        ? points.map((point) => {
            const x = ((point.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
            const y = (1 - (point.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
            return (
              <Pressable
                key={point.id}
                onPress={() => onMarkerPress(point.id)}
                accessibilityRole="button"
                accessibilityLabel={`${point.label}: ${point.count ?? "no"} sites free`}
                style={[
                  styles.marker,
                  point.stale ? styles.markerStale : null,
                  point.id === selectedId ? styles.markerSelected : null,
                  { backgroundColor: markerColor(point.availability), left: `${x}%`, top: `${y}%` },
                ]}
              >
                <Text style={styles.markerText}>{point.count ?? "?"}</Text>
              </Pressable>
            );
          })
        : null}
      <Text style={styles.fallbackLabel}>Map preview — markers show free sites for the selected night</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: "#e8eddf", // muted terrain tone — a backdrop, not a pretend map
    overflow: "hidden",
  },
  marker: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
    transform: [{ translateX: -18 }, { translateY: -18 }],
  },
  markerStale: {
    borderStyle: "dashed",
    borderColor: "#9ca3af",
    opacity: 0.8,
  },
  markerSelected: {
    borderColor: "#111827",
    borderWidth: 3,
  },
  markerText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
  fallbackLabel: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    fontSize: 11,
    color: "#4b5563",
  },
  note: {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    fontSize: 11,
    color: "#4b5563",
  },
});
