import type { IdentifyClient } from "./client";
import { IdentifyError } from "./types";
import type { ConfidenceTier, IdentifyResponse, Match } from "./types";
import { MAX_IMAGE_BYTES, isImageFile } from "../image-limits";

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

function fixtureMatch(
  speciesId: string,
  scientificName: string,
  commonName: string | null,
  distance: number,
  confidence: ConfidenceTier,
  shade: string,
): Match {
  return {
    species_id: speciesId,
    scientific_name: scientificName,
    common_name: commonName,
    distance,
    confidence,
    reference_image: leafThumbnail(shade),
  };
}

const HIGH_CONFIDENCE_FIXTURE: IdentifyResponse = {
  model_version: "bioclip2-vit-b16",
  latency_ms: 1180,
  low_confidence: false,
  matches: [
    fixtureMatch("30056", "Acer macrophyllum", "bigleaf maple", 0.18, "high", "#2f6b3a"),
    fixtureMatch("30058", "Acer circinatum", "vine maple", 0.26, "high", "#3d7a4a"),
    fixtureMatch("30112", "Platanus racemosa", "western sycamore", 0.34, "medium", "#5b8c5a"),
    fixtureMatch("29987", "Acer platanoides", "Norway maple", 0.47, "medium", "#6f9a6b"),
    fixtureMatch("30061", "Acer glabrum", "Rocky Mountain maple", 0.58, "low", "#84a87e"),
  ],
};

const LOW_CONFIDENCE_FIXTURE: IdentifyResponse = {
  model_version: "bioclip2-vit-b16",
  latency_ms: 1240,
  low_confidence: true,
  matches: [
    fixtureMatch("30056", "Acer macrophyllum", "bigleaf maple", 0.83, "low", "#2f6b3a"),
    fixtureMatch("30058", "Acer circinatum", "vine maple", 0.9, "low", "#3d7a4a"),
    fixtureMatch("30112", "Platanus racemosa", "western sycamore", 0.94, "low", "#5b8c5a"),
    fixtureMatch("29987", "Acer platanoides", "Norway maple", 0.96, "low", "#6f9a6b"),
    fixtureMatch("30061", "Acer glabrum", "Rocky Mountain maple", 0.97, "low", "#84a87e"),
  ],
};

/**
 * Fixture selection is deterministic on the file so demos and tests can reach
 * every state: files named "unknown…" identify as low-confidence.
 */
function fixtureFor(image: File): IdentifyResponse {
  return image.name.toLowerCase().includes("unknown")
    ? LOW_CONFIDENCE_FIXTURE
    : HIGH_CONFIDENCE_FIXTURE;
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
