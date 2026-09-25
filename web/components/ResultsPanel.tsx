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

function LeafGlyph() {
  return (
    <svg viewBox="0 0 112 112" width="100%" height="100%" aria-hidden="true">
      <rect width="112" height="112" rx="12" fill="#e8ede6" />
      <path
        d="M56 20c-14 12-22 24-22 38 0 16 10 26 22 34 12-8 22-18 22-34 0-14-8-26-22-38z"
        fill="#b9c7b4"
      />
      <path d="M56 28v58" stroke="#8fa68c" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Reference photo that degrades to a placeholder tile when the file is
 * missing (the index can reference thumbnails a partial archive never
 * shipped) instead of showing a broken image.
 */
export function ReferenceImage({
  src,
  alt,
  missingAlt,
  className,
}: {
  src: string;
  alt: string;
  missingAlt: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    const decorative = missingAlt === "";
    return (
      <span
        className={`${className} thumbnail-placeholder`}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : missingAlt}
        aria-hidden={decorative || undefined}
      >
        <LeafGlyph />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
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
                <ReferenceImage
                  key={match.reference_image}
                  src={match.reference_image}
                  alt=""
                  missingAlt=""
                  className="thumbnail"
                />
              </button>
              {expanded && (
                <ReferenceImage
                  key={`expanded-${match.reference_image}`}
                  src={match.reference_image}
                  alt={`Reference photo of ${match.scientific_name}`}
                  missingAlt={`Reference photo unavailable for ${match.scientific_name}`}
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
