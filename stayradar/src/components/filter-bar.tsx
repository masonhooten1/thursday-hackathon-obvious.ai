const PROPERTY_TYPE_OPTIONS = ["Any type", "Cabin", "Condo", "House"] as const;

const inputClass =
  "rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900";

/**
 * Static filter bar for the search shell. Presentational only — the form is
 * uncontrolled and the search button is inert until the data-model/API tasks
 * introduce real query state.
 */
export function FilterBar() {
  return (
    <form
      aria-label="Search filters"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Check-in
        <input type="date" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Check-out
        <input type="date" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Guests
        <input
          type="number"
          min={1}
          defaultValue={2}
          className={`${inputClass} w-20`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Property type
        <select className={inputClass}>
          {PROPERTY_TYPE_OPTIONS.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Max price
        <input
          type="number"
          min={0}
          placeholder="$ / night"
          className={`${inputClass} w-28`}
        />
      </label>
      <button
        type="button"
        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
      >
        Search
      </button>
    </form>
  );
}
