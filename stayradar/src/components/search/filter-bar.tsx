import type { PropertyType } from "@/lib/contracts";

/**
 * Controlled filter bar for radius search (traveler UX task). Presentational
 * only — the explorer owns filter state and search execution; every field
 * maps onto the search contract (dates required by contract, guests,
 * propertyType, radiusMiles).
 */

export interface SearchFilters {
  checkIn: string;
  checkOut: string;
  guests: number;
  propertyType: "any" | PropertyType;
  radiusMiles: number;
}

export const RADIUS_OPTIONS = [1, 5, 10, 25, 50] as const;

const PROPERTY_TYPE_OPTIONS: { value: "any" | PropertyType; label: string }[] = [
  { value: "any", label: "Any type" },
  { value: "cabin", label: "Cabin" },
  { value: "condo", label: "Condo" },
  { value: "house", label: "House" },
];

const inputClass =
  "rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 disabled:opacity-50";

interface FilterBarProps {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  onSearch: () => void;
  /** Contract window violation to show under the dates (blocks search). */
  windowError: string | null;
  busy?: boolean;
}

export function FilterBar({ filters, onChange, onSearch, windowError, busy = false }: FilterBarProps) {
  return (
    <form
      aria-label="Search filters"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Check-in
        <input
          type="date"
          className={inputClass}
          value={filters.checkIn}
          onChange={(event) => onChange({ ...filters, checkIn: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Check-out
        <input
          type="date"
          className={inputClass}
          value={filters.checkOut}
          onChange={(event) => onChange({ ...filters, checkOut: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Guests
        <input
          type="number"
          min={1}
          max={50}
          className={`${inputClass} w-20`}
          value={filters.guests}
          onChange={(event) => onChange({ ...filters, guests: Number(event.target.value) || 1 })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Property type
        <select
          className={inputClass}
          value={filters.propertyType}
          onChange={(event) =>
            onChange({ ...filters, propertyType: event.target.value as SearchFilters["propertyType"] })
          }
        >
          {PROPERTY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Radius
        <select
          className={inputClass}
          value={filters.radiusMiles}
          onChange={(event) => onChange({ ...filters, radiusMiles: Number(event.target.value) })}
        >
          {RADIUS_OPTIONS.map((miles) => (
            <option key={miles} value={miles}>
              {miles} mi
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        onClick={onSearch}
        disabled={busy || windowError !== null}
        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Search
      </button>
      {windowError ? (
        <p role="alert" className="w-full text-xs font-medium text-red-700">
          {windowError}
        </p>
      ) : null}
    </form>
  );
}
