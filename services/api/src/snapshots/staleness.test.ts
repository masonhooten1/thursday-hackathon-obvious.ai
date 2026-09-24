import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, isSnapshotStale, responseIsStale } from "./staleness";

const NOW = new Date("2026-09-24T19:50:00.000Z");

const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("STALE_AFTER_MS", () => {
  it("is twice the poll interval from the shared contract (30 minutes)", () => {
    expect(STALE_AFTER_MS).toBe(30 * 60_000);
  });
});

describe("isSnapshotStale", () => {
  it("is fresh at exactly one poll interval (15 minutes)", () => {
    expect(isSnapshotStale(minutesAgo(15), NOW)).toBe(false);
  });

  it("flips stale at exactly twice the poll interval (30 minutes)", () => {
    expect(isSnapshotStale(minutesAgo(30), NOW)).toBe(true);
  });

  it("is not stale a millisecond before the threshold", () => {
    expect(isSnapshotStale(new Date(NOW.getTime() - 30 * 60_000 + 1).toISOString(), NOW)).toBe(false);
  });

  it("stays stale past the threshold", () => {
    expect(isSnapshotStale(minutesAgo(60), NOW)).toBe(true);
  });
});

describe("responseIsStale", () => {
  it("is false with no snapshots — the poller has not run yet", () => {
    expect(responseIsStale([null, null], NOW)).toBe(false);
    expect(responseIsStale([], NOW)).toBe(false);
  });

  it("is false while any snapshot is fresh, even if others are stale", () => {
    expect(responseIsStale([minutesAgo(45), minutesAgo(4)], NOW)).toBe(false);
  });

  it("is true once every snapshot is past the threshold — the banner state", () => {
    expect(responseIsStale([minutesAgo(31), minutesAgo(90)], NOW)).toBe(true);
  });

  it("ignores null entries among present snapshots", () => {
    expect(responseIsStale([null, minutesAgo(31)], NOW)).toBe(true);
  });
});
