import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { applyMigrations, truncateAll } from "@/db/apply-migrations";
import type { PropertyInput } from "@/lib/services/ingestion/connector";
import { ingestProperties } from "@/lib/services/ingestion/ingest";
import { ICalConnector } from "@/lib/services/ingestion/ical-connector";
import { SeedConnector } from "@/lib/services/ingestion/seed-connector";
import { SearchValidationError, searchProperties } from "@/lib/services/search-service";
import { availability, properties, searchEvents } from "@/db/schema";

/**
 * Integration tests against a real Postgres 16 + PostGIS database — the spec's
 * verification matrix for the geo core. Point TEST_DATABASE_URL at a
 * provisioned database (CI: postgis/postgis:16 service container; local: see
 * stayradar/README.md). Without the variable these tests skip, so plain
 * `pnpm test` still passes on machines without Postgres.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("inventory ingestion + radius search", () => {
  // ReturnType carries the `$client` pool handle that createDb attaches.
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    db = createDb(databaseUrl as string);
    await applyMigrations(db);
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  describe("ingestion", () => {
    it("ingests the 40-property seed with 90-day calendars", async () => {
      const inputs = new SeedConnector().load();
      expect(inputs).toHaveLength(40);

      const summary = await ingestProperties(db, inputs);
      expect(summary.propertiesUpserted).toBe(40);

      const propertyRows = await db.select().from(properties);
      const seedRows = propertyRows.filter((row) => row.source === "seed");
      expect(seedRows).toHaveLength(40);
      for (const market of ["lake-tahoe", "gatlinburg", "austin", "cape-cod"]) {
        expect(seedRows.filter((row) => row.market === market)).toHaveLength(10);
      }

      const seedIds = new Set(seedRows.map((row) => row.id));
      const nights = await db.select().from(availability);
      expect(nights.filter((night) => seedIds.has(night.propertyId))).toHaveLength(3600);
    });

    it("re-seeds idempotently — row counts unchanged", async () => {
      const inputs = new SeedConnector().load();
      await ingestProperties(db, inputs);

      const propertyCount = await db.select().from(properties);
      const seedCount = propertyCount.filter((row) => row.source === "seed").length;
      expect(seedCount).toBe(40);

      const nightCount = await db.select().from(availability);
      expect(nightCount).toHaveLength(3600);
    });

    it("keeps sane seeded calendars — valid statuses, priced nights", async () => {
      const seedRows = (await db.select().from(properties)).filter((r) => r.source === "seed");
      const nights = await db.select().from(availability);
      const byId = new Map(seedRows.map((row) => [row.id, row]));

      for (const night of nights) {
        const property = byId.get(night.propertyId);
        if (!property) continue; // nights added by other tests below
        expect(["available", "booked", "blocked"]).toContain(night.status);
        if (night.status === "blocked") {
          expect(night.nightlyPrice).toBeNull();
        } else {
          expect(night.nightlyPrice).not.toBeNull();
          expect(night.nightlyPrice as number).toBeGreaterThanOrEqual(property.baseNightly);
        }
      }
      expect(byId.size).toBe(40);
    });

    it("dedupes duplicate external keys within one batch (last wins)", async () => {
      const base = {
        source: "test-dedup",
        slug: "dedupe-cabin",
        title: "First Title",
        market: "lake-tahoe",
        propertyType: "cabin",
        maxGuests: 4,
        bedrooms: 2,
        baseNightly: 200,
        location: { latitude: 39.1, longitude: -120.03 },
        amenities: [],
        images: [],
      };
      const summary = await ingestProperties(db, [
        { ...base, externalId: "dup-1" },
        { ...base, externalId: "dup-1", title: "Second Title" },
      ]);
      expect(summary.propertiesUpserted).toBe(1);

      const rows = await db
        .select()
        .from(properties)
        .where(and(eq(properties.source, "test-dedup"), eq(properties.externalId, "dup-1")));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe("Second Title");
    });

    it("syncs iCal booked nights idempotently — double-sync leaves counts unchanged", async () => {
      await ingestProperties(db, [
        {
          source: "test-ical",
          externalId: "ical-1",
          slug: "ical-cabin",
          title: "iCal Cabin",
          market: "lake-tahoe",
          propertyType: "cabin",
          maxGuests: 4,
          bedrooms: 2,
          baseNightly: 200,
          location: { latitude: 39.1, longitude: -120.03 },
          amenities: [],
          images: [],
        },
      ]);

      const ics = [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20270310",
        "DTEND;VALUE=DATE:20270313",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20270320",
        "DTEND;VALUE=DATE:20270322",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const connector = new ICalConnector(db);

      const first = await connector.syncAvailability({
        source: "test-ical",
        externalId: "ical-1",
        icsText: ics,
      });
      expect(first.nightsSynced).toBe(5);

      const second = await connector.syncAvailability({
        source: "test-ical",
        externalId: "ical-1",
        icsText: ics,
      });
      expect(second.nightsSynced).toBe(5);

      const property = (
        await db
          .select()
          .from(properties)
          .where(and(eq(properties.source, "test-ical"), eq(properties.externalId, "ical-1")))
      )[0];
      const nights = await db.select().from(availability).where(eq(availability.propertyId, property.id));
      expect(nights).toHaveLength(5);
      for (const night of nights) {
        expect(night.status).toBe("booked");
      }
    });

    it("refuses iCal sync for unknown inventory", async () => {
      const connector = new ICalConnector(db);
      await expect(
        connector.syncAvailability({
          source: "test-ical",
          externalId: "missing",
          icsText: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
        }),
      ).rejects.toThrow(/no property for/);
    });

    it("records zero nights for an eventless feed", async () => {
      const connector = new ICalConnector(db);
      const result = await connector.syncAvailability({
        source: "test-ical",
        externalId: "ical-1",
        icsText: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
      });
      expect(result.nightsSynced).toBe(0);
    });
  });

  describe("radius search", () => {
    // Controlled inventory on an empty-ocean center, far (hundreds of km)
    // from every seeded cluster, so results are exactly these properties.
    const CENTER = { latitude: 45.0, longitude: -115.0 };

    // Placement of the boundary candidates due north of CENTER. Meridian arc
    // at latitude 45°: 111132.92 − 559.82·cos(2φ) + 1.175·cos(4φ) ≈ 111131.75
    // meters per degree — construction tolerance vs the spheroid is ~4 m over
    // 40 km, well inside the ±0.02 mi margins below.
    const METERS_PER_DEG_LAT = 111131.75;
    const METERS_PER_MILE = 1609.344;
    const latOffset = (miles: number) => (miles * METERS_PER_MILE) / METERS_PER_DEG_LAT;

    const base = {
      source: "test-geo",
      market: "test-market",
      amenities: [] as string[],
      images: [] as string[],
    };

    const inputs: PropertyInput[] = [
      { ...base, externalId: "geo-in", slug: "geo-in", title: "Center Cabin", propertyType: "cabin", maxGuests: 4, bedrooms: 2, baseNightly: 200, location: CENTER },
      { ...base, externalId: "geo-cheap", slug: "geo-cheap", title: "Cheap Condo", propertyType: "condo", maxGuests: 4, bedrooms: 2, baseNightly: 200, location: { latitude: CENTER.latitude + 0.01, longitude: CENTER.longitude } },
      { ...base, externalId: "geo-boundary-in", slug: "geo-boundary-in", title: "Boundary Inside", propertyType: "house", maxGuests: 4, bedrooms: 2, baseNightly: 200, location: { latitude: CENTER.latitude + latOffset(24.98), longitude: CENTER.longitude } },
      { ...base, externalId: "geo-boundary-out", slug: "geo-boundary-out", title: "Boundary Outside", propertyType: "house", maxGuests: 4, bedrooms: 2, baseNightly: 200, location: { latitude: CENTER.latitude + latOffset(25.02), longitude: CENTER.longitude } },
      { ...base, externalId: "geo-far", slug: "geo-far", title: "Far House", propertyType: "house", maxGuests: 4, bedrooms: 2, baseNightly: 200, location: { latitude: CENTER.latitude + latOffset(30), longitude: CENTER.longitude } },
      { ...base, externalId: "geo-window-blocked", slug: "geo-window-blocked", title: "Blocked Cabin", propertyType: "cabin", maxGuests: 4, bedrooms: 2, baseNightly: 200, location: { latitude: CENTER.latitude, longitude: CENTER.longitude + 0.02 } },
      { ...base, externalId: "geo-small", slug: "geo-small", title: "Studio", propertyType: "cabin", maxGuests: 1, bedrooms: 1, baseNightly: 120, location: CENTER },
      { ...base, externalId: "geo-checkout-booked", slug: "geo-checkout-booked", title: "Checkout Booked Cabin", propertyType: "cabin", maxGuests: 4, bedrooms: 2, baseNightly: 200, location: { latitude: CENTER.latitude + 0.005, longitude: CENTER.longitude } },
    ];
    // geo-cheap: two cheap available nights inside window W1.
    // geo-window-blocked: booked on 2027-03-14 — inside W1, outside W2.
    // geo-checkout-booked: booked only on 2027-03-16, the checkout day of W1 —
    // stay nights are [checkIn, checkOut), so that row must not disqualify.
    inputs[1].availability = [
      { date: "2027-03-13", status: "available", nightlyPrice: 120 },
      { date: "2027-03-14", status: "available", nightlyPrice: 90 },
    ];
    inputs[5].availability = [
      { date: "2027-03-14", status: "booked", nightlyPrice: null },
    ];
    inputs[7].availability = [
      { date: "2027-03-16", status: "booked", nightlyPrice: null },
    ];

    beforeAll(async () => {
      await ingestProperties(db, inputs);
    });

    const query = {
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
      radiusMiles: 25,
      checkIn: "2027-03-13",
      checkOut: "2027-03-16",
      guests: 2,
    };

    it("returns in-radius properties nearest-first and excludes beyond-boundary", async () => {
      const response = await searchProperties(db, query);
      const slugs = response.results.map((result) => result.slug);

      // Inside: center + checkout-booked (its only booked night is the W1
      // checkout day — not a stay night) + cheap + boundary-inside. Excluded:
      // boundary-outside (25.02 mi), far (30 mi), window-blocked (booked
      // night in window), studio (maxGuests 1 < 2 guests).
      expect(slugs).toEqual([
        "geo-in",
        "geo-checkout-booked",
        "geo-cheap",
        "geo-boundary-in",
      ]);
      expect(response.total).toBe(4);

      const distances = response.results.map((result) => result.distanceMiles);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      const boundary = response.results.find((r) => r.slug === "geo-boundary-in");
      expect(boundary?.distanceMiles).toBeGreaterThan(24.9);
      expect(boundary?.distanceMiles).toBeLessThan(25.0);
    });

    it("disqualifies a property with a booked date inside the requested window", async () => {
      const blockedWindow = await searchProperties(db, query);
      expect(blockedWindow.results.map((r) => r.slug)).not.toContain("geo-window-blocked");

      // Window flip: a window clear of the booked night includes it again.
      const clearWindow = await searchProperties(db, {
        ...query,
        checkIn: "2027-03-20",
        checkOut: "2027-03-22",
      });
      expect(clearWindow.results.map((r) => r.slug)).toContain("geo-window-blocked");
    });

    it("treats the checkout day as a departure, not a required night", async () => {
      // A property booked only on the checkout day of the window (2027-03-16,
      // the day the guest departs) is still bookable: stay nights are
      // [checkIn, checkOut), so 03-16's status is irrelevant.
      const checkoutOnly = await searchProperties(db, query);
      const match = checkoutOnly.results.find((r) => r.slug === "geo-checkout-booked");
      expect(match).toBeDefined();
      expect(match?.availableForWindow).toBe(true);

      // The same property vanishes the moment a night strictly inside the
      // stay is booked — the checkout-day exclusion must not overcorrect.
      const property = (
        await db
          .select()
          .from(properties)
          .where(and(eq(properties.source, "test-geo"), eq(properties.externalId, "geo-checkout-booked")))
      )[0];
      expect(property).toBeDefined();
      // The fixture has no 03-15 row yet — book one strictly inside the stay.
      await db.insert(availability).values({
        propertyId: property.id,
        date: "2027-03-15",
        status: "booked",
        nightlyPrice: null,
      });
      try {
        const interiorBooked = await searchProperties(db, query);
        expect(interiorBooked.results.map((r) => r.slug)).not.toContain("geo-checkout-booked");
        // Sibling inventory with a clear interior is unaffected.
        expect(interiorBooked.results.map((r) => r.slug)).toContain("geo-in");
      } finally {
        // Restore the fixture exactly as ingested so later tests see it.
        await db
          .delete(availability)
          .where(and(eq(availability.propertyId, property.id), eq(availability.date, "2027-03-15")));
      }
    });

    it("prices the window from the cheapest available night, falling back to base", async () => {
      const response = await searchProperties(db, query);
      const cheap = response.results.find((r) => r.slug === "geo-cheap");
      expect(cheap?.minNightly).toBe(90); // cheapest available night in window

      const center = response.results.find((r) => r.slug === "geo-in");
      expect(center?.minNightly).toBe(200); // no calendar rows → base rate

      // Half-open window [2027-03-12, 2027-03-14): only the 03-13 night is
      // priced — 03-14 is the checkout day and must not drag the minimum
      // down to its 90 rate.
      const later = await searchProperties(db, { ...query, checkIn: "2027-03-12", checkOut: "2027-03-14" });
      expect(later.results.find((r) => r.slug === "geo-cheap")?.minNightly).toBe(120);
    });

    it("filters by guests and property type", async () => {
      const solo = await searchProperties(db, { ...query, guests: 1 });
      expect(solo.results.map((r) => r.slug)).toContain("geo-small");

      const cabins = await searchProperties(db, { ...query, propertyType: "cabin" });
      const cabinSlugs = cabins.results.map((r) => r.slug);
      expect(cabinSlugs).toContain("geo-in");
      expect(cabinSlugs).not.toContain("geo-cheap"); // condo
    });

    it("persists a search event and returns its id", async () => {
      const response = await searchProperties(db, { ...query, sessionHash: "integration-session-hash" });
      const events = await db.select().from(searchEvents).where(eq(searchEvents.id, response.searchEventId));
      expect(events).toHaveLength(1);
      expect(events[0]?.lat).toBe(CENTER.latitude);
      expect(events[0]?.lng).toBe(CENTER.longitude);
      expect(events[0]?.radiusMiles).toBe(25);
      expect(events[0]?.checkIn).toBe("2027-03-13");
      expect(events[0]?.guests).toBe(2);
    });

    it("rejects invalid queries with SearchValidationError before SQL", async () => {
      await expect(searchProperties(db, { ...query, latitude: 95 })).rejects.toThrow(SearchValidationError);
      await expect(searchProperties(db, { ...query, radiusMiles: 0 })).rejects.toThrow(SearchValidationError);
      await expect(
        searchProperties(db, { ...query, checkOut: "2027-03-12" }),
      ).rejects.toThrow(SearchValidationError);
    });
  });
});
