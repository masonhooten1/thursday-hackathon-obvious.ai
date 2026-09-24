import { describe, expect, it } from "vitest";
import {
  buildAvailabilityCalendar,
  mulberry32,
  seedFromString,
  toIsoDate,
} from "@/lib/services/ingestion/availability-calendar";

const REFERENCE = new Date("2026-10-01T00:00:00Z");

describe("buildAvailabilityCalendar", () => {
  it("is deterministic for a fixed seed and reference date", () => {
    const a = buildAvailabilityCalendar({ days: 90, baseNightly: 200, seed: 42, today: REFERENCE });
    const b = buildAvailabilityCalendar({ days: 90, baseNightly: 200, seed: 42, today: REFERENCE });
    expect(a).toEqual(b);
  });

  it("varies across seeds", () => {
    const a = buildAvailabilityCalendar({ days: 90, baseNightly: 200, seed: 1, today: REFERENCE });
    const b = buildAvailabilityCalendar({ days: 90, baseNightly: 200, seed: 2, today: REFERENCE });
    expect(a).not.toEqual(b);
  });

  it("produces one night per day starting at the reference date", () => {
    const nights = buildAvailabilityCalendar({ days: 90, baseNightly: 200, seed: 7, today: REFERENCE });
    expect(nights).toHaveLength(90);
    expect(nights[0]?.date).toBe("2026-10-01");
    expect(nights[89]?.date).toBe(toIsoDate(new Date(REFERENCE.getTime() + 89 * 86_400_000)));
  });

  it("only emits valid statuses and prices for every night", () => {
    const nights = buildAvailabilityCalendar({ days: 90, baseNightly: 200, seed: 9, today: REFERENCE });
    for (const night of nights) {
      expect(["available", "booked", "blocked"]).toContain(night.status);
      if (night.status === "blocked") {
        expect(night.nightlyPrice).toBeNull();
      } else {
        expect(night.nightlyPrice).not.toBeNull();
        expect(night.nightlyPrice as number).toBeGreaterThanOrEqual(200);
      }
    }
  });

  it("books weekend nights (Fri/Sat) far more often than weekdays", () => {
    const nights = buildAvailabilityCalendar({ days: 90, baseNightly: 200, seed: 11, today: REFERENCE });
    const weekend = nights.filter((n) => {
      const dow = new Date(`${n.date}T00:00:00Z`).getUTCDay();
      return dow === 5 || dow === 6;
    });
    const weekday = nights.filter((n) => {
      const dow = new Date(`${n.date}T00:00:00Z`).getUTCDay();
      return dow !== 5 && dow !== 6;
    });
    const share = (rows: typeof nights) =>
      rows.filter((n) => n.status === "booked").length / rows.length;
    expect(share(weekend)).toBeGreaterThan(share(weekday) + 0.2);
  });

  it("with occupancy 0 leaves almost everything available", () => {
    const nights = buildAvailabilityCalendar({
      days: 90,
      baseNightly: 200,
      seed: 13,
      today: REFERENCE,
      occupancy: 0,
    });
    const booked = nights.filter((n) => n.status === "booked").length;
    expect(booked).toBe(0);
    expect(nights.filter((n) => n.status === "available").length).toBeGreaterThan(80);
  });
});

describe("seedFromString", () => {
  it("is stable and input-sensitive", () => {
    expect(seedFromString("alpine-cabin")).toBe(seedFromString("alpine-cabin"));
    expect(seedFromString("alpine-cabin")).not.toBe(seedFromString("alpine-condo"));
  });
});

describe("mulberry32", () => {
  it("produces a reproducible sequence", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });
});
