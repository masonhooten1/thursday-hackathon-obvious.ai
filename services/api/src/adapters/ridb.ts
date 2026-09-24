import { CampgroundSchema, SITE_TYPES, type Campground, type SiteType } from "@campground/shared";
import type { PoliteClient } from "./politeness";
import { normalizeSiteType } from "./site-type";
import type { MetadataSource } from "./types";

/**
 * MetadataSource over the official RIDB API (https://ridb.recreation.gov),
 * which requires an API key sent as the `apikey` request header and is
 * documented at 50 req/s:
 *
 *   GET /api/v1/facilities/{facilityId}                        — facility record
 *   GET /api/v1/facilities/{facilityId}/campsites?limit&offset — paginated campsites
 *
 * Shapes follow the documented RIDB schema (SCREAMING_SNAKE_CASE fields,
 * RECDATA/METADATA list envelopes). NOTE: live verification is pending — the
 * configured RIDB_API_KEY was rejected as a placeholder (401 Unauthorized
 * Access on 2026-09-24), so fixtures are reconstructed from the documented
 * schema and community clients, not a live capture. Re-verify against the
 * live service once a real key is stored, and see
 * docs/recreation-gov-endpoints.md.
 *
 * RIDB does not know Campground Tonight's park slugs, so the caller injects
 * `parkIdFor` — catalog knowledge the seeder (D2) owns. Booking URLs use the
 * stable recreation.gov pattern from the shared contract.
 */

const BASE_URL = "https://ridb.recreation.gov/api/v1";
const BOOKING_URL_PATTERN = "https://www.recreation.gov/camping/campgrounds";

/** The parsed slice of the RIDB facility record the Campground needs. */
export interface RidbFacility {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Parses the single-facility RIDB response. Throws when the fields the shared
 * contract requires (name, coordinates) are missing — a degraded source is the
 * poller's job to handle, not a place to fabricate metadata.
 */
export function parseFacility(raw: unknown): RidbFacility {
  if (!isRecord(raw)) throw new Error("unexpected RIDB facility response: not an object");
  const id = asNumber(raw.FacilityID);
  const name = asNonEmptyString(raw.FacilityName);
  const lat = asNumber(raw.FacilityLatitude);
  const lng = asNumber(raw.FacilityLongitude);
  if (id === null || id <= 0 || !name || lat === null || lng === null) {
    throw new Error(
      "unexpected RIDB facility response: missing required fields (FacilityID, FacilityName, FacilityLatitude, FacilityLongitude)",
    );
  }
  return { id, name, lat, lng };
}

/** Distinct normalized site types across one RECDATA page of campsite records. */
export function parseCampsiteTypes(raw: unknown): SiteType[] {
  if (!isRecord(raw) || !Array.isArray(raw.RECDATA)) {
    throw new Error("unexpected RIDB campsites response: missing RECDATA array");
  }
  const types = new Set<SiteType>();
  for (const entry of raw.RECDATA) {
    if (!isRecord(entry)) continue;
    const rawType = asNonEmptyString(entry.CampsiteType);
    if (rawType) types.add(normalizeSiteType(rawType));
  }
  // Deterministic order for the UI and tests: the shared contract's order.
  return SITE_TYPES.filter((type) => types.has(type));
}

export interface RidbMetadataSourceOptions {
  apiKey: string;
  client: PoliteClient;
  /** Resolves the campground's park slug — catalog knowledge RIDB lacks. */
  parkIdFor: (facility: RidbFacility) => string;
  baseUrl?: string;
  /** Campsites page size; the source pages until a short page. Default 50. */
  pageSize?: number;
}

export class RidbMetadataSource implements MetadataSource {
  private readonly apiKey: string;
  private readonly client: PoliteClient;
  private readonly parkIdFor: (facility: RidbFacility) => string;
  private readonly baseUrl: string;
  private readonly pageSize: number;

  constructor(options: RidbMetadataSourceOptions) {
    this.apiKey = options.apiKey;
    this.client = options.client;
    this.parkIdFor = options.parkIdFor;
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.pageSize = options.pageSize ?? 50;
  }

  async fetchFacility(facilityId: number): Promise<Campground> {
    const rawFacility = await this.client.getJson(`${this.baseUrl}/facilities/${facilityId}`, {
      apikey: this.apiKey,
    });
    const facility = parseFacility(rawFacility);

    const siteTypes = new Set<SiteType>();
    for await (const types of this.campsiteTypePages(facilityId)) {
      for (const type of types) siteTypes.add(type);
    }

    return CampgroundSchema.parse({
      facilityId: facility.id,
      parkId: this.parkIdFor(facility),
      name: facility.name,
      lat: facility.lat,
      lng: facility.lng,
      bookingUrl: `${BOOKING_URL_PATTERN}/${facility.id}`,
      siteTypes: SITE_TYPES.filter((type) => siteTypes.has(type)),
    });
  }

  /** Pages through the facility's campsites, yielding distinct types per page. */
  private async *campsiteTypePages(facilityId: number): AsyncGenerator<SiteType[]> {
    // Bounded loop: a well-behaved source terminates on a short page; the cap
    // stops a shape-drift or adversarial response from polling forever.
    const maxPages = 100;
    for (let offset = 0, page = 0; page < maxPages; page += 1) {
      const raw = await this.client.getJson(
        `${this.baseUrl}/facilities/${facilityId}/campsites?limit=${this.pageSize}&offset=${offset}`,
        { apikey: this.apiKey },
      );
      if (!isRecord(raw) || !Array.isArray(raw.RECDATA)) {
        throw new Error("unexpected RIDB campsites response: missing RECDATA array");
      }
      yield parseCampsiteTypes(raw);
      if (raw.RECDATA.length < this.pageSize) return;
      offset += raw.RECDATA.length;
    }
  }
}
