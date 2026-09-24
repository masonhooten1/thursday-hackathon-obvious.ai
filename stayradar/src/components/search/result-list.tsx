"use client";

import { useEffect } from "react";
import type { PropertySearchResult } from "@/lib/contracts";
import { ResultCard } from "./result-card";

/**
 * The list half of the map+list pair. Selecting a card scrolls it into
 * view; the map highlights the same pin (shared selectedId in the
 * explorer).
 */

interface ResultListProps {
  results: PropertySearchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  anchorLabel: string;
}

export function ResultList({ results, selectedId, onSelect, anchorLabel }: ResultListProps) {
  useEffect(() => {
    if (!selectedId) return;
    const el = document.querySelector(`[data-result-id="${selectedId}"]`);
    el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <ul role="list" aria-label="Search results" className="grid gap-3">
      {results.map((result) => (
        <li key={result.id}>
          <ResultCard
            result={result}
            selected={result.id === selectedId}
            onSelect={onSelect}
            anchorLabel={anchorLabel}
          />
        </li>
      ))}
    </ul>
  );
}
