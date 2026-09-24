import { describe, expect, it } from "vitest";
import {
  AvailabilityDaySchema,
  AvailabilityWindowSchema,
  ErrorResponseSchema,
  InquiryRequestSchema,
  InquiryResponseSchema,
  PropertyDetailResponseSchema,
  PropertySearchQuerySchema,
  PropertySearchResponseSchema,
} from "@/lib/contracts";

/**
 * Contract round-trips (spec verification matrix: "Every route validates
 * input, returns typed responses"). Pure schema checks — no database.
 */

const validSearchQuery = {
  latitude: 39.0968,
  longitude: -120.0324,
  checkIn: "2027-03-13",
  checkOut: "2027-03-16",
};

describe("PropertySearchQuerySchema", () => {
  it("accepts a valid query and applies defaults", () => {
    const parsed = PropertySearchQuerySchema.parse(validSearchQuery);
    expect(parsed.radiusMiles).toBe(25);
    expect(parsed.guests).toBe(2);
    expect(parsed.propertyType).toBeUndefined();
  });

  it("coerces the query-string wire form (strings → numbers)", () => {
    const parsed = PropertySearchQuerySchema.parse({
      latitude: "39.0968",
      longitude: "-120.0324",
      radiusMiles: "10",
      checkIn: "2027-03-13",
      checkOut: "2027-03-16",
      guests: "4",
    });
    expect(parsed).toMatchObject({ latitude: 39.0968, longitude: -120.0324, radiusMiles: 10, guests: 4 });
  });

  it("rejects out-of-range coordinates", () => {
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, latitude: 95 }).success).toBe(false);
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, longitude: -181 }).success).toBe(false);
  });

  it("rejects a non-positive or oversized radius", () => {
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, radiusMiles: 0 }).success).toBe(false);
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, radiusMiles: -5 }).success).toBe(false);
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, radiusMiles: 501 }).success).toBe(false);
  });

  it("rejects malformed dates and an inverted window", () => {
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, checkIn: "03/13/2027" }).success).toBe(false);
    expect(
      PropertySearchQuerySchema.safeParse({ ...validSearchQuery, checkOut: "2027-03-12" }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict) and a non-enum property type", () => {
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, surprise: 1 }).success).toBe(false);
    expect(PropertySearchQuerySchema.safeParse({ ...validSearchQuery, propertyType: "boat" }).success).toBe(false);
  });
});

