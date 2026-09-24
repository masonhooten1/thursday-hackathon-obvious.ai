"use client";

import { useState } from "react";
import type { IdentifyResponse } from "@/lib/api/types";
import StatusBanner from "./StatusBanner";

interface ResultsPanelProps {
  response: IdentifyResponse;
  lowConfidence: boolean;
  onTryAgain: () => void;
  onIdentifyAnother: () => void;
}

/** Cosine distance (lower = closer) to a 0–100 percent for confidence-bar length. */
export function closenessPercent(distance: number): number {
  return Math.round(Math.min(Math.max(1 - distance, 0), 1) * 100);
}

export default function ResultsPanel({
  response,
  lowConfidence,
  onTryAgain,
  onIdentifyAnother,
}: ResultsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleReference = (speciesId: string) =>
    setExpandedId((current) => (current === speciesId ? null : speciesId));

  return (
    <section className="results-state" aria-live="polite">
      {lowConfidence && (
        <StatusBanner variant="warning" title="Not confident">
          This plant may be outside the reference set. A closer photo of a leaf or flower helps.
        </StatusBanner>
      )}
      <ol className="match-list" aria-label="Species matches, nearest first">
        {response.matches.map((match, index) => {
          const percent = closenessPercent(match.distance);
          const expanded = expandedId === match.species_id;
          return (
            <li
              key={match.species_id}
              className={`match-row${expanded ? " match-row-expanded" : ""}`}
            >
              <span className="match-rank" aria-hidden="true">
                {index + 1}
              </span>
              <div className="match-main">
                <span className="match-name">{match.scientific_name}</span>
                <span className="match-sub">
                  {lowConfidence
                    ? "possible match"
                    : (match.common_name ?? "common name not on file")}
                </span>
                <div
                  className="confidence"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label={`${match.scientific_name} confidence ${percent}%`}
                >
                  <div className="confidence-fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
              <button
                type="button"
                className="thumbnail-button"
                aria-expanded={expanded}
                aria-label={`Reference photo for ${match.scientific_name}`}
                onClick={() => toggleReference(match.species_id)}
              >
                <img
                  src={match.reference_image}
                  alt=""
                  width={56}
                  height={56}
                  className="thumbnail"
                />
              </button>
              {expanded && (
                <img
                  src={match.reference_image}
                  alt={`Reference photo of ${match.scientific_name}`}
                  className="reference-large"
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="results-meta">
        {response.model_version} · {response.latency_ms} ms
      </p>
      {lowConfidence ? (
        <button type="button" className="button-primary" onClick={onTryAgain}>
          Try again
        </button>
      ) : (
        <button type="button" className="button-primary" onClick={onIdentifyAnother}>
          Identify another photo
        </button>
      )}
    </section>
  );
}
