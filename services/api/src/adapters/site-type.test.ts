import { describe, expect, it } from "vitest";
import { normalizeSiteType } from "./site-type";

describe("normalizeSiteType", () => {
  it("maps group before tent — group-tent labels contain both words", () => {
    expect(normalizeSiteType("GROUP TENT ONLY AREA NONELECTRIC")).toBe("group");
  });

  it("maps tent and standard labels to tent", () => {
    expect(normalizeSiteType("TENT ONLY NONELECTRIC")).toBe("tent");
    expect(normalizeSiteType("STANDARD NONELECTRIC")).toBe("tent");
    expect(normalizeSiteType("STANDARD ELECTRIC")).toBe("tent");
  });

  it("maps rv labels to rv", () => {
    expect(normalizeSiteType("RV NONELECTRIC")).toBe("rv");
    expect(normalizeSiteType("RV TENT BACK-IN")).toBe("rv");
  });

  it("maps cabin labels to cabin", () => {
    expect(normalizeSiteType("CABIN NONELECTRIC")).toBe("cabin");
    expect(normalizeSiteType("STANDARD CABIN")).toBe("cabin");
  });

  it("maps every unrecognized label to other, never throws", () => {
    expect(normalizeSiteType("EQUESTRIAN NONELECTRIC")).toBe("other");
    expect(normalizeSiteType("YURT")).toBe("other");
    expect(normalizeSiteType("LODGING: HOTEL BLOCK")).toBe("other");
    expect(normalizeSiteType("")).toBe("other");
    expect(normalizeSiteType("someone invented a new type")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(normalizeSiteType("rv nonelectric")).toBe("rv");
    expect(normalizeSiteType("Group Tent Only")).toBe("group");
  });

  it("does not mistake RV inside another word", () => {
    expect(normalizeSiteType("SERVICE ROAD SITE")).toBe("other");
  });
});
