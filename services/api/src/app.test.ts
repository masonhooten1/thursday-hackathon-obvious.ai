import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AvailabilityResponseSchema,
  CampgroundSchema,
  ParkSchema,
  type AvailabilitySnapshot,
  type Campground,
  type Park,
} from "@campground/shared";
import { createApp } from "./app";
import type { AvailabilitySource } from "./adapters/types";
import { createCatalogSchema, insertCatalog } from "./catalog/schema";
import { openDb } from "./db";
import { PollCycleInProgress, createPoller, type PollCycleReport } from "./poller";
import { createSnapshotsSchema } from "./snapshots/store";

const NOW = new Date("2026-09-24T19:50:00.000Z");

const PARKS: Park[] = [
  { id: "grand-canyon", name: "Grand Canyon National Park", state: "Arizona", lat: 36.05, lng: -112.14 },
  { id: "zion", name: "Zion National Park", state: "Utah", lat: 37.3, lng: -113.03 },
];

const campground = (facilityId: number, parkId: string, siteTypes: Campground["siteTypes"]): Campground => ({
  facilityId,
  parkId,
  name: `Campground ${facilityId}`,
  lat: 37.2,
  lng: -112.98,
  bookingUrl: `https://www.recreation.gov/camping/campgrounds/${facilityId}`,
  siteTypes,
});

const CAMPGROUNDS: Campground[] = [
  campground(101, "zion", ["tent", "rv"]),
  campground(102, "zion", ["cabin"]),
  campground(201, "grand-canyon", ["rv"]),
];

/** A contract-valid snapshot whose counts vary by night index (assertable slices). */
function fakeSnapshot(facilityId: number, capturedAt: Date, windowStart = "2026-09-24"): AvailabilitySnapshot {
  const nights = 14;
  return {
    facilityId,
    capturedAt: capturedAt.toISOString(),
    windowStart,
    nights,
    byType: {
      tent: Array.from({ length: nights }, (_, i) => i),
      rv: Array.from({ length: nights }, (_, i) => nights - i),
      cabin: Array.from({ length: nights }, () => 0),
      group: Array.from({ length: nights }, () => 0),
      other: Array.from({ length: nights }, () => 0),
    },
    totalSites: 5,
  };
}

class FakeAvailability implements AvailabilitySource {
  readonly name = "fake";
  private readonly results = new Map<number, AvailabilitySnapshot | Error>();

  set(facilityId: number, result: AvailabilitySnapshot | Error): void {
    this.results.set(facilityId, result);
  }

  async fetchFacilityAvailability(
    facilityId: number,
    start: Date,
    nights: number,
  ): Promise<AvailabilitySnapshot> {
    void nights;
    void start;
    const result = this.results.get(facilityId);
    if (result instanceof Error) throw result;
    if (!result) throw new Error(`no fake result configured for facility ${facilityId}`);
    return result;
  }
}

interface Harness {
  app: ReturnType<typeof createApp>;
  availability: FakeAvailability;
  /** The real poll cycle — exactly the work one scheduler tick performs. */
  runTick: () => Promise<PollCycleReport>;
}

/**
 * Full D4 integration harness: seeded catalog, a fake availability source
 * behind the adapter interface, and the app wired to the REAL poller.
 */
function harness(
  options: {
    now?: () => Date;
    adminPollSecret?: string;
    parks?: Park[];
    campgrounds?: Campground[];
    pollNow?: Harness["runTick"];
  } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), "app-integration-"));
  const db = openDb(join(dir, "test.db"));
  createCatalogSchema(db);
  createSnapshotsSchema(db);
  insertCatalog(db, options.parks ?? PARKS, options.campgrounds ?? CAMPGROUNDS);

  const availability = new FakeAvailability();
  const runTick = options.pollNow ?? createPoller({ db, availability, now: options.now, sleep: async () => {} });
  const app = createApp({
    db,
    pollNow: runTick,
    adminPollSecret: options.adminPollSecret,
    now: options.now,
  });
  return { app, availability, runTick };
}

