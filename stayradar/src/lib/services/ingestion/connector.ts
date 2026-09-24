import type { AvailabilityStatus } from "@/db/schema";
import type { GeoPoint } from "@/db/geo";

/**
 * Connector surface for inventory ingestion (spec art_XasJ5Kw8, "Ingestion
 * connectors"). One interface, several sources: seed fixtures, iCal feeds,
 * CSV bulk import — and future PMS/partner feeds (Guesty, Hostaway, Expedia
 * Rapid) implement the same shape without touching the schema. No OTA
 * scraping: Airbnb/Vrbo/Booking APIs are partner-gated and their terms
 * prohibit it.
 */

/** A property as a connector delivers it — pre-dedup, no database ids. */
export interface PropertyInput {
  source: string;
  externalId: string;
  slug: string;
  title: string;
  market: string;
  propertyType: string;
  maxGuests: number;
  bedrooms: number;
  baseNightly: number;
  location: GeoPoint;
  address?: string;
  amenities: string[];
  images: string[];
  /** Initial availability to write with the property (seed calendar, later iCal/CSV extensions). */
  availability?: AvailabilityNightInput[];
}

export interface AvailabilityNightInput {
  date: string;
  status: AvailabilityStatus;
  nightlyPrice: number | null;
}

/** Summary of an ingestion run — counts after idempotent upserts. */
export interface IngestSummary {
  propertiesUpserted: number;
  availabilityRows: number;
}

/** Source of property inputs. `load` is pure: it may be called repeatedly. */
export interface InventoryConnector {
  readonly source: string;
  load(): Promise<PropertyInput[]> | PropertyInput[];
}
