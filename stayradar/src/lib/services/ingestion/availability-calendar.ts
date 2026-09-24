import type { AvailabilityStatus } from "@/db/schema";
import type { AvailabilityNightInput } from "./connector";

/**
 * Deterministic 90-day availability calendars for seeded inventory (spec:
 * SeedConnector with "realistic booked/blocked patterns"). Deterministic via
 * a seeded PRNG — the same slug and reference date always produce the same
 * calendar, so tests and repeated seeds are stable.
 */

export interface CalendarOptions {
  /** Calendar length in nights. */
  days: number;
  /** Property's base nightly rate in USD. */
  baseNightly: number;
  /** Stable seed — derive per property with seedFromString(slug). */
  seed: number;
  /** Reference date; defaults to today (UTC). Tests pass a fixed date. */
  today?: Date;
  /** Share of nights booked before weekend adjustment. Default 0.55. */
  occupancy?: number;
}

/** Stable numeric seed from a string (property slug). Pure. */
export function seedFromString(input: string): number {
  let hash = 7;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** mulberry32 — small, fast, deterministic PRNG. Pure. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Build the calendar. Patterns, per night:
 * - Friday/Saturday nights book at a much higher rate (leisure demand).
 * - ~4% of unbooked nights become maintenance blocks (price null).
 * - Nightly price = base with a weekend premium plus small noise, rounded
 *   to the nearest $5; booked nights keep the rate they were booked at.
 */
export function buildAvailabilityCalendar(options: CalendarOptions): AvailabilityNightInput[] {
  const { days, baseNightly, seed, today = new Date(), occupancy = 0.55 } = options;
  const rand = mulberry32(seed);
  const nights: AvailabilityNightInput[] = [];

  for (let i = 0; i < days; i += 1) {
    const night = addDays(today, i);
    const dayOfWeek = night.getUTCDay();
    const isWeekendNight = dayOfWeek === 5 || dayOfWeek === 6; // Fri, Sat
    const bookedProbability = Math.min(
      1,
      occupancy + (isWeekendNight ? 0.3 : -0.15) * occupancy,
    );
    const isBooked = rand() < bookedProbability;
    const isBlocked = !isBooked && rand() < 0.04;
    const status: AvailabilityStatus = isBooked ? "booked" : isBlocked ? "blocked" : "available";

    const premium = (isWeekendNight ? 0.3 : 0) + rand() * 0.1;
    const nightlyPrice = isBlocked ? null : Math.round((baseNightly * (1 + premium)) / 5) * 5;

    nights.push({ date: toIsoDate(night), status, nightlyPrice });
  }

  return nights;
}
