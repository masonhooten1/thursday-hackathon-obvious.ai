import { AvailabilityResponseSchema, ParkSchema, type AvailabilityResponse, type Park } from "@campground/shared";
import { z } from "zod";
import { buildFixtureAvailability, FIXTURE_PARKS } from "./fixtures";

/**
 * Where the app gets its data. The API is the real source (spec D4); while
 * the data-layer tasks are still in flight the app runs on fixtures so the
 * map UI can be built and demoed independently. Set EXPO_PUBLIC_API_URL to
 * point at the deployed API and the fixtures step out of the way.
 */
export interface AvailabilityPayload {
  parks: Park[];
  availability: AvailabilityResponse;
}

export interface AvailabilityDataSource {
  readonly name: string;
  fetch(dateISO: string): Promise<AvailabilityPayload>;
}

export function createFixturesSource(now: () => Date = () => new Date()): AvailabilityDataSource {
  return {
    name: "fixtures",
    async fetch() {
      // Parks and snapshots are produced together so the demo is internally
      // consistent (windowStart = tonight, ages relative to now).
      return {
        parks: FIXTURE_PARKS,
        availability: buildFixtureAvailability(now()),
      };
    },
  };
}

/** Minimal structural schema so callers can pass zod schemas without a zod dependency here. */
interface Schema<T> {
  parse(data: unknown): T;
}

export function createApiSource(baseUrl: string): AvailabilityDataSource {
  return {
    name: "api",
    async fetch(dateISO) {
      const [parks, availability] = await Promise.all([
        fetchJson(`${baseUrl}/api/parks`, z.array(ParkSchema)),
        fetchJson(`${baseUrl}/api/availability?date=${encodeURIComponent(dateISO)}`, AvailabilityResponseSchema),
      ]);
      return { parks, availability };
    },
  };
}

async function fetchJson<T>(url: string, schema: Schema<T>): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${response.statusText}`);
  }
  // Contract-checked at the boundary — wire drift fails loudly, not silently.
  return schema.parse(await response.json());
}

/** Picks the data source from the environment: API when configured, fixtures otherwise. */
export function resolveDataSource(env: NodeJS.ProcessEnv = process.env): AvailabilityDataSource {
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  return apiUrl ? createApiSource(apiUrl) : createFixturesSource();
}
