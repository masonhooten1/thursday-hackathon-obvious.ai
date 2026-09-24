/**
 * Minimal iCalendar parser for availability feeds — the industry's common
 * denominator (Airbnb, Vrbo, and PMS exports all speak this dialect).
 *
 * Scope, per spec ("VEVENT → booked dates"):
 * - unfolds continuation lines (RFC 5545 §3.1)
 * - VEVENT blocks only; VTIMEZONE/VTODO/VFREEBUSY are skipped
 * - DTSTART/DTEND as VALUE=DATE (all-day, the availability-calendar norm) or
 *   as datetime — both reduce to YYYY-MM-DD in UTC
 * - DTEND is EXCLUSIVE (RFC 5545 §3.6.1): an event spanning 2026-10-10 →
 *   2026-10-14 books the nights of the 10th–13th; a missing DTEND on an
 *   all-day event defaults to start+1 day, i.e. exactly one night
 * - no recurrence expansion (RRULE) — availability feeds emit explicit days
 */

import { and, eq } from "drizzle-orm";
import type { StayRadarDb } from "@/db";
import { availability, properties } from "@/db/schema";
import type { AvailabilityNightInput } from "./connector";

export interface ICalEvent {
  /** Night the event starts (inclusive), YYYY-MM-DD. */
  start: string;
  /** Night the event ends (EXCLUSIVE), YYYY-MM-DD. */
  end: string;
  summary?: string;
}

interface ICalLine {
  name: string;
  params: string[];
  value: string;
}

function unfoldLines(text: string): string[] {
  const folded = text.split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of folded) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseLine(line: string): ICalLine | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const headParts = head.split(";");
  return { name: headParts[0].toUpperCase(), params: headParts.slice(1), value };
}

/** Reduce an iCal DATE or DATETIME value to its YYYY-MM-DD night (UTC). */
export function icalDateToIso(value: string): string | null {
  const compact = value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(compact);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/** Parse all VEVENTs from an iCalendar feed body. Pure — unit-tested. */
export function parseIcs(text: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  let current: { start?: string; end?: string; summary?: string } | null = null;

  const flush = () => {
    if (!current) return;
    // RFC: DTEND default for an all-day event is start+1 — exactly one night.
    const start = current.start;
    const end = current.end ?? (start ? nextDay(start) : undefined);
    if (start && end) {
      events.push({ start, end, summary: current.summary });
    }
    current = null;
  };

  for (const line of unfoldLines(text)) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      current = {};
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      flush();
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.name === "DTSTART") {
      const iso = icalDateToIso(parsed.value);
      if (iso) current.start = iso;
    } else if (parsed.name === "DTEND") {
      const iso = icalDateToIso(parsed.value);
      if (iso) current.end = iso;
    } else if (parsed.name === "SUMMARY") {
      current.summary = parsed.value;
    }
  }

  return events;
}

/** Nights covered by an event: [start, end) — DTEND is exclusive. Pure. */
export function eventNights(event: ICalEvent): string[] {
  const nights: string[] = [];
  let cursor = event.start;
  while (cursor < event.end) {
    nights.push(cursor);
    cursor = nextDay(cursor);
  }
  return nights;
}

export interface ICalSyncInput {
  /** Property source + externalId to sync availability FOR — iCal never creates properties. */
  source: string;
  externalId: string;
  icsText: string;
}

export interface ICalSyncResult {
  propertyId: string;
  nightsSynced: number;
}

/**
 * ICalConnector — availability-only sync for EXISTING inventory. Feed events
 * mark booked nights; repeated syncs are idempotent upserts (double-sync
 * leaves row counts unchanged). iCal carries no rates, so synced nights get
 * nightlyPrice null (an existing price is overwritten — rates belong to the
 * property source, not the calendar).
 */
export class ICalConnector {
  constructor(private readonly db: StayRadarDb) {}

  async syncAvailability(input: ICalSyncInput): Promise<ICalSyncResult> {
    const found = await this.db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.source, input.source),
          eq(properties.externalId, input.externalId),
        ),
      )
      .limit(1);
    const propertyId = found[0]?.id;
    if (!propertyId) {
      throw new Error(
        `ical sync: no property for (source=${input.source}, externalId=${input.externalId}) — sync availability only for existing inventory`,
      );
    }

    const nights = parseIcs(input.icsText).flatMap(eventNights);
    if (nights.length === 0) return { propertyId, nightsSynced: 0 };

    const rows: AvailabilityNightInput[] = nights.map((date) => ({
      date,
      status: "booked",
      nightlyPrice: null,
    }));
    await this.upsertBookedNights(propertyId, rows);
    return { propertyId, nightsSynced: rows.length };
  }

  /** Upsert in chunks to stay under Postgres parameter limits. */
  private async upsertBookedNights(
    propertyId: string,
    nights: AvailabilityNightInput[],
  ): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < nights.length; i += CHUNK) {
      await this.db
        .insert(availability)
        .values(
          nights.slice(i, i + CHUNK).map((night) => ({
            propertyId,
            date: night.date,
            status: night.status,
            nightlyPrice: night.nightlyPrice,
          })),
        )
        .onConflictDoUpdate({
          target: [availability.propertyId, availability.date],
          set: { status: "booked", nightlyPrice: null },
        });
    }
  }
}
