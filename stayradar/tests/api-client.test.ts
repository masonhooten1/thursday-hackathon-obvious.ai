import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, createStayRadarClient } from "@/lib/api/client";
import type { PropertySearchQuery } from "@/lib/contracts";
import { inquiryResponse, searchResponse } from "./components/fixtures";

/**
 * Client API layer conformance (traveler UX task): the browser's only door
 * to the API must speak the PR #27 contracts — correct query-string param
 * names, responses parsed against the zod schemas, failures parsed through
 * the shared error envelope with field details preserved.
 */

// The client fetches with relative URLs; the base is irrelevant to the
// assertions and only satisfies the URL parser.
function parseUrl(url: string): URL {
  return new URL(url, "http://localhost");
}

function fetchJson(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

const baseQuery: PropertySearchQuery = {
  latitude: 39.0968,
  longitude: -120.0324,
  radiusMiles: 25,
  checkIn: "2027-06-04",
  checkOut: "2027-06-07",
  guests: 2,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StayRadarClient.search", () => {
  it("sends the contract's query-string parameter names", async () => {
    const fetchMock = fetchJson(200, searchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await createStayRadarClient().search({
      ...baseQuery,
      propertyType: "cabin",
      sessionHash: "abc12345-0000",
      utm: { utm_source: "dallas" },
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const params = parseUrl(url).searchParams;
    expect(params.get("latitude")).toBe("39.0968");
    expect(params.get("longitude")).toBe("-120.0324");
    expect(params.get("radiusMiles")).toBe("25");
    expect(params.get("checkIn")).toBe("2027-06-04");
    expect(params.get("checkOut")).toBe("2027-06-07");
    expect(params.get("guests")).toBe("2");
    expect(params.get("propertyType")).toBe("cabin");
    expect(params.get("sessionHash")).toBe("abc12345-0000");
    // utm keys ride along pre-prefixed — the route forwards them as the
    // origin-market signal.
    expect(params.get("utm_source")).toBe("dallas");
  });

  it("parses the response through the search contract", async () => {
    const response = searchResponse([
      {
        id: "00000000-0000-4000-8000-000000000001",
        slug: "lakeside-cabin",
        title: "Lakeside Cabin",
        market: "lake-tahoe",
        propertyType: "cabin",
        latitude: 39.0968,
        longitude: -120.0324,
        distanceMiles: 2.4,
        minNightly: 180,
        availableForWindow: true,
      },
    ]);
    vi.stubGlobal("fetch", fetchJson(200, response));

    const parsed = await createStayRadarClient().search(baseQuery);
    expect(parsed).toEqual(response);
  });

  it("throws ApiClientError with field details when the API returns the error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      fetchJson(400, {
        error: {
          code: "bad_request",
          message: "Invalid search",
          details: [{ path: "latitude", message: "Out of range" }],
        },
      }),
    );

    const error = await createStayRadarClient()
      .search(baseQuery)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    const clientError = error as ApiClientError;
    expect(clientError.code).toBe("bad_request");
    expect(clientError.status).toBe(400);
    expect(clientError.fieldErrors()).toEqual({ latitude: "Out of range" });
  });

  it("throws ApiClientError on a malformed response body", async () => {
    vi.stubGlobal("fetch", fetchJson(200, { results: "not-an-array" }));

    const error = await createStayRadarClient()
      .search(baseQuery)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("internal_error");
  });

  it("throws ApiClientError when the network itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    const error = await createStayRadarClient()
      .search(baseQuery)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).message).toContain("Could not reach the StayRadar API");
  });
});

describe("StayRadarClient.propertyDetail", () => {
  it("hits /api/properties/[id] and forwards the availability window", async () => {
    const fetchMock = fetchJson(200, {
      property: {
        id: "00000000-0000-4000-8000-000000000002",
        slug: "lakeside-cabin",
        title: "Lakeside Cabin",
        market: "lake-tahoe",
        source: "seed",
        propertyType: "cabin",
        address: null,
        maxGuests: 6,
        bedrooms: 3,
        amenities: [],
        baseNightly: 165,
        images: [],
        latitude: 39.0968,
        longitude: -120.0324,
      },
      availability: {
        propertyId: "00000000-0000-4000-8000-000000000002",
        checkIn: "2027-06-04",
        checkOut: "2027-06-07",
        days: [],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await createStayRadarClient().propertyDetail("00000000-0000-4000-8000-000000000002", {
      checkIn: "2027-06-04",
      checkOut: "2027-06-07",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/properties/00000000-0000-4000-8000-000000000002");
    expect(url).toContain("checkIn=2027-06-04");
    expect(url).toContain("checkOut=2027-06-07");
  });
});

describe("StayRadarClient.submitInquiry", () => {
  it("POSTs a contract-valid inquiry body to /api/inquiries", async () => {
    const fetchMock = fetchJson(201, inquiryResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await createStayRadarClient().submitInquiry({
      propertyId: "00000000-0000-4000-8000-000000000003",
      name: "Mason Hooten",
      email: "mason@example.com",
      checkIn: "2027-06-04",
      checkOut: "2027-06-07",
      guests: 2,
    });

    expect(response.status).toBe("received");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/inquiries");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      propertyId: "00000000-0000-4000-8000-000000000003",
      name: "Mason Hooten",
      email: "mason@example.com",
    });
  });
});
