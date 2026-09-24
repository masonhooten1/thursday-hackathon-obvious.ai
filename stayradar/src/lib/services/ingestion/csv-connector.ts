/**
 * CsvConnector — bulk property import (spec: "CsvConnector (bulk import)").
 * Expects a header row plus one property per row with columns:
 *
 *   external_id, slug, title, market, property_type, max_guests,
 *   bedrooms, base_nightly, latitude, longitude, amenities, address
 *
 * `amenities` is a semicolon-separated list; quoted fields follow RFC 4180
 * (embedded quotes doubled). Deduplication happens at ingestion time on
 * (source, externalId) — a re-imported file updates rows instead of
 * duplicating them. Availability is not part of CSV import.
 */

import type { GeoPoint } from "@/db/geo";
import type { InventoryConnector, PropertyInput } from "./connector";

export const CSV_COLUMNS = [
  "external_id",
  "slug",
  "title",
  "market",
  "property_type",
  "max_guests",
  "bedrooms",
  "base_nightly",
  "latitude",
  "longitude",
  "amenities",
  "address",
] as const;

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly row?: number,
  ) {
    super(row ? `csv row ${row}: ${message}` : message);
    this.name = "CsvParseError";
  }
}

/** One RFC 4180 row → fields; quotes doubled inside quoted fields. Pure. */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function requireString(row: number, value: string | undefined, column: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new CsvParseError(`missing ${column}`, row);
  return trimmed;
}

function requireNumber(row: number, value: string | undefined, column: string): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) throw new CsvParseError(`invalid ${column}: "${value}"`, row);
  return parsed;
}

/** Parse a properties CSV body into connector inputs. Pure — unit-tested. */
export function parsePropertiesCsv(text: string): PropertyInput[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvRow(lines[0]).map((column) => column.trim());
  const missing = CSV_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new CsvParseError(`missing columns: ${missing.join(", ")}`);
  }

  const inputs: PropertyInput[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const row = i + 1; // 1-based, header is row 1
    const cells = parseCsvRow(lines[i]);
    const byColumn = new Map<string, string>();
    header.forEach((column, index) => byColumn.set(column, cells[index] ?? ""));

    const latitude = requireNumber(row, byColumn.get("latitude"), "latitude");
    const longitude = requireNumber(row, byColumn.get("longitude"), "longitude");
    if (Math.abs(latitude) > 90) throw new CsvParseError("latitude out of range", row);
    if (Math.abs(longitude) > 180) throw new CsvParseError("longitude out of range", row);

    const amenities = (byColumn.get("amenities") ?? "")
      .split(";")
      .map((amenity) => amenity.trim())
      .filter((amenity) => amenity.length > 0);

    const location: GeoPoint = { latitude, longitude };
    inputs.push({
      source: "csv",
      externalId: requireString(row, byColumn.get("external_id"), "external_id"),
      slug: requireString(row, byColumn.get("slug"), "slug"),
      title: requireString(row, byColumn.get("title"), "title"),
      market: requireString(row, byColumn.get("market"), "market"),
      propertyType: requireString(row, byColumn.get("property_type"), "property_type"),
      maxGuests: requireNumber(row, byColumn.get("max_guests"), "max_guests"),
      bedrooms: requireNumber(row, byColumn.get("bedrooms"), "bedrooms"),
      baseNightly: requireNumber(row, byColumn.get("base_nightly"), "base_nightly"),
      location,
      address: byColumn.get("address")?.trim() || undefined,
      amenities,
      images: [],
    });
  }
  return inputs;
}

/** CsvConnector — loads properties from a CSV body. Pure: stateless over text. */
export class CsvConnector implements InventoryConnector {
  readonly source = "csv";

  constructor(private readonly csvText: string) {}

  load(): PropertyInput[] {
    return parsePropertiesCsv(this.csvText);
  }
}
