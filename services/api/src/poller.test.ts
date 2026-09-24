import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AvailabilitySnapshot, Campground, Park } from "@campground/shared";
import type { AvailabilitySource } from "./adapters/types";
import { createCatalogSchema, insertCatalog } from "./catalog/schema";
import { openDb } from "./db";
import { createPoller, PollCycleInProgress } from "./poller";
import { createSnapshotsSchema, insertSnapshot, latestSnapshot } from "./snapshots/store";

const PARK: Park = { id: "zion", name: "Zion National Park", state: "Utah", lat: 37.3, lng: -113.03 };

const campground = (facilityId: number): Campground => ({
  facilityId,
  parkId: "zion",
  name: `Campground ${facilityId}`,
  lat: 37.2,
  lng: -112.98,
  bookingUrl: `https://www.recreation.gov/camping/campgrounds/${facilityId}`,
  siteTypes: ["tent"],
});

/** A contract-valid snapshot whose counts vary by night index (assertable slices). */
function fakeSnapshot(facilityId: number, capturedAt: Date, nights = 14): AvailabilitySnapshot {
  return {
    facilityId,
    capturedAt: capturedAt.toISOString(),
    windowStart: capturedAt.toISOString().slice(0, 10),
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

/** AvailabilitySource stand-in: queued results, recorded calls, optional gate. */
class FakeAvailability implements AvailabilitySource {
  readonly name = "fake";
  calls: Array<{ facilityId: number; start: Date; nights: number }> = [];
  private readonly results = new Map<number, AvailabilitySnapshot | Error>();
  private gate: Promise<void> = Promise.resolve();

  set(facilityId: number, result: AvailabilitySnapshot | Error): void {
    this.results.set(facilityId, result);
  }

  /** Holds every fetch until the returned release is called. */
  hang(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async fetchFacilityAvailability(
    facilityId: number,
    start: Date,
    nights: number,
  ): Promise<AvailabilitySnapshot> {
    this.calls.push({ facilityId, start, nights });
    await this.gate;
    const result = this.results.get(facilityId);
    if (result instanceof Error) throw result;
    if (!result) throw new Error(`no fake result configured for facility ${facilityId}`);
    return result;
  }
}

function harness(campgroundIds: number[], now: () => Date = () => new Date()) {
  const dir = mkdtempSync(join(tmpdir(), "poller-"));
  const db = openDb(join(dir, "test.db"));
  createCatalogSchema(db);
  createSnapshotsSchema(db);
  insertCatalog(db, [PARK], campgroundIds.map(campground));
  const availability = new FakeAvailability();
  const sleeps: number[] = [];
  const logs: string[] = [];
  const runCycle = createPoller({
    db,
    availability,
    now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (message) => logs.push(message),
  });
  return { db, availability, sleeps, logs, runCycle };
}

describe("createPoller — one cycle", () => {
  it("writes one snapshot per campground per cycle", async () => {
    const { db, availability, runCycle } = harness([101, 102, 103]);
    for (const id of [101, 102, 103]) availability.set(id, fakeSnapshot(id, new Date()));
    const report = await runCycle();
    expect(report).toMatchObject({ polled: 3, succeeded: 3, failed: 0, failures: [] });
    for (const id of [101, 102, 103]) {
      expect(latestSnapshot(db, id)?.facilityId).toBe(id);
    }
  });

  it("passes every facility the same cycle window of 14 nights", async () => {
    const { availability, runCycle } = harness([101, 102]);
    for (const id of [101, 102]) availability.set(id, fakeSnapshot(id, new Date()));
    await runCycle();
    expect(availability.calls).toHaveLength(2);
    expect(availability.calls.every((call) => call.nights === 14)).toBe(true);
    expect(new Set(availability.calls.map((call) => call.start.getTime())).size).toBe(1);
  });

  it("polls an empty catalog into a clean report", async () => {
    const { runCycle } = harness([]);
    await expect(runCycle()).resolves.toMatchObject({
      polled: 0,
      succeeded: 0,
      failed: 0,
      pruned: 0,
    });
  });
});

describe("createPoller — degraded sources", () => {
  it("keeps the previous snapshot for a failing facility and reports the failure", async () => {
    let clock = new Date("2026-09-24T19:45:00.000Z");
    const { db, availability, logs, runCycle } = harness([101, 102], () => clock);
    for (const id of [101, 102]) availability.set(id, fakeSnapshot(id, clock));
    await runCycle();

    clock = new Date("2026-09-24T20:00:00.000Z");
    availability.set(101, new Error("upstream 503"));
    availability.set(102, fakeSnapshot(102, clock)); // the source re-stamps capturedAt per fetch
    const report = await runCycle();

    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.failures).toEqual([{ facilityId: 101, error: "upstream 503" }]);
    // Facility 101 keeps its last-known snapshot; 102 moved forward.
    expect(latestSnapshot(db, 101)?.capturedAt).toBe("2026-09-24T19:45:00.000Z");
    expect(latestSnapshot(db, 102)?.capturedAt).toBe("2026-09-24T20:00:00.000Z");
    expect(logs.some((line) => line.includes("degraded") && line.includes("101"))).toBe(true);
  });

  it("treats a snapshot answering for the wrong facility as a failure, not data", async () => {
    const { db, availability, runCycle } = harness([101]);
    // Asked for 101, the fake answers with a 999 snapshot — a misbehaving source.
    availability.set(101, fakeSnapshot(999, new Date()));
    const report = await runCycle();

    expect(report.succeeded).toBe(0);
    expect(report.failures[0]?.error).toMatch(/expected 101/);
    expect(latestSnapshot(db, 101)).toBeNull();
    expect(latestSnapshot(db, 999)).toBeNull();
  });
});

describe("createPoller — stagger", () => {
  it("sleeps between campgrounds, not before the first", async () => {
    const { availability, sleeps, runCycle } = harness([101, 102, 103]);
    for (const id of [101, 102, 103]) availability.set(id, fakeSnapshot(id, new Date()));
    await runCycle();
    expect(sleeps).toEqual([250, 250]);
  });
});

describe("createPoller — retention", () => {
  it("prunes snapshots past 7 days and keeps the boundary row", async () => {
    const now = new Date("2026-09-24T19:45:00.000Z");
    const { db, availability, runCycle } = harness([101], () => now);
    // 8 days old — prunable. Exactly 7 days old — on the retention boundary, kept.
    insertSnapshot(db, fakeSnapshot(101, new Date(now.getTime() - 8 * 86_400_000)));
    insertSnapshot(db, fakeSnapshot(101, new Date(now.getTime() - 7 * 86_400_000)));
    availability.set(101, fakeSnapshot(101, now));
    const report = await runCycle();
    expect(report.pruned).toBe(1);
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM snapshots WHERE facility_id = ?")
      .get(101) as { n: number };
    expect(rows.n).toBe(2); // boundary row + this cycle's fresh snapshot
  });
});

describe("createPoller — re-entry guard", () => {
  it("refuses a second cycle while one is running, then releases", async () => {
    const { availability, runCycle } = harness([101]);
    const release = availability.hang();
    availability.set(101, fakeSnapshot(101, new Date()));

    const first = runCycle();
    await expect(runCycle()).rejects.toBeInstanceOf(PollCycleInProgress);
    release();
    await expect(first).resolves.toMatchObject({ succeeded: 1 });

    // The guard is released once the first cycle ends.
    await expect(runCycle()).resolves.toMatchObject({ succeeded: 1 });
  });
});
