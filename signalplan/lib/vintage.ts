/**
 * Data-vintage labeling (brief §Interface): an operator must be able to tell
 * fresh scans, cached evidence, incomplete scans, and synthetic demonstrations
 * apart immediately. Pure functions — no I/O — so the labels are unit-tested
 * and rendered identically on every surface (board, evidence cards, workspace
 * header).
 */

export type EvidenceVintage = "fresh" | "cached" | "incomplete";

/** Where a record's data came from. Fixture data is never presented as live. */
export type DataProvenance = "live" | "fixture";

/** Evidence older than this is labeled cached even without an explicit limitation. */
export const FRESH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Limitation markers that make a single evidence record incomplete. Markers
 * match case-insensitively as substrings so collector wording can evolve
 * ("blocked", "render required", "consent gated", …) without a label change.
 */
const INCOMPLETE_MARKERS = [
  "blocked",
  "render required",
  "consent gated",
  "consent-gated",
  "fetch timed out",
  "partial capture",
];

const CACHED_MARKERS = ["cached"];

function matchesAny(limitations: string[], markers: string[]): boolean {
  const lowered = limitations.map((l) => l.toLowerCase());
  return markers.some((m) => lowered.some((l) => l.includes(m)));
}

/**
 * Vintage of one evidence record. Incomplete wins over cached: a record that
 * is both stale and partially captured must never read as merely old.
 */
export function evidenceVintage(
  evidence: Pick<import("@/lib/contracts").Evidence, "limitations" | "capturedAt">,
  now: Date,
): EvidenceVintage {
  if (matchesAny(evidence.limitations, INCOMPLETE_MARKERS)) return "incomplete";
  if (matchesAny(evidence.limitations, CACHED_MARKERS)) return "cached";
  const captured = new Date(evidence.capturedAt).getTime();
  if (Number.isFinite(captured) && now.getTime() - captured > FRESH_MAX_AGE_MS) {
    return "cached";
  }
  return "fresh";
}

/**
 * Vintage of a whole scan: the worst record wins, because an operator reading
 * the scan must plan for the weakest evidence in it, not the average.
 */
export function scanVintage(
  evidence: Pick<import("@/lib/contracts").Evidence, "limitations" | "capturedAt">[],
  now: Date,
): EvidenceVintage | null {
  if (evidence.length === 0) return null;
  const vintages = evidence.map((e) => evidenceVintage(e, now));
  if (vintages.includes("incomplete")) return "incomplete";
  if (vintages.includes("cached")) return "cached";
  return "fresh";
}

/** Operator-facing text for the fixture banner and per-record chips. */
export function provenanceLabel(provenance: DataProvenance): string {
  return provenance === "fixture" ? "Fixture preview — synthetic demonstration data" : "Live scan data";
}
