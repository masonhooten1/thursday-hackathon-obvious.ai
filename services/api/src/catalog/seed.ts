/**
 * Loads the versioned seed files (services/api/seed/*.json), validates them
 * against the shared contract, replaces the catalog tables, and — by default —
 * health-checks every facility id against the live reservation site.
 *
 * A dead facility id is flagged in the report, never a seed failure: ids decay
 * over time and the spec wants visible flags, not aborted seeds.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CampgroundSchema, ParkSchema, type Campground, type Park } from "@campground/shared";
import { z } from "zod";
import type { Db } from "../db";
import { createCatalogSchema, insertCatalog } from "./schema";
import { healthCheckCampgrounds, type HealthCheckDeps, type HealthCheckReport } from "./health";

export const ParksSeedSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  parks: z.array(ParkSchema),
});
export type ParksSeed = z.infer<typeof ParksSeedSchema>;

export const CampgroundsSeedSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  campgrounds: z.array(CampgroundSchema),
});
export type CampgroundsSeed = z.infer<typeof CampgroundsSeedSchema>;

export function parseParksSeed(json: string): ParksSeed {
  return ParksSeedSchema.parse(JSON.parse(json));
}

export function parseCampgroundsSeed(json: string): CampgroundsSeed {
  return CampgroundsSeedSchema.parse(JSON.parse(json));
}

export type SeedIssueKind = "unknown-park" | "duplicate-park" | "duplicate-facility";
export interface SeedIssue {
  kind: SeedIssueKind;
  message: string;
}

/**
 * Pure referential-integrity check: every campground's parkId must resolve,
 * park ids and facility ids must be unique. BookingUrl shape and count
 * thresholds are asserted against the committed files by the test suite.
 */
export function findSeedIssues(parks: Park[], campgrounds: Campground[]): SeedIssue[] {
  const issues: SeedIssue[] = [];
  const seenParkIds = new Set<string>();
  for (const park of parks) {
    if (seenParkIds.has(park.id)) {
      issues.push({ kind: "duplicate-park", message: `duplicate park id: ${park.id}` });
    }
    seenParkIds.add(park.id);
  }

  const seenFacilityIds = new Set<number>();
  for (const campground of campgrounds) {
    if (seenFacilityIds.has(campground.facilityId)) {
      issues.push({
        kind: "duplicate-facility",
        message: `duplicate facility id: ${campground.facilityId}`,
      });
    }
    seenFacilityIds.add(campground.facilityId);
    if (!seenParkIds.has(campground.parkId)) {
      issues.push({
        kind: "unknown-park",
        message: `campground ${campground.facilityId} references unknown parkId: ${campground.parkId}`,
      });
    }
  }
  return issues;
}

export interface SeederOptions {
  /** Health checks hit the live site; tests skip or inject them. */
  healthCheck?: boolean;
  healthDeps?: Partial<HealthCheckDeps>;
}

export interface SeederReport {
  parks: number;
  campgrounds: number;
  generatedAt: string;
  health: HealthCheckReport | null;
}

export async function runSeeder(
  db: Db,
  seedDir: string,
  options: SeederOptions = {},
): Promise<SeederReport> {
  const parksSeed = parseParksSeed(readFileSync(join(seedDir, "parks.json"), "utf8"));
  const campgroundsSeed = parseCampgroundsSeed(
    readFileSync(join(seedDir, "campgrounds.json"), "utf8"),
  );

  const issues = findSeedIssues(parksSeed.parks, campgroundsSeed.campgrounds);
  if (issues.length > 0) {
    throw new Error(
      `seed files failed referential integrity:\n${issues.map((issue) => `- [${issue.kind}] ${issue.message}`).join("\n")}`,
    );
  }

  createCatalogSchema(db);
  insertCatalog(db, parksSeed.parks, campgroundsSeed.campgrounds);

  const shouldHealthCheck = options.healthCheck ?? true;
  const health = shouldHealthCheck
    ? await healthCheckCampgrounds(campgroundsSeed.campgrounds, options.healthDeps)
    : null;

  return {
    parks: parksSeed.parks.length,
    campgrounds: campgroundsSeed.campgrounds.length,
    generatedAt: campgroundsSeed.generatedAt,
    health,
  };
}
