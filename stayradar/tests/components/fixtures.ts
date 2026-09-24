import type {
  AvailabilityCalendar,
  InquiryResponse,
  PropertyDetailResponse,
  PropertySearchResponse,
  PropertySearchResult,
} from "@/lib/contracts";

/**
 * Contract-shaped test fixtures (traveler UX task). Every builder emits data
 * that parses against the PR #27 zod contracts, so component tests fail on
 * contract drift rather than silently testing shapes that cannot occur.
 */

let idCounter = 0;

export function testId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

export function searchResult(overrides: Partial<PropertySearchResult> = {}): PropertySearchResult {
  return {
    id: testId(),
    slug: "lakeside-cabin",
    title: "Lakeside Cabin",
    market: "lake-tahoe",
    propertyType: "cabin",
    latitude: 39.0968,
    longitude: -120.0324,
    distanceMiles: 2.4,
    minNightly: 180,
    availableForWindow: true,
    ...overrides,
  };
}

export function searchResponse(
  results: PropertySearchResult[],
  overrides: Partial<PropertySearchResponse> = {},
): PropertySearchResponse {
  return {
    searchEventId: testId(),
    results,
    total: results.length,
    ...overrides,
  };
}

export function calendarDay(
  date: string,
  status: "available" | "booked" | "blocked",
  nightlyPrice: number | null = status === "available" ? 175 : null,
): AvailabilityCalendar["days"][number] {
  return { date, status, nightlyPrice };
}

/** A short two-month calendar: open, booked, and blocked nights in each. */
export function calendarFixture(): AvailabilityCalendar {
  return {
    propertyId: testId(),
    checkIn: null,
    checkOut: null,
    days: [
      calendarDay("2027-03-01", "available", 150),
      calendarDay("2027-03-02", "available", 150),
      calendarDay("2027-03-03", "booked"),
      calendarDay("2027-03-04", "blocked"),
      calendarDay("2027-03-05", "available", 165),
      calendarDay("2027-04-01", "available", 200),
      calendarDay("2027-04-02", "booked"),
    ],
  };
}

export function detailResponse(
  overrides: Partial<PropertyDetailResponse["property"]> = {},
): PropertyDetailResponse {
  return {
    property: {
      id: testId(),
      slug: "lakeside-cabin",
      title: "Lakeside Cabin",
      market: "lake-tahoe",
      source: "seed",
      propertyType: "cabin",
      address: "1 Lake Shore Dr, Lake Tahoe",
      maxGuests: 6,
      bedrooms: 3,
      amenities: ["Hot tub", "Fireplace", "Lake view"],
      baseNightly: 165,
      images: ["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"],
      latitude: 39.0968,
      longitude: -120.0324,
      ...overrides,
    },
    availability: calendarFixture(),
  };
}

export function inquiryResponse(): InquiryResponse {
  return {
    id: testId(),
    propertyId: testId(),
    searchEventId: testId(),
    status: "received",
    createdAt: "2027-03-01T12:00:00.000Z",
  };
}
