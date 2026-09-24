import Link from "next/link";
import type { PropertySearchResult } from "@/lib/contracts";

/**
 * One search result as a card: title → detail page, distance from the
 * search anchor, lowest nightly price inside the window, and an honest
 * availability badge. Clicking selects it (map sync); the link navigates.
 */

interface ResultCardProps {
  result: PropertySearchResult;
  selected: boolean;
  onSelect: (id: string) => void;
  anchorLabel: string;
}

export function ResultCard({ result, selected, onSelect, anchorLabel }: ResultCardProps) {
  return (
    <article
      data-result-id={result.id}
      onClick={() => onSelect(result.id)}
      className={`cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition ${
        selected ? "border-teal-700 ring-2 ring-teal-600" : "border-stone-200"
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium uppercase tracking-wide text-stone-600">
          {result.propertyType}
        </span>
        <span className="text-stone-500">{result.market.replace(/-/g, " ")}</span>
      </div>
      <h3 className="font-semibold text-stone-900">
        <Link
          href={`/property/${result.id}`}
          onClick={(event) => event.stopPropagation()}
          className="hover:underline"
        >
          {result.title}
        </Link>
      </h3>
      <p className="mt-1 text-sm text-stone-500">
        {result.distanceMiles.toFixed(1)} mi from {anchorLabel}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-900">
          from ${Math.round(result.minNightly)}
          <span className="font-normal text-stone-500"> / night</span>
        </p>
        {result.availableForWindow ? (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">
            Open for your dates
          </span>
        ) : (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
            Dates taken
          </span>
        )}
      </div>
    </article>
  );
}
