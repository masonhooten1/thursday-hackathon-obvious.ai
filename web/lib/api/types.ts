/**
 * Contract mirrors of the identify API's Pydantic models (app/api/identify.py,
 * blueprint art_t8aXEd4u). Keep in sync when the API evolves.
 */

export type ConfidenceTier = "high" | "medium" | "low";

export interface Match {
  /** Pl@ntNet-300K class id. */
  species_id: string;
  /** e.g. "Acer macrophyllum". */
  scientific_name: string;
  /** e.g. "bigleaf maple"; null when the reference set has no common name. */
  common_name: string | null;
  /** Cosine distance to the nearest reference photo; lower = closer. */
  distance: number;
  confidence: ConfidenceTier;
  /** Thumbnail of the nearest reference photo (absolute URL or API-relative path). */
  reference_image: string;
}

export interface IdentifyResponse {
  /** Top-5, nearest-first. */
  matches: Match[];
  /** e.g. "bioclip2-vit-b16". */
  model_version: string;
  latency_ms: number;
  /** True when the best distance exceeds the calibrated low-confidence threshold. */
  low_confidence: boolean;
}

/**
 * Thrown by identify clients for API-level failures. `status` mirrors the
 * identify API's HTTP semantics: 415 not a decodable image, 413 larger than
 * 10 MB, 502 an unparseable response from a live upstream.
 */
export class IdentifyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "IdentifyError";
    this.status = status;
  }
}
