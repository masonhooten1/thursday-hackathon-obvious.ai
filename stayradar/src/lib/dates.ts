/**
 * Date helpers for the traveler UI. Every wire date is ISO YYYY-MM-DD
 * (contracts/shared.ts isoDateSchema) — these helpers keep the client on
 * that format and give the required-by-contract date window a sensible
 * default instead of an empty field.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/**
 * The default booking window: two to three weekends out (14 → 17 days).
 * The search contract requires both dates, so the UI always has a window
 * to send; the seeded 90-day calendars cover it.
 */
export function defaultSearchWindow(now: Date = new Date()): { checkIn: string; checkOut: string } {
  const today = toIsoDate(now);
  return { checkIn: addDays(today, 14), checkOut: addDays(today, 17) };
}

/**
 * The one window rule the contract enforces client-side: checkout strictly
 * after checkin. Returns the contract's message or null when the pair is
 * usable. Empty strings (empty inputs) are not an error here — the search
 * simply needs both before it can run.
 */
export function searchWindowError(checkIn: string, checkOut: string): string | null {
  if (!ISO_DATE_PATTERN.test(checkIn) || !ISO_DATE_PATTERN.test(checkOut)) return null;
  if (checkOut > checkIn) return null;
  return "checkOut must be after checkIn";
}

/** "2027-03-15" → "Mar 15" for compact calendar and list labels. */
export function formatDateLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const label = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return label;
}
