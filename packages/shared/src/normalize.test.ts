import { describe, expect, it } from "vitest";
import { normalizeSiteType, normalizeSiteTypes } from "./normalize";

describe("normalizeSiteType", () => {
  // Every value below was observed in live recreation.gov campsite records
  // pulled while curating the seed catalog (2026-09-24).
  it.each([
    ["STANDARD NONELECTRIC", "tent"],
    ["STANDARD ELECTRIC", "tent"],
    ["TENT ONLY NONELECTRIC", "tent"],
    ["WALK TO", "tent"],
    ["HIKE TO", "tent"],
    ["RV NONELECTRIC", "rv"],
    ["RV ELECTRIC", "rv"],
    ["GROUP TENT ONLY AREA NONELECTRIC", "group"],
    ["GROUP STANDARD NONELECTRIC", "group"],
    ["EQUESTRIAN NONELECTRIC", "other"],
  ])("maps %s to %s", (raw, expected) => {
    expect(normalizeSiteType(raw)).toBe(expected);
  });

  it("maps unrecognized types to other per the spec data rules", () => {
    expect(normalizeSiteType("SHELTER NONELECTRIC")).toBe("other");
  });

  it("excludes MANAGEMENT sites — administrative holds are not bookable inventory", () => {
    expect(normalizeSiteType("MANAGEMENT")).toBeNull();
  });

  it("is case- and whitespace-tolerant", () => {
    expect(normalizeSiteType("  rv nonelectric ")).toBe("rv");
    expect(normalizeSiteType("")).toBeNull();
  });
});

describe("normalizeSiteTypes", () => {
  it("dedupes and returns types in contract order", () => {
    expect(normalizeSiteTypes(["RV NONELECTRIC", "TENT ONLY NONELECTRIC", "RV ELECTRIC"])).toEqual([
      "tent",
      "rv",
    ]);
  });

  it("skips non-bookable types rather than emitting empty-member unions", () => {
    expect(normalizeSiteTypes(["MANAGEMENT", "MANAGEMENT"])).toEqual([]);
  });

  it("covers the whole observed vocabulary of a real campground", () => {
    // Mather Campground (232490), pulled 2026-09-24.
    const mather = [
      "STANDARD NONELECTRIC",
      "TENT ONLY NONELECTRIC",
      "RV NONELECTRIC",
      "GROUP TENT ONLY AREA NONELECTRIC",
      "EQUESTRIAN NONELECTRIC",
      "MANAGEMENT",
    ];
    expect(normalizeSiteTypes(mather)).toEqual(["tent", "rv", "group", "other"]);
  });
});
