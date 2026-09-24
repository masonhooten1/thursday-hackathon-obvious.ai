import { describe, expect, it } from "vitest";
import { getFreshnessTier } from "./freshness";

const NOW = new Date("2026-09-24T20:00:00Z");

describe("getFreshnessTier", () => {
  it("treats missing timestamps as never", () => {
    expect(getFreshnessTier(null, NOW)).toBe("never");
  });

  it("treats unparseable timestamps as never", () => {
    expect(getFreshnessTier("not-a-timestamp", NOW)).toBe("never");
  });

  it("is fresh within one poll interval", () => {
    expect(getFreshnessTier("2026-09-24T19:55:00Z", NOW)).toBe("fresh");
    expect(getFreshnessTier("2026-09-24T19:45:00Z", NOW)).toBe("fresh");
  });

  it("is aging between one and four intervals", () => {
    expect(getFreshnessTier("2026-09-24T19:44:59Z", NOW)).toBe("aging");
    expect(getFreshnessTier("2026-09-24T19:00:00Z", NOW)).toBe("aging");
  });

  it("is stale beyond four intervals", () => {
    expect(getFreshnessTier("2026-09-24T18:59:59Z", NOW)).toBe("stale");
  });
});