describe("PropertySearchResponseSchema", () => {
  const response = {
    searchEventId: "0f0a3f47-9f21-4d63-9a4f-2f2ab9d0f1c1",
    total: 1,
    results: [
      {
        id: "3f6a5c1e-8f70-4a4e-9d1e-6b2c0d9e7a55",
        slug: "taughannock-cabin",
        title: "Cabin",
        market: "lake-tahoe",
        propertyType: "cabin",
        latitude: 39.1,
        longitude: -120.03,
        distanceMiles: 2.5,
        minNightly: 180,
        availableForWindow: true,
      },
    ],
  };

  it("round-trips a valid response", () => {
    expect(PropertySearchResponseSchema.parse(response)).toMatchObject({ total: 1 });
  });

  it("accepts the valid empty result set (spec: typed response)", () => {
    expect(PropertySearchResponseSchema.safeParse({ ...response, results: [], total: 0 }).success).toBe(true);
  });

  it("rejects a non-uuid searchEventId", () => {
    expect(PropertySearchResponseSchema.safeParse({ ...response, searchEventId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("PropertyDetailResponseSchema", () => {
  const detailResponse = {
    property: {
      id: "3f6a5c1e-8f70-4a4e-9d1e-6b2c0d9e7a55",
      slug: "taughannock-cabin",
      title: "Cabin",
      market: "lake-tahoe",
      source: "seed",
      propertyType: "cabin",
      address: null,
      maxGuests: 4,
      bedrooms: 2,
      amenities: ["hot tub"],
      baseNightly: 200,
      images: [],
      latitude: 39.1,
      longitude: -120.03,
    },
    availability: {
      propertyId: "3f6a5c1e-8f70-4a4e-9d1e-6b2c0d9e7a55",
      checkIn: "2027-03-13",
      checkOut: "2027-03-15",
      days: [
        { date: "2027-03-13", status: "available", nightlyPrice: 150 },
        { date: "2027-03-14", status: "booked", nightlyPrice: null },
      ],
    },
  };

  it("round-trips a valid detail + calendar response", () => {
    expect(PropertyDetailResponseSchema.parse(detailResponse).property.slug).toBe("taughannock-cabin");
  });

  it("rejects an invalid availability status and a non-ISO day", () => {
    const badStatus = structuredClone(detailResponse);
    badStatus.availability.days[0].status = "maybe";
    expect(PropertyDetailResponseSchema.safeParse(badStatus).success).toBe(false);

    const badDate = structuredClone(detailResponse);
    badDate.availability.days[0].date = "2027-3-13";
    expect(PropertyDetailResponseSchema.safeParse(badDate).success).toBe(false);
  });

  it("keeps AvailabilityDaySchema strict about the null price on booked nights", () => {
    expect(
      AvailabilityDaySchema.safeParse({ date: "2027-03-14", status: "booked", nightlyPrice: null }).success,
    ).toBe(true);
    expect(
      AvailabilityDaySchema.safeParse({ date: "2027-03-14", status: "booked" }).success,
    ).toBe(false);
  });
});

describe("AvailabilityWindowSchema", () => {
  it("accepts an empty window and a valid window", () => {
    expect(AvailabilityWindowSchema.safeParse({}).success).toBe(true);
    expect(AvailabilityWindowSchema.safeParse({ checkIn: "2027-03-13", checkOut: "2027-03-15" }).success).toBe(true);
  });

  it("rejects a half-open window and an inverted window", () => {
    expect(AvailabilityWindowSchema.safeParse({ checkIn: "2027-03-13" }).success).toBe(false);
    expect(
      AvailabilityWindowSchema.safeParse({ checkIn: "2027-03-15", checkOut: "2027-03-13" }).success,
    ).toBe(false);
  });
});

describe("InquiryRequestSchema", () => {
  const validInquiry = {
    propertyId: "3f6a5c1e-8f70-4a4e-9d1e-6b2c0d9e7a55",
    name: "Mason Hooten",
    email: "mason@example.com",
  };

  it("accepts a minimal valid inquiry", () => {
    expect(InquiryRequestSchema.parse(validInquiry).name).toBe("Mason Hooten");
  });

  it("accepts the full form with attribution and stay details", () => {
    const parsed = InquiryRequestSchema.parse({
      ...validInquiry,
      searchEventId: "0f0a3f47-9f21-4d63-9a4f-2f2ab9d0f1c1",
      checkIn: "2027-03-13",
      checkOut: "2027-03-16",
      guests: 2,
      message: "Is the hot tub open in March?",
    });
    expect(parsed.searchEventId).toBe("0f0a3f47-9f21-4d63-9a4f-2f2ab9d0f1c1");
  });

  it("rejects a malformed email, empty name, unknown propertyId shape, and inverted window", () => {
    expect(InquiryRequestSchema.safeParse({ ...validInquiry, email: "not-an-email" }).success).toBe(false);
    expect(InquiryRequestSchema.safeParse({ ...validInquiry, name: "" }).success).toBe(false);
    expect(InquiryRequestSchema.safeParse({ ...validInquiry, propertyId: "abc" }).success).toBe(false);
    expect(
      InquiryRequestSchema.safeParse({ ...validInquiry, checkIn: "2027-03-16", checkOut: "2027-03-13" }).success,
    ).toBe(false);
  });
});

describe("InquiryResponseSchema", () => {
  it("round-trips a valid response with a nullable searchEventId", () => {
    const base = {
      id: "8c1f0a2b-4c3d-4e5f-9a8b-7d6e5f4a3b2c",
      propertyId: "3f6a5c1e-8f70-4a4e-9d1e-6b2c0d9e7a55",
      status: "received",
      createdAt: "2027-01-15T10:30:00.000Z",
    };
    expect(InquiryResponseSchema.parse({ ...base, searchEventId: null }).searchEventId).toBeNull();
    expect(
      InquiryResponseSchema.parse({ ...base, searchEventId: "0f0a3f47-9f21-4d63-9a4f-2f2ab9d0f1c1" })
        .searchEventId,
    ).toBe("0f0a3f47-9f21-4d63-9a4f-2f2ab9d0f1c1");
    expect(InquiryResponseSchema.safeParse({ ...base, createdAt: "15 Jan 2027" }).success).toBe(false);
  });
});

describe("ErrorResponseSchema", () => {
  it("round-trips the envelope with and without field details", () => {
    const parsed = ErrorResponseSchema.parse({
      error: {
        code: "bad_request",
        message: "Invalid property search query",
        details: [{ path: "latitude", message: "expected ≤ 90" }],
      },
    });
    expect(parsed.error.details).toHaveLength(1);

    expect(
      ErrorResponseSchema.safeParse({ error: { code: "not_found", message: "no property" } }).success,
    ).toBe(true);
  });

  it("rejects an unknown error code", () => {
    expect(ErrorResponseSchema.safeParse({ error: { code: "kaboom", message: "x" } }).success).toBe(false);
  });
});
