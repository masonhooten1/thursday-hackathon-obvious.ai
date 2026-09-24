/**
 * Month-grid builder for the availability calendar — pure, so the day-cell
 * math is unit-testable without DOM. Input is the API calendar's day list
 * (ISO dates); output is one block per month with weekday alignment.
 */

export interface CalendarCell {
  iso: string;
  dayOfMonth: number;
}

export interface CalendarMonth {
  /** "March 2027" */
  label: string;
  /** "2027-03" */
  iso: string;
  /** Empty leading cells so the first day lands on its weekday column. */
  leadingBlanks: number;
  cells: CalendarCell[];
}

function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

export function buildCalendarMonths(dates: string[]): CalendarMonth[] {
  const unique = [...new Set(dates)].sort();
  const months: CalendarMonth[] = [];
  for (const iso of unique) {
    const monthIso = iso.slice(0, 7);
    const date = new Date(`${iso}T00:00:00Z`);
    let month = months[months.length - 1];
    if (!month || month.iso !== monthIso) {
      const label = date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      month = { label, iso: monthIso, leadingBlanks: 0, cells: [] };
      months.push(month);
    }
    if (month.cells.length === 0) {
      // First rendered day of the month block anchors the grid.
      month.leadingBlanks = weekday(iso);
    }
    month.cells.push({ iso, dayOfMonth: date.getUTCDate() });
  }
  return months;
}
