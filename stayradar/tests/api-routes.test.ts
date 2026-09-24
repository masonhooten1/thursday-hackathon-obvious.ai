import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createDb } from "@/db";
import { applyMigrations, truncateAll } from "@/db/apply-migrations";
import { leads, properties, searchEvents } from "@/db/schema";
import type { PropertyInput } from "@/lib/services/ingestion/connector";
import { ingestProperties } from "@/lib/services/ingestion/ingest";
import {
  ErrorResponseSchema,
  InquiryResponseSchema,
  PropertyDetailResponseSchema,
  PropertySearchResponseSchema,
} from "@/lib/contracts";
import { GET as searchRoute } from "@/app/api/search/route";
import { GET as propertyRoute } from "@/app/api/properties/[id]/route";
import { POST as inquiriesRoute } from "@/app/api/inquiries/route";

/**
 * Route handler integration tests against a real Postgres 16 + PostGIS
 * database (spec verification matrix: "API routes — every route validates
 * input, returns typed responses, writes search_events on property search").
 * Handlers are invoked directly with NextRequest objects — no server needed.
 * Point TEST_DATABASE_URL at a provisioned database (CI: postgis/postgis:16
 * service container; local: see stayradar/README.md); tests skip otherwise.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

// Controlled inventory at an empty-ocean center, far from every seeded cluster.
const CENTER = { latitude: 45.0, longitude: -115.0 };
// The blocked window spans 2027-03-13..2027-03-16 with 03-15 booked, so the
// property is disqualified for it and present for the clear window.
const WINDOW_BLOCKED = { checkIn: "2027-03-13", checkOut: "2027-03-16" };
const WINDOW_CLEAR = { checkIn: "2027-03-20", checkOut: "2027-03-22" };

const fixtures: PropertyInput[] = [
  {
    source: "test-api",
    externalId: "api-cabin",
    slug: "api-route-cabin",
    title: "Route Test Cabin",
    market: "test-market",
    propertyType: "cabin",
    maxGuests: 4,
    bedrooms: 2,
    baseNightly: 200,
    location: CENTER,
    amenities: ["hot tub"],
    images: ["https://example.test/cabin.jpg"],
    availability: [
      { date: "2027-03-13", status: "available", nightlyPrice: 150 },
      { date: "2027-03-14", status: "available", nightlyPrice: 120 },
      { date: "2027-03-15", status: "booked", nightlyPrice: null },
      { date: "2027-03-21", status: "available", nightlyPrice: 130 },
    ],
  },
];

function searchRequest(query: Record<string, string>): NextRequest {
  const params = new URLSearchParams(query);
  return new NextRequest(`http://localhost:3000/api/search?${params.toString()}`);
}

function detailRequest(
  id: string,
  query: Record<string, string> = {},
): { request: NextRequest; params: Promise<{ id: string }> } {
  const params = new URLSearchParams(query);
  return {
    request: new NextRequest(`http://localhost:3000/api/properties/${id}?${params.toString()}`),
    params: Promise.resolve({ id }),
  };
}

function inquiryRequest(body: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/inquiries", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

describe.skipIf(!databaseUrl)("StayRadar API routes", () => {
  let db: ReturnType<typeof createDb>;
  let propertyId: string;

  beforeAll(async () => {
    db = createDb(databaseUrl as string);
    await applyMigrations(db);
    await truncateAll(db);
    await ingestProperties(db, fixtures);
    const rows = await db.select().from(properties);
    const match = rows.find((row) => row.slug === "api-route-cabin");
    if (!match) throw new Error("fixture property missing");
    propertyId = match.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  describe("GET /api/search", () => {
    it("returns typed results with distances and persists the search event", async () => {
      const response = await searchRoute(
        searchRequest({
          latitude: String(CENTER.latitude),
          longitude: String(CENTER.longitude),
          radiusMiles: "5",
          ...WINDOW_CLEAR,
          guests: "2",
          utm_source: "dallas",
          utm_campaign: "radius25mi",
        }),
      );
      expect(response.status).toBe(200);

      const parsed = PropertySearchResponseSchema.safeParse(await response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.total).toBe(1);
      expect(parsed.data.results[0]?.slug).toBe("api-route-cabin");
      expect(parsed.data.results[0]?.minNightly).toBe(130);
      expect(parsed.data.results[0]?.distanceMiles).toBeLessThan(0.1);

      // The attribution signal lands in the database (acceptance: searchEventId persisted).
      const eventRows = await db.select().from(searchEvents).where(eq(searchEvents.id, parsed.data.searchEventId));
      expect(eventRows).toHaveLength(1);
      expect(eventRows[0]?.radiusMiles).toBe(5);
      expect(eventRows[0]?.utm).toMatchObject({ utm_source: "dallas", utm_campaign: "radius25mi" });
    });

    it("disqualifies a property with a booked night inside the requested window", async () => {
      const blocked = await searchRoute(
        searchRequest({ latitude: String(CENTER.latitude), longitude: String(CENTER.longitude), ...WINDOW_BLOCKED }),
      );
      expect(blocked.status).toBe(200);
      const blockedBody = PropertySearchResponseSchema.parse(await blocked.json());
      expect(blockedBody.total).toBe(0); // empty result set is a valid, typed response

      const clear = await searchRoute(
        searchRequest({ latitude: String(CENTER.latitude), longitude: String(CENTER.longitude), ...WINDOW_CLEAR }),
      );
      const clearBody = PropertySearchResponseSchema.parse(await clear.json());
      expect(clearBody.results.map((r) => r.slug)).toContain("api-route-cabin");
    });

    it("applies defaults for radius and guests", async () => {
      const response = await searchRoute(
        searchRequest({ latitude: String(CENTER.latitude), longitude: String(CENTER.longitude), ...WINDOW_CLEAR }),
      );
      const body = PropertySearchResponseSchema.parse(await response.json());
      const eventRows = await db.select().from(searchEvents).where(eq(searchEvents.id, body.searchEventId));
      expect(eventRows[0]?.radiusMiles).toBe(25);
      expect(eventRows[0]?.guests).toBe(2);
    });

    it("maps invalid queries to the 400 error envelope with field details", async () => {
      const cases: Record<string, string>[] = [
        { latitude: "999", longitude: String(CENTER.longitude), ...WINDOW_CLEAR }, // out of range
        { latitude: String(CENTER.latitude), longitude: String(CENTER.longitude), ...WINDOW_CLEAR, radiusMiles: "-5" }, // radius bounds
        { latitude: String(CENTER.latitude), longitude: String(CENTER.longitude), checkIn: "03/13/2027", checkOut: "2027-03-16" }, // malformed date
        { latitude: String(CENTER.latitude), longitude: String(CENTER.longitude), ...WINDOW_CLEAR, guests: "0" }, // guests bounds
      ];
      for (const query of cases) {
        const response = await searchRoute(searchRequest(query));
        expect(response.status).toBe(400);
        const parsed = ErrorResponseSchema.safeParse(await response.json());
        expect(parsed.success).toBe(true);
        if (!parsed.success) continue;
        expect(parsed.data.error.code).toBe("bad_request");
        expect(parsed.data.error.details?.length).toBeGreaterThan(0);
      }
    });

    it("ignores unknown query params instead of failing", async () => {
      const response = await searchRoute(
        searchRequest({
          latitude: String(CENTER.latitude),
          longitude: String(CENTER.longitude),
          ...WINDOW_CLEAR,
          surprise: "1",
        }),
      );
      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/properties/[id]", () => {
    it("returns the detail + full calendar and parses against the contract", async () => {
      const { request, params } = detailRequest(propertyId);
      const response = await propertyRoute(request, { params });
      expect(response.status).toBe(200);

      const parsed = PropertyDetailResponseSchema.safeParse(await response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.property.id).toBe(propertyId);
      expect(parsed.data.property.baseNightly).toBe(200);
      expect(parsed.data.availability.checkIn).toBeNull(); // full calendar requested
      expect(parsed.data.availability.days.map((d) => d.status)).toEqual([
        "available",
        "available",
        "booked",
        "available",
      ]);
      expect(parsed.data.availability.days.find((d) => d.status === "booked")?.nightlyPrice).toBeNull();
    });

    it("slices the calendar to the requested window and echoes it", async () => {
      const { request, params } = detailRequest(propertyId, { ...WINDOW_BLOCKED });
      const response = await propertyRoute(request, { params });
      expect(response.status).toBe(200);

      const body = PropertyDetailResponseSchema.parse(await response.json());
      expect(body.availability.checkIn).toBe(WINDOW_BLOCKED.checkIn);
      expect(body.availability.checkOut).toBe(WINDOW_BLOCKED.checkOut);
      // The booked night inside the window is visible in the calendar slice.
      expect(body.availability.days.map((d) => d.status)).toEqual(["available", "available", "booked"]);
      expect(body.availability.days.find((d) => d.date === "2027-03-14")?.nightlyPrice).toBe(120);
    });

    it("returns the 404 envelope for an unknown id and 400 for a malformed one", async () => {
      const unknownReq = detailRequest("00000000-0000-4000-8000-000000000000");
      const unknown = await propertyRoute(unknownReq.request, { params: unknownReq.params });
      expect(unknown.status).toBe(404);
      const unknownBody = ErrorResponseSchema.parse(await unknown.json());
      expect(unknownBody.error.code).toBe("not_found");

      const malformedReq = detailRequest("not-a-uuid");
      const malformed = await propertyRoute(malformedReq.request, { params: malformedReq.params });
      expect(malformed.status).toBe(400);
      const malformedBody = ErrorResponseSchema.parse(await malformed.json());
      expect(malformedBody.error.code).toBe("bad_request");
      expect(malformedBody.error.details?.some((issue) => issue.path === "id")).toBe(true);
    });

    it("rejects a half-open window with the 400 envelope", async () => {
      const { request, params } = detailRequest(propertyId, { checkIn: "2027-03-13" });
      const response = await propertyRoute(request, { params });
      expect(response.status).toBe(400);
      const body = ErrorResponseSchema.parse(await response.json());
      expect(body.error.details?.some((issue) => issue.path === "checkOut")).toBe(true);
    });
  });

  describe("POST /api/inquiries", () => {
    it("persists the lead linked to the originating search event", async () => {
      // Produce a real search event through the search route, then attribute to it.
      const search = await searchRoute(
        searchRequest({ latitude: String(CENTER.latitude), longitude: String(CENTER.longitude), ...WINDOW_CLEAR }),
      );
      const searchEventId = PropertySearchResponseSchema.parse(await search.json()).searchEventId;

      const response = await inquiriesRoute(
        inquiryRequest(
          JSON.stringify({
            propertyId,
            searchEventId,
            checkIn: "2027-03-20",
            checkOut: "2027-03-22",
            guests: 2,
            name: "Mason Hooten",
            email: "mason@example.com",
            message: "Is the hot tub open in March?",
          }),
        ),
      );
      expect(response.status).toBe(201);

      const parsed = InquiryResponseSchema.safeParse(await response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.status).toBe("received");
      expect(parsed.data.searchEventId).toBe(searchEventId);

      // Acceptance: the lead row links back to the search event.
      const leadRows = await db.select().from(leads).where(eq(leads.searchEventId, searchEventId));
      expect(leadRows).toHaveLength(1);
      expect(leadRows[0]?.email).toBe("mason@example.com");
      expect(leadRows[0]?.guests).toBe(2);
    });

    it("accepts an inquiry without attribution (searchEventId stays null)", async () => {
      const response = await inquiriesRoute(
        inquiryRequest(JSON.stringify({ propertyId, name: "No Attribution", email: "anon@example.com" })),
      );
      expect(response.status).toBe(201);
      const body = InquiryResponseSchema.parse(await response.json());
      expect(body.searchEventId).toBeNull();
    });

    it("returns 404 for an unknown property and 400 for an unknown search event", async () => {
      const unknownProperty = await inquiriesRoute(
        inquiryRequest(
          JSON.stringify({
            propertyId: "00000000-0000-4000-8000-000000000000",
            name: "Ghost",
            email: "ghost@example.com",
          }),
        ),
      );
      expect(unknownProperty.status).toBe(404);
      expect((await unknownProperty.json()).error.code).toBe("not_found");

      const unknownEvent = await inquiriesRoute(
        inquiryRequest(
          JSON.stringify({
            propertyId,
            searchEventId: "00000000-0000-4000-8000-000000000000",
            name: "Broken Link",
            email: "broken@example.com",
          }),
        ),
      );
      expect(unknownEvent.status).toBe(400);
      const eventBody = ErrorResponseSchema.parse(await unknownEvent.json());
      expect(eventBody.error.details?.some((issue) => issue.path === "searchEventId")).toBe(true);
    });

    it("maps validation failures and malformed JSON to the 400 envelope", async () => {
      const invalid = await inquiriesRoute(
        inquiryRequest(JSON.stringify({ propertyId, name: "", email: "not-an-email" })),
      );
      expect(invalid.status).toBe(400);
      const invalidBody = ErrorResponseSchema.parse(await invalid.json());
      expect(invalidBody.error.code).toBe("bad_request");
      expect(invalidBody.error.details?.some((issue) => issue.path === "email")).toBe(true);

      const inverted = await inquiriesRoute(
        inquiryRequest(
          JSON.stringify({ propertyId, checkIn: "2027-03-22", checkOut: "2027-03-20", name: "X", email: "x@example.com" }),
        ),
      );
      expect(inverted.status).toBe(400);

      const malformed = await inquiriesRoute(inquiryRequest("{not json"));
      expect(malformed.status).toBe(400);
      expect((await malformed.json()).error.code).toBe("bad_request");
    });
  });
});
