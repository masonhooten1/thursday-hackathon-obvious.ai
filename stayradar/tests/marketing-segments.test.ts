import { describe, expect, it } from "vitest";
import {
  BROWSER_WINDOW_DAYS,
  DATE_SEARCHER_WINDOW_DAYS,
  DAY_MS,
  deriveSegments,
  type SegmentEventInput,
  type SegmentLeadInput,
} from "@/lib/services/marketing/segmentation";

/**
 * Pure cohort-rule tests (no Postgres). DB wiring is covered by the
 * integration suite.
 */

const NOW = new Date("2026-09-24T12:00:00.000Z");

let hashSeq = 0;
function ev(overrides: Partial<SegmentEventInput> = {}): SegmentEventInput {
  hashSeq += 1;
  return {
    sessionHash: `hash-${String(hashSeq).padStart(3, "0")}`,
    market: "lake-tahoe",
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    utm: null,
    createdAt: new Date(NOW.getTime() - 2 * DAY_MS),
    ...overrides,
  };
}

function lead(market: string | null, sessionHash: string): SegmentLeadInput {
  return { market, sessionHash };
}

describe("deriveSegments", () => {
  it("puts recent date-searchers in the 7d cohort and nowhere else", () => {
    const cohorts = deriveSegments([ev()], [], NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].market).toBe("lake-tahoe");
    expect(cohorts[0].dateSearchers7d).toHaveLength(1);
    expect(cohorts[0].browsers30d).toHaveLength(0);
    expect(cohorts[0].leadSubmitters).toHaveLength(0);
  });

  it("keeps a searcher exactly on the 7-day boundary (inclusive window)", () => {
    const boundary = new Date(NOW.getTime() - DATE_SEARCHER_WINDOW_DAYS * DAY_MS);
    const cohorts = deriveSegments([ev({ createdAt: boundary })], [], NOW);
    expect(cohorts[0].dateSearchers7d).toHaveLength(1);
  });

  it("drops date-searchers one tick past the 7-day window", () => {
    const stale = new Date(NOW.getTime() - DATE_SEARCHER_WINDOW_DAYS * DAY_MS - 1);
    const cohorts = deriveSegments([ev({ createdAt: stale })], [], NOW);
    // Past intent AND still committed to dates, so deliberately in neither cohort.
    expect(cohorts[0].dateSearchers7d).toHaveLength(0);
    expect(cohorts[0].browsers30d).toHaveLength(0);
  });

  it("buckets no-date events in the 30d browser cohort, boundary inclusive", () => {
    const boundary = new Date(NOW.getTime() - BROWSER_WINDOW_DAYS * DAY_MS);
    const justOutside = new Date(boundary.getTime() - 1);
    const cohorts = deriveSegments(
      [
        ev({ checkIn: null, checkOut: null, createdAt: boundary, sessionHash: "hash-edge" }),
        ev({ checkIn: null, checkOut: null, createdAt: justOutside, sessionHash: "hash-out" }),
      ],
      [],
      NOW,
    );
    expect(cohorts[0].browsers30d).toEqual(["hash-edge"]);
    expect(cohorts[0].dateSearchers7d).toHaveLength(0);
  });

  it("deduplicates a session that searched the market many times", () => {
    const cohorts = deriveSegments(
      [ev({ sessionHash: "hash-same" }), ev({ sessionHash: "hash-same", checkIn: "2026-11-01", checkOut: "2026-11-05" })],
      [],
      NOW,
    );
    expect(cohorts[0].dateSearchers7d).toEqual(["hash-same"]);
  });

  it("ignores events without a dominant market", () => {
    const cohorts = deriveSegments([ev({ market: null })], [], NOW);
    expect(cohorts).toHaveLength(0);
  });

  it("separates cohorts per market and sorts markets deterministically", () => {
    const cohorts = deriveSegments(
      [ev({ market: "cape-cod", sessionHash: "hash-cc" }), ev({ market: "austin", sessionHash: "hash-au" })],
      [],
      NOW,
    );
    expect(cohorts.map((c) => c.market)).toEqual(["austin", "cape-cod"]);
  });

  it("lists lead submitters as a per-market exclusion, all-time", () => {
    const cohorts = deriveSegments(
      [ev()],
      [lead("lake-tahoe", "hash-led"), lead("austin", "hash-other"), lead(null, "hash-orphan")],
      NOW,
    );
    const tahoe = cohorts.find((c) => c.market === "lake-tahoe");
    expect(tahoe?.leadSubmitters).toEqual(["hash-led"]);
  });

  it("derives origin variants from utm_source, falling back to utm_campaign", () => {
    const events = [
      ev({ sessionHash: "h1", utm: { utm_source: "Dallas" } }),
      ev({ sessionHash: "h2", utm: { utm_source: "dallas" } }),
      ev({ sessionHash: "h3", utm: { utm_campaign: "austin-tx" } }),
      ev({ sessionHash: "h4", utm: { utm_source: "austin" } }),
    ];
    const cohorts = deriveSegments(events, [], NOW);
    // dallas (2 events, case-folded) leads; the two single-count signals tie
    // alphabetically. The h3 event has no utm_source, so its utm_campaign is
    // the origin signal instead.
    expect(cohorts[0].originVariants).toEqual(["dallas", "austin", "austin-tx"]);
  });

  it("caps origin variants at three", () => {
    const events = ["denver", "el-paso", "fresno", "gilbert"].map((city, i) =>
      ev({ sessionHash: `h${i}`, utm: { utm_source: city } }),
    );
    const cohorts = deriveSegments(events, [], NOW);
    expect(cohorts[0].originVariants).toHaveLength(3);
  });

  it("returns an empty array when there is no recent activity", () => {
    expect(deriveSegments([], [], NOW)).toEqual([]);
  });
});
