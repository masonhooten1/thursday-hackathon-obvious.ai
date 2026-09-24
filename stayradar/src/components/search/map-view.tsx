"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { PropertySearchResult } from "@/lib/contracts";
import { circleToGeoJson, zoomForRadius, type GeoPoint } from "@/lib/geo";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre GL map over OpenStreetMap raster tiles — no API key or billing
 * (locked spec decision). Price-pill markers sync with the results list;
 * the search radius renders as a translucent circle. MapLibre is imported
 * inside effects so the module (and its workers) never load during SSR.
 * The only maplibre-touching component in the app.
 */

export const RADIUS_SOURCE_ID = "stayradar-radius";
const RADIUS_FILL_LAYER_ID = "stayradar-radius-fill";
const RADIUS_LINE_LAYER_ID = "stayradar-radius-line";

/** OpenStreetMap raster style — the keyless tiles decision from the spec. */
const OSM_RASTER_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

interface MapViewProps {
  center: GeoPoint;
  radiusMiles: number;
  results: PropertySearchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Map moved by the user (not by our own camera calls) — enables "search this area". */
  onUserMoveEnd?: (center: GeoPoint) => void;
  className?: string;
}

function markerElement(result: PropertySearchResult, selected: boolean): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = selected ? "sr-marker sr-marker-selected" : "sr-marker";
  el.dataset.resultId = result.id;
  el.setAttribute(
    "aria-label",
    `${result.title} — $${Math.round(result.minNightly)} per night, ${result.distanceMiles.toFixed(1)} miles away`,
  );
  el.textContent = `$${Math.round(result.minNightly)}`;
  return el;
}

export function MapView({
  center,
  radiusMiles,
  results,
  selectedId,
  onSelect,
  onUserMoveEnd,
  className = "",
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const programmaticMove = useRef(false);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const onSelectRef = useRef(onSelect);
  const onUserMoveEndRef = useRef(onUserMoveEnd);
  // Flips true once the map emits "load"; effects that need the map gate on it.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    onUserMoveEndRef.current = onUserMoveEnd;
  }, [onUserMoveEnd]);

  // Create the map once; camera updates flow through the effects below.
  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    void (async () => {
      const { Map: MapCtor } = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;
      map = new MapCtor({
        container: containerRef.current,
        style: OSM_RASTER_STYLE,
        center: [center.longitude, center.latitude],
        zoom: zoomForRadius(radiusMiles),
      });
      mapRef.current = map;
      map.on("load", () => {
        if (disposed) return;
        setReady(true);
      });
      map.on("moveend", () => {
        if (programmaticMove.current) {
          programmaticMove.current = false;
          return;
        }
        const c = map!.getCenter();
        onUserMoveEndRef.current?.({ latitude: c.lat, longitude: c.lng });
      });
    })();
    return () => {
      disposed = true;
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; updates handled by dedicated effects
  }, []);

  // Recentre when the search anchor changes (market switch / search this area).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    programmaticMove.current = true;
    map.flyTo({
      center: [center.longitude, center.latitude],
      zoom: zoomForRadius(radiusMiles),
      duration: 600,
    });
    // radiusMiles intentionally excluded: reframing after a radius change is
    // the result fitBounds' job, so the camera moves once, not twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, ready]);

  // Radius circle overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const data = circleToGeoJson(center, radiusMiles);
    const existing = map.getSource(RADIUS_SOURCE_ID) as { setData: (d: unknown) => void } | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }
    map.addSource(RADIUS_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: RADIUS_FILL_LAYER_ID,
      type: "fill",
      source: RADIUS_SOURCE_ID,
      paint: { "fill-color": "#0f766e", "fill-opacity": 0.08 },
    });
    map.addLayer({
      id: RADIUS_LINE_LAYER_ID,
      type: "line",
      source: RADIUS_SOURCE_ID,
      paint: { "line-color": "#0f766e", "line-width": 1.5, "line-opacity": 0.5 },
    });
  }, [center, radiusMiles, ready]);

  // Price markers, rebuilt when results or the selection change (≤ 50 pins).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    void (async () => {
      const { Marker: MarkerCtor } = await import("maplibre-gl");
      const current = mapRef.current;
      if (!current || current !== map) return;
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = results.map((result) => {
        const el = markerElement(result, result.id === selectedId);
        el.addEventListener("click", () => onSelectRef.current(result.id));
        return new MarkerCtor({ element: el, anchor: "bottom" })
          .setLngLat([result.longitude, result.latitude])
          .addTo(current);
      });
    })();
  }, [results, selectedId, ready]);

  // Frame the results after each search; single results keep a sensible zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || results.length === 0) return;
    const lngs = results.map((r) => r.longitude);
    const lats = results.map((r) => r.latitude);
    programmaticMove.current = true;
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, maxZoom: 13, duration: 600 },
    );
  }, [results, ready]);

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      aria-label={`Map of stays within ${radiusMiles} miles`}
      role="img"
      className={`h-full w-full ${className}`}
    />
  );
}