/** Configures every campground's source to answer with a snapshot captured at `capturedAt`. */
function answerForAll(h: Harness, capturedAt: Date): void {
  for (const campground of CAMPGROUNDS) {
    h.availability.set(campground.facilityId, fakeSnapshot(campground.facilityId, capturedAt));
  }
}

describe("GET /health", () => {
  it("responds ok", async () => {
    const { app } = harness();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/parks", () => {
  it("serves the seeded parks", async () => {
    const { app } = harness();
    const res = await app.request("/api/parks");
    expect(res.status).toBe(200);
    expect(ParkSchema.array().parse(await res.json())).toEqual(PARKS);
  });

  it("serves an empty array on an empty catalog", async () => {
    const { app } = harness({ parks: [], campgrounds: [] });
    const res = await app.request("/api/parks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /api/campgrounds", () => {
  it("serves every catalog campground, ordered by park then id", async () => {
    const { app } = harness();
    const res = await app.request("/api/campgrounds");
    expect(res.status).toBe(200);
    const campgrounds = CampgroundSchema.array().parse(await res.json());
    expect(campgrounds.map((c) => c.facilityId)).toEqual([201, 101, 102]); // grand-canyon < zion
  });

  it("filters by parkId", async () => {
    const { app } = harness();
    const res = await app.request("/api/campgrounds?parkId=zion");
    const campgrounds = CampgroundSchema.array().parse(await res.json());
    expect(campgrounds.map((c) => c.facilityId)).toEqual([101, 102]);
  });

  it("filters by site type", async () => {
    const { app } = harness();
    const res = await app.request("/api/campgrounds?type=rv");
    const campgrounds = CampgroundSchema.array().parse(await res.json());
    expect(campgrounds.map((c) => c.facilityId)).toEqual([201, 101]);
  });

  it("combines parkId and type filters", async () => {
    const { app } = harness();
    const res = await app.request("/api/campgrounds?parkId=zion&type=cabin");
    const campgrounds = CampgroundSchema.array().parse(await res.json());
    expect(campgrounds.map((c) => c.facilityId)).toEqual([102]);
  });

  it("rejects an unknown site type with 400", async () => {
    const { app } = harness();
    const res = await app.request("/api/campgrounds?type=yurt");
    expect(res.status).toBe(400);
  });

  it("returns an empty list for an unknown parkId", async () => {
    const { app } = harness();
    const res = await app.request("/api/campgrounds?parkId=shenandoah");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /api/availability", () => {
  it("serves null snapshots and no staleness before any poll cycle", async () => {
    const { app } = harness({ now: () => NOW });
    const res = await app.request("/api/availability?date=2026-09-24");
    expect(res.status).toBe(200);
    const body = AvailabilityResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ date: "2026-09-24", stale: false });
    expect(body.campgrounds).toHaveLength(3);
    expect(body.campgrounds.every((c) => c.snapshot === null)).toBe(true);
  });

  it("one scheduler tick writes snapshots; the endpoint serves counts by type for the requested night", async () => {
    const h = harness({ now: () => NOW });
    answerForAll(h, NOW);
    await h.runTick();

    const res = await h.app.request("/api/availability?date=2026-09-26"); // index 2 in the window
    expect(res.status).toBe(200);
    const body = AvailabilityResponseSchema.parse(await res.json());
    expect(body.stale).toBe(false);
    expect(body.date).toBe("2026-09-26");

    const first = body.campgrounds.find((c) => c.facilityId === 101);
    expect(first?.snapshot?.capturedAt).toBe(NOW.toISOString());
    // tent[i] = i and rv[i] = nights - i → night index 2: tent 2, rv 12.
    expect(first?.snapshot?.byType.tent[2]).toBe(2);
    expect(first?.snapshot?.byType.rv[2]).toBe(12);
  });

  it("is stale at exactly twice the poll interval (30 minutes)", async () => {
    const h = harness({ now: () => NOW });
    answerForAll(h, new Date(NOW.getTime() - 30 * 60_000));
    await h.runTick();

    const res = await h.app.request("/api/availability?date=2026-09-24");
    const body = AvailabilityResponseSchema.parse(await res.json());
    expect(body.stale).toBe(true);
  });

  it("is not stale at exactly one poll interval (15 minutes)", async () => {
    const h = harness({ now: () => NOW });
    answerForAll(h, new Date(NOW.getTime() - 15 * 60_000));
    await h.runTick();

    const res = await h.app.request("/api/availability?date=2026-09-24");
    const body = AvailabilityResponseSchema.parse(await res.json());
    expect(body.stale).toBe(false);
  });

  it("stays fresh while any snapshot is fresh, even when another facility degraded", async () => {
    const h = harness({ now: () => NOW });
    answerForAll(h, NOW);
    await h.runTick();

    // Second tick: facility 101's source fails; 101 keeps its old snapshot,
    // the rest move forward — the freshest data is still fresh.
    h.availability.set(101, new Error("upstream 503"));
    answerForAll(h, new Date(NOW.getTime() + 15 * 60_000));
    h.availability.set(101, new Error("upstream 503"));
    await h.runTick();

    const res = await h.app.request("/api/availability?date=2026-09-24");
    const body = AvailabilityResponseSchema.parse(await res.json());
    expect(body.stale).toBe(false);
    const degraded = body.campgrounds.find((c) => c.facilityId === 101);
    expect(degraded?.snapshot?.capturedAt).toBe(NOW.toISOString()); // last-known data kept
  });

  it("rejects malformed dates", async () => {
    const { app } = harness();
    const res = await app.request("/api/availability?date=yesterday");
    expect(res.status).toBe(400);
  });

  it("rejects impossible calendar dates", async () => {
    const { app } = harness();
    const res = await app.request("/api/availability?date=2026-02-30");
    expect(res.status).toBe(400);
  });

  it("defaults to tonight (UTC) from the injected clock", async () => {
    const { app } = harness({ now: () => NOW });
    const res = await app.request("/api/availability");
    expect(res.status).toBe(200);
    const body = AvailabilityResponseSchema.parse(await res.json());
    expect(body.date).toBe("2026-09-24");
    expect(body.fetchedAt).toBe(NOW.toISOString());
  });
});

describe("POST /api/admin/poll", () => {
  const SECRET = "test-admin-secret";

  it("is disabled with 503 when no secret is configured", async () => {
    const { app } = harness();
    const res = await app.request("/api/admin/poll", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(503);
  });

  it("rejects a missing Authorization header with 401", async () => {
    const { app } = harness({ adminPollSecret: SECRET });
    const res = await app.request("/api/admin/poll", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects a bad bearer with 401", async () => {
    const { app } = harness({ adminPollSecret: SECRET });
    const res = await app.request("/api/admin/poll", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("runs a real cycle on the correct bearer and returns its report", async () => {
    const h = harness({ now: () => NOW, adminPollSecret: SECRET });
    answerForAll(h, NOW);

    const res = await h.app.request("/api/admin/poll", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ polled: 3, succeeded: 3, failed: 0 });

    // The trigger's cycle really wrote snapshots the API now serves.
    const availability = await h.app.request("/api/availability?date=2026-09-24");
    const body = AvailabilityResponseSchema.parse(await availability.json());
    expect(body.campgrounds.every((c) => c.snapshot !== null)).toBe(true);
  });

  it("answers 409 when a cycle is already running", async () => {
    const { app } = harness({
      adminPollSecret: SECRET,
      pollNow: () => Promise.reject(new PollCycleInProgress()),
    });
    const res = await app.request("/api/admin/poll", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(409);
  });
});
