import type { IdentifyClient } from "./client";
import { IdentifyError } from "./types";
import type { ConfidenceTier, IdentifyResponse, Match } from "./types";
import { MAX_IMAGE_BYTES, isImageFile } from "../image-limits";
import demoSpecies from "./demo-species.json";

/** Species metadata seeded from the reference index (scripts/demo/seed_species.py). */
interface DemoSpecies {
  species_id: string;
  scientific_name: string;
  common_name: string | null;
}

const SEEDED = demoSpecies as { model_version: string; species: DemoSpecies[] };

/** Simulated server latency so the identifying state is observable in demos. */
const MOCK_LATENCY_MS = 1200;

/** Reference photos live behind the API; the mock ships inline SVG stand-ins. */
function leafThumbnail(shade: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112">' +
    `<rect width="112" height="112" rx="12" fill="${shade}"/>` +
    '<path d="M56 20c-14 12-22 24-22 38 0 16 10 26 22 34 12-8 22-18 22-34 0-14-8-26-22-38z" fill="rgba(255,255,255,0.85)"/>' +
    `<path d="M56 28v58" stroke="${shade}" stroke-width="3" stroke-linecap="round"/>` +
    "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SHADES = ["#2f6b3a", "#3d7a4a", "#5b8c5a", "#6f9a6b", "#84a87e"];

/** Match shape of the real top-5: distances descending, tiers degrading. */
const HIGH_DISTANCES = [0.18, 0.26, 0.34, 0.47, 0.58];
const HIGH_TIERS: ConfidenceTier[] = ["high", "high", "medium", "medium", "low"];
const LOW_DISTANCES = [0.83, 0.9, 0.94, 0.96, 0.97];

function fixtureResponse(latencyMs: number, lowConfidence: boolean): IdentifyResponse {
  const distances = lowConfidence ? LOW_DISTANCES : HIGH_DISTANCES;
  const tiers: ConfidenceTier[] = lowConfidence
    ? ["low", "low", "low", "low", "low"]
    : HIGH_TIERS;
  return {
    model_version: SEEDED.model_version,
    latency_ms: latencyMs,
    low_confidence: lowConfidence,
    matches: SEEDED.species.slice(0, 5).map((entry, index): Match => {
      const shade = SHADES[index % SHADES.length]!;
      return {
        species_id: entry.species_id,
        scientific_name: entry.scientific_name,
        common_name: entry.common_name,
        distance: distances[index]!,
        confidence: tiers[index]!,
        reference_image: leafThumbnail(shade),
      };
    }),
  };
}

/**
 * Fixture selection is deterministic on the file so demos and tests can reach
 * every state: files named "unknown…" identify as low-confidence.
 */
function fixtureFor(image: File): IdentifyResponse {
  const lowConfidence = image.name.toLowerCase().includes("unknown");
  return fixtureResponse(lowConfidence ? 1240 : 1180, lowConfidence);
}

function abortError(): DOMException {
  return new DOMException("The identification was cancelled", "AbortError");
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort);
  });
}

export class MockIdentifyClient implements IdentifyClient {
  constructor(private readonly latencyMs: number = MOCK_LATENCY_MS) {}

  async identify(image: File, signal?: AbortSignal): Promise<IdentifyResponse> {
    // Mirror the API's 415/413 behavior so the UI error paths are exercisable
    // without a server.
    if (!isImageFile(image)) throw new IdentifyError(415, "not a decodable image");
    if (image.size > MAX_IMAGE_BYTES) throw new IdentifyError(413, "image larger than 10 MB");
    await abortableDelay(this.latencyMs, signal);
    return fixtureFor(image);
  }
}
