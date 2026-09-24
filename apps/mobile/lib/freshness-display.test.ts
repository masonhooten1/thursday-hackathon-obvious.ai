import { describe, expect, it } from "vitest";
import { formatFreshnessLine, isMutedFreshness } from "./freshness-display";

const NOW = new Date("2026-09-24T20:00:00Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("formatFreshnessLine", () => {
  it("says checking… when nothing has been captured", () => {
    expect(formatFreshnessLine(null, NOW)).toBe("checking…");
  });

  it("labels stale data explicitly", () => {
    expect(formatFreshnessLine(minutesAgo(90), NOW)).toBe("data may be old");
  });

  it("says just now under a minute", () => {
    expect(formatFreshnessLine(minutesAgo(0.5), NOW)).toBe("updated just now");
  });

  it("counts whole minutes", () => {
    expect(formatFreshnessLine(minutesAgo(4), NOW)).toBe("updated 4 min ago");
  });
});

describe("isMutedFreshness", () => {
  it("mutes the aging window", () => {
    expect(isMutedFreshness("aging")).toBe(true);
    expect(isMutedFreshness("fresh")).toBe(false);
    expect(isMutedFreshness("stale")).toBe(false);
    expect(isMutedFreshness("never")).toBe(false);
  });
});
