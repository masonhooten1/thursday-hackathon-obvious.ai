import { describe, expect, it } from "vitest";
import {
  addDays,
  dayDiff,
  formatNightLabel,
  formatRelativeNight,
  horizonNights,
  parseISODate,
  toISODate,
  tonightISO,
  weekendISO,
} from "./dates";

// Constructed with local components so the tests are timezone-independent.
const WEDNESDAY = new Date(2026, 8, 23, 20, 0); // Wed Sep 23 2026
const FRIDAY = new Date(2026, 8, 25, 20, 0); // Fri Sep 25 2026
const SATURDAY = new Date(2026, 8, 26, 20, 0); // Sat Sep 26 2026
const SUNDAY = new Date(2026, 8, 27, 20, 0); // Sun Sep 27 2026

describe("toISODate / parseISODate", () => {
  it("round-trips a local date", () => {
    expect(toISODate(new Date(2026, 8, 24))).toBe("2026-09-24");
    expect(toISODate(parseISODate("2026-09-24"))).toBe("2026-09-24");
  });

  it("pads month and day", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("dayDiff", () => {
  it("counts whole days exactly", () => {
    expect(dayDiff("2026-09-25", "2026-09-24")).toBe(1);
    expect(dayDiff("2026-09-24", "2026-09-24")).toBe(0);
    expect(dayDiff("2026-09-24", "2026-09-30")).toBe(-6);
  });

  it("crosses month boundaries", () => {
    expect(dayDiff("2026-10-01", "2026-09-30")).toBe(1);
  });
});

describe("addDays", () => {
  it("rolls over month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-09-24", 13)).toBe("2026-10-07");
  });
});

describe("tonightISO", () => {
  it("is the local calendar day of now", () => {
    expect(tonightISO(WEDNESDAY)).toBe("2026-09-23");
  });
});

describe("weekendISO", () => {
  it("is the coming Friday midweek", () => {
    expect(weekendISO(WEDNESDAY)).toBe("2026-09-25");
  });

  it("is tonight on Friday and Saturday", () => {
    expect(weekendISO(FRIDAY)).toBe("2026-09-25");
    expect(weekendISO(SATURDAY)).toBe("2026-09-26");
  });

  it("skips to next Friday after the weekend ends", () => {
    expect(weekendISO(SUNDAY)).toBe("2026-10-02");
  });
});

describe("horizonNights", () => {
  it("lists 14 nights starting tonight", () => {
    const nights = horizonNights(WEDNESDAY);
    expect(nights).toHaveLength(14);
    expect(nights[0]).toBe("2026-09-23");
    expect(nights[13]).toBe("2026-10-06");
  });
});

describe("labels", () => {
  it("formats a night", () => {
    expect(formatNightLabel("2026-09-25")).toBe("Fri · Sep 25");
  });

  it("uses tonight / tomorrow / date", () => {
    expect(formatRelativeNight("2026-09-23", "2026-09-23")).toBe("tonight");
    expect(formatRelativeNight("2026-09-24", "2026-09-23")).toBe("tomorrow");
    expect(formatRelativeNight("2026-09-25", "2026-09-23")).toBe("Fri · Sep 25");
  });
});
