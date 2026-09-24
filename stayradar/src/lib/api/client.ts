import { z } from "zod";
import {
  ErrorResponseSchema,
  InquiryResponseSchema,
  PropertyDetailResponseSchema,
  PropertySearchResponseSchema,
  type ApiErrorCode,
  type InquiryResponse,
  type PropertyDetailResponse,
  type PropertySearchQuery,
  type PropertySearchResponse,
  type ValidationIssue,
} from "@/lib/contracts";
import type { InquiryRequest } from "@/lib/contracts/lead";

/**
 * Client API layer (traveler UX task) — the browser's only door to the
 * StayRadar API. Every response is parsed through the zod contracts from
 * PR #27, so contract drift fails loudly here instead of rendering
 * garbage; every non-2xx parses through the shared error envelope and
 * surfaces as ApiClientError with machine-readable code + field details.
 */

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly details: ValidationIssue[];
  readonly status: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: ValidationIssue[]; status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiClientError";
    this.code = code;
    this.details = options.details ?? [];
    this.status = options.status ?? 0;
  }

  /** First message per field path — the shape inline form errors render. */
  fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const issue of this.details) {
      if (!(issue.path in map)) map[issue.path] = issue.message;
    }
    return map;
  }
}

function searchQueryString(query: PropertySearchQuery): string {
  const params = new URLSearchParams();
  params.set("latitude", String(query.latitude));
  params.set("longitude", String(query.longitude));
  params.set("radiusMiles", String(query.radiusMiles));
  params.set("checkIn", query.checkIn);
  params.set("checkOut", query.checkOut);
  params.set("guests", String(query.guests));
  if (query.propertyType) params.set("propertyType", query.propertyType);
  if (query.sessionHash) params.set("sessionHash", query.sessionHash);
  // utm keys arrive pre-prefixed (utm_source, …) — the search route
  // forwards any utm_* param as the origin-market signal.
  for (const [key, value] of Object.entries(query.utm ?? {})) params.set(key, value);
  return params.toString();
}

async function requestParsed<T>(
  url: string,
  schema: z.ZodType<T>,
  context: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch (cause) {
    throw new ApiClientError("internal_error", `Could not reach the StayRadar API (${context}).`, {
      cause,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ApiClientError("internal_error", `Malformed response from the StayRadar API (${context}).`, {
      status: response.status,
      cause,
    });
  }

  if (!response.ok) {
    const envelope = ErrorResponseSchema.safeParse(body);
    if (envelope.success) {
      throw new ApiClientError(envelope.data.error.code, envelope.data.error.message, {
        details: envelope.data.error.details ?? [],
        status: response.status,
      });
    }
    throw new ApiClientError("internal_error", `Unexpected error from the StayRadar API (${context}).`, {
      status: response.status,
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      "internal_error",
      `Unexpected response shape from the StayRadar API (${context}).`,
      { status: response.status, cause: parsed.error },
    );
  }
  return parsed.data;
}

export interface StayRadarClient {
  search(query: PropertySearchQuery): Promise<PropertySearchResponse>;
  propertyDetail(id: string, window?: { checkIn: string; checkOut: string }): Promise<PropertyDetailResponse>;
  submitInquiry(input: InquiryRequest): Promise<InquiryResponse>;
}

/**
 * Build a client against `baseUrl` (empty = same-origin, the browser case;
 * server components pass an absolute URL from `serverApiBaseUrl`).
 */
export function createStayRadarClient(baseUrl = ""): StayRadarClient {
  const root = baseUrl.replace(/\/$/, "");
  return {
    search: (query) =>
      requestParsed(
        `${root}/api/search?${searchQueryString(query)}`,
        PropertySearchResponseSchema,
        "radius search",
      ),
    propertyDetail: (id, window) =>
      requestParsed(
        `${root}/api/properties/${encodeURIComponent(id)}${
          window ? `?checkIn=${encodeURIComponent(window.checkIn)}&checkOut=${encodeURIComponent(window.checkOut)}` : ""
        }`,
        PropertyDetailResponseSchema,
        "property detail",
      ),
    submitInquiry: (input) =>
      requestParsed(`${root}/api/inquiries`, InquiryResponseSchema, "inquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  };
}
