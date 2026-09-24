import type { AvailabilityCalendar as AvailabilityCalendarData } from "@/lib/contracts";
import { buildCalendarMonths } from "@/lib/calendar";
import { formatDateLabel } from "@/lib/dates";

/**
 * 90-day availability calendar rendered from the detail API's calendar
 * contract (traveler UX task). Month grids come from the pure
 * buildCalendarMonths helper; status drives cell styling: available
 * nights show the price, booked nights are struck through, blocked
 * nights (owner blocks) render gray.
 */

interface AvailabilityCalendarProps {
  calendar: AvailabilityCalendarData;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

const CELL_STATUS_CLASS: Record<string, string> = {
  available: "bg-teal-50 text-teal-900",
  booked: "bg-red-50 text-red-700 line-through",
  blocked: "bg-stone-100 text-stone-400",
};

export function AvailabilityCalendar({ calendar }: AvailabilityCalendarProps) {
  const statusByDate = new Map(calendar.days.map((day) => [day.date, day]));
  const months = buildCalendarMonths(calendar.days.map((day) => day.date));
  const openNights = calendar.days.filter((day) => day.status === "available").length;

  return (
    <section
      aria-label="Availability calendar"
      data-testid="availability-calendar"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900">
          {calendar.days.length}-day outlook — {openNights} of {calendar.days.length} nights open
        </h2>
        <ul className="flex items-center gap-3 text-xs text-stone-600">
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-teal-100" /> Available
          </li>
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-red-100" /> Booked
          </li>
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-stone-200" /> Blocked
          </li>
        </ul>
      </div>

      {calendar.checkIn && calendar.checkOut ? (
        <p className="text-xs font-medium text-teal-800">
          Showing availability for your dates ({calendar.checkIn} → {calendar.checkOut}).
        </p>
      ) : null}

      <div className="flex flex-wrap gap-6">
        {months.map((month) => (
          <div key={month.iso} className="min-w-56 flex-1">
            <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">
              {month.label}
            </p>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-stone-400">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: month.leadingBlanks }, (_, blank) => (
                <span key={`blank-${blank}`} aria-hidden />
              ))}
              {month.cells.map((cell) => {
                const day = statusByDate.get(cell.iso);
                const statusClass = day ? (CELL_STATUS_CLASS[day.status] ?? "") : "";
                return (
                  <div
                    key={cell.iso}
                    data-date={cell.iso}
                    data-status={day?.status}
                    aria-label={`${formatDateLabel(cell.iso)}: ${day?.status ?? "unavailable"}`}
                    title={`${formatDateLabel(cell.iso)}: ${day?.status ?? "unavailable"}`}
                    className={`flex min-h-10 flex-col items-center justify-center rounded-md px-0.5 py-1 text-xs ${statusClass}`}
                  >
                    <span className="font-medium">{cell.dayOfMonth}</span>
                    {day?.status === "available" ? (
                      <span className="text-[9px] text-teal-700">
                        {day.nightlyPrice ? `$${Math.round(day.nightlyPrice)}` : "—"}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
