import { describe, expect, it } from "vitest";
import { eventNights, icalDateToIso, parseIcs } from "@/lib/services/ingestion/ical-connector";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//StayRadar//EN",
  "BEGIN:VTIMEZONE",
  "TZID:America/Los_Angeles",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "TZOFFSETFROM:-0800",
  "TZOFFSETTO:-0700",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:abc123",
  "DTSTART;VALUE=DATE:20261010",
  "DTEND;VALUE=DATE:20261014",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:def456",
  "DTSTART;VALUE=DATE:20261020",
  "DTEND;VALUE=DATE:20261021",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("parses VEVENTs into [start, end) night ranges", () => {
    const events = parseIcs(FEED);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ start: "2026-10-10", end: "2026-10-14" });
    expect(events[1]).toMatchObject({ start: "2026-10-20", end: "2026-10-21" });
  });

  it("treats DTEND as exclusive (4 nights from the 10th through the 13th)", () => {
    const [event] = parseIcs(FEED);
    expect(eventNights(event as never)).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
    ]);
  });

  it("defaults a missing DTEND to exactly one night", () => {
    const events = parseIcs(
      ["BEGIN:VEVENT", "UID:x", "DTSTART;VALUE=DATE:20261101", "END:VEVENT"].join("\r\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: "2026-11-01", end: "2026-11-02" });
  });

  it("unfolds continuation lines", () => {
    const events = parseIcs(
      [
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20261201",
        "SUMMARY:Blocked because the hot",
        "  tub is being replaced",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(events[0]?.summary).toBe("Blocked because the hot tub is being replaced");
  });

  it("reduces datetime values to their UTC date", () => {
    const events = parseIcs(
      ["BEGIN:VEVENT", "DTSTART:20261010T150000Z", "DTEND:20261012T110000Z", "END:VEVENT"].join(
        "\r\n",
      ),
    );
    expect(events[0]).toMatchObject({ start: "2026-10-10", end: "2026-10-12" });
  });

  it("ignores events without a parsable DTSTART", () => {
    const events = parseIcs(["BEGIN:VEVENT", "UID:broken", "END:VEVENT"].join("\r\n"));
    expect(events).toHaveLength(0);
  });

  it("returns no events for an empty calendar", () => {
    expect(parseIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toEqual([]);
  });
});

describe("icalDateToIso", () => {
  it("parses DATE and DATETIME forms and rejects junk", () => {
    expect(icalDateToIso("20261010")).toBe("2026-10-10");
    expect(icalDateToIso("20261010T090000Z")).toBe("2026-10-10");
    expect(icalDateToIso("not-a-date")).toBeNull();
  });
});
