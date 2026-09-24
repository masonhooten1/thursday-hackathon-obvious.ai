import { PROPERTIES } from "@/fixtures/properties";
import type { InventoryConnector, PropertyInput } from "./connector";
import { buildAvailabilityCalendar, seedFromString } from "./availability-calendar";

/** Spec: 90-day availability calendars for every seeded property. */
const CALENDAR_DAYS = 90;

/**
 * SeedConnector — loads the curated fixture inventory (40 properties across
 * lake-tahoe / gatlinburg / austin / cape-cod) as connector inputs, each with
 * a deterministic 90-day availability calendar showing realistic
 * booked/blocked patterns. `source` is "seed"; externalId is the fixture id
 * (lt-001, gb-002, …), so re-seeding upserts rather than duplicates.
 */
export class SeedConnector implements InventoryConnector {
  readonly source = "seed";

  load(): PropertyInput[] {
    return PROPERTIES.map((property) => ({
      source: this.source,
      externalId: property.id,
      slug: property.slug,
      title: property.title,
      market: property.market,
      propertyType: property.propertyType,
      maxGuests: property.maxGuests,
      bedrooms: property.bedrooms,
      baseNightly: property.baseNightly,
      location: { latitude: property.latitude, longitude: property.longitude },
      amenities: [...property.amenities],
      images: [],
      availability: buildAvailabilityCalendar({
        days: CALENDAR_DAYS,
        baseNightly: property.baseNightly,
        seed: seedFromString(property.slug),
      }),
    }));
  }
}
