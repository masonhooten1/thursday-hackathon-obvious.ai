import { markerColor, type MapPoint } from "./mapTypes";

/**
 * Marker icons for the web map as SVG data URLs: a colored disc carrying the
 * free-site count, with a dashed gray ring when the snapshot is stale (spec:
 * "dashed gray ring for stale or missing data"). Google's Circle overlay
 * cannot dash its stroke, so the ring is baked into the icon itself.
 */
export function markerIconDataUrl(point: MapPoint, selected: boolean): string {
  const color = markerColor(point.availability);
  const size = 44;
  const center = size / 2;
  const discRadius = point.count === null ? 8 : 14;
  const ring = point.stale
    ? `<circle cx="${center}" cy="${center}" r="20" fill="none" stroke="#9ca3af" stroke-width="2.5" stroke-dasharray="5 4" stroke-linecap="round"/>`
    : "";
  const countText =
    point.count === null
      ? ""
      : `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${point.count}</text>`;
  const selectedStroke = selected
    ? `<circle cx="${center}" cy="${center}" r="${discRadius + 3}" fill="none" stroke="#111827" stroke-width="2.5"/>`
    : "";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    ring,
    `<circle cx="${center}" cy="${center}" r="${discRadius}" fill="${color}" stroke="#ffffff" stroke-width="2"/>`,
    selectedStroke,
    countText,
    "</svg>",
  ].join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
