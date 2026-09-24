/**
 * Date helpers for the availability horizon. All functions are pure — they
 * take the current time as a parameter so tests are deterministic regardless
 * of the machine timezone.
 *
 * Dates are "YYYY-MM-DD" strings interpreted as LOCAL midnights. Calendar-day
 * arithmetic goes through UTC noon so day diffs are exact even across DST.
 */

/** The app horizon: selectable nights starting tonight (spec: 14 nights). */
export const HORIZON_NIGHTS = 14;

/** Local-midnight Date for a YYYY-MM-DD string (avoids the UTC parse trap). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** YYYY-MM-DD of a Date's local calendar day. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Exact whole-day difference a − b for calendar dates. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aUtc = Date.UTC(ay ?? 1970, (am ?? 1) - 1, ad ?? 1);
  const bUtc = Date.UTC(by ?? 1970, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((aUtc - bUtc) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Tonight's ISO date in the user's timezone. */
export function tonightISO(now: Date): string {
  return toISODate(now);
}

/**
 * "This weekend" = the nearest Friday-or-Saturday night. If today IS Friday
 * or Saturday, that's tonight; otherwise the coming Friday.
 */
export function weekendISO(now: Date): string {
  const dow = now.getDay(); // 0 = Sunday … 6 = Saturday
  if (dow === 5 || dow === 6) return toISODate(now);
  const daysUntilFriday = (5 - dow + 7) % 7;
  return addDays(toISODate(now), daysUntilFriday);
}

/** Nights selectable in the picker: tonight .. tonight + 13. */
export function horizonNights(now: Date, horizon: number = HORIZON_NIGHTS): string[] {
  const tonight = tonightISO(now);
  return Array.from({ length: horizon }, (_, i) => addDays(tonight, i));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short label for a night, e.g. "Fri · Sep 26". */
export function formatNightLabel(iso: string): string {
  const date = parseISODate(iso);
  return `${WEEKDAYS[date.getDay()]} · ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Relative label for the selected night: "tonight", "tomorrow", or a date. */
export function formatRelativeNight(iso: string, tonight: string): string {
  const diff = dayDiff(iso, tonight);
  if (diff === 0) return "tonight";
  if (diff === 1) return "tomorrow";
  return formatNightLabel(iso);
}
