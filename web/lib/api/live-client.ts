import type { IdentifyClient } from "./client";
import { IdentifyError } from "./types";
import type { IdentifyResponse, Match } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reference thumbnails may arrive as API-relative paths; make them loadable. */
function resolveThumbnail(referenceImage: string, baseUrl: string): string {
  if (/^(https?:|data:)/i.test(referenceImage)) return referenceImage;
  return `${baseUrl}${referenceImage.startsWith("/") ? "" : "/"}${referenceImage}`;
}

function parseMatch(value: unknown, baseUrl: string): Match {
  if (!isRecord(value)) {
    throw new IdentifyError(502, "identify API sent a match that is not an object");
  }
  const { species_id, scientific_name, common_name, distance, confidence, reference_image } =
    value;
  if (typeof species_id !== "string" || typeof scientific_name !== "string") {
    throw new IdentifyError(502, "identify API match is missing required string fields");
  }
  if (typeof distance !== "number" || !Number.isFinite(distance)) {
    throw new IdentifyError(502, "identify API match distance is not a number");
  }
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    throw new IdentifyError(502, "identify API match has an unknown confidence tier");
  }
  if (typeof reference_image !== "string") {
    throw new IdentifyError(502, "identify API match is missing a reference image path");
  }
  return {
    species_id,
    scientific_name,
    common_name: typeof common_name === "string" ? common_name : null,
    distance,
    confidence,
    reference_image: resolveThumbnail(reference_image, baseUrl),
  };
}

/** Runtime validation of the live API's JSON against the contract in types.ts. */
export function parseIdentifyResponse(payload: unknown, baseUrl: string): IdentifyResponse {
  if (!isRecord(payload)) {
    throw new IdentifyError(502, "identify API response is not an object");
  }
  const { matches, model_version, latency_ms, low_confidence } = payload;
  if (!Array.isArray(matches)) {
    throw new IdentifyError(502, "identify API response has no matches array");
  }
  if (
    typeof model_version !== "string" ||
    typeof latency_ms !== "number" ||
    typeof low_confidence !== "boolean"
  ) {
    throw new IdentifyError(502, "identify API response is missing required fields");
  }
  return {
    matches: matches.map((match) => parseMatch(match, baseUrl)),
    model_version,
    latency_ms,
    low_confidence,
  };
}

export class LiveIdentifyClient implements IdentifyClient {
  constructor(private readonly baseUrl: string) {}

  async identify(image: File, signal?: AbortSignal): Promise<IdentifyResponse> {
    const body = new FormData();
    body.append("image", image);
    const response = await fetch(`${this.baseUrl}/api/identify`, { method: "POST", body, signal });
    if (!response.ok) {
      throw new IdentifyError(response.status, `identify API returned ${response.status}`);
    }
    return parseIdentifyResponse(await response.json(), this.baseUrl);
  }
}
