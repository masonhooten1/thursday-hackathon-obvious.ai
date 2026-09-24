/**
 * PostGIS geography point support for Drizzle.
 *
 * drizzle-orm 0.45 ships a `geometry` column type but not `geography`. The
 * spec's locked decision (#3) requires `geography(Point, 4326)` — the type
 * that makes ST_DWithin meter-based and spheroid-accurate with a GiST index —
 * so we define it as a customType rather than settling for a geometry column
 * plus per-query casts (which would silently lose the index).
 *
 * Wire formats handled here:
 * - toDriver: EWKT text (`SRID=4326;POINT(lng lat)`) — PostGIS parses it
 *   directly into geography.
 * - fromDriver: hex EWKB, as returned by node-postgres for geography columns.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** EWKB type flags (PostGIS). Base type 1 = POINT. */
const WKB_POINT = 1;
const WKB_SRID_FLAG = 0x20000000;
const WKB_Z_FLAG = 0x80000000;
const WKB_M_FLAG = 0x40000000;

/**
 * Parse a PostGIS extended WKB hex string for a 2D point into a GeoPoint.
 * Handles both endiannesses and the optional SRID field. Pure function —
 * unit-tested in tests/geo-point.test.ts.
 */
export function parsePointEwkb(hex: string): GeoPoint {
  if (hex.length < 10 || hex.length % 2 !== 0) {
    throw new Error(`invalid EWKB hex: expected even-length body, got ${hex.length} chars`);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("invalid EWKB hex: body contains non-hex characters");
    }
    bytes[i] = byte;
  }

  const littleEndian = bytes[0] === 1;
  if (!littleEndian && bytes[0] !== 0) {
    throw new Error(`invalid EWKB hex: unknown endianness byte ${bytes[0]}`);
  }

  const view = new DataView(bytes.buffer);
  let offset = 1;

  const geometryType = view.getUint32(offset, littleEndian);
  offset += 4;
  if ((geometryType & WKB_Z_FLAG) !== 0 || (geometryType & WKB_M_FLAG) !== 0) {
    throw new Error(`unsupported EWKB point with Z/M coordinates (type ${geometryType})`);
  }
  // EWKB carries extra dims in the type word; strip all flags for comparison.
  const baseType = geometryType & ~(WKB_SRID_FLAG | WKB_Z_FLAG | WKB_M_FLAG);
  if (baseType !== WKB_POINT) {
    throw new Error(`unsupported EWKB geometry type ${baseType}: expected a point`);
  }

  if ((geometryType & WKB_SRID_FLAG) !== 0) {
    offset += 4; // SRID is always 4326 for this column; no need to read it.
  }

  const longitude = view.getFloat64(offset, littleEndian);
  const latitude = view.getFloat64(offset + 8, littleEndian);
  return { latitude, longitude };
}

/** Serialize a point as EWKT text PostGIS can cast to geography. */
export function geoPointToEwkt(point: GeoPoint): string {
  return `SRID=4326;POINT(${point.longitude} ${point.latitude})`;
}
