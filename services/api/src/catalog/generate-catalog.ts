/**
 * Catalog generator — rebuilds services/api/seed/*.json from the live
 * Recreation.gov search/detail/campsites endpoints. Run manually, never in CI:
 *
 *   npm run generate-catalog --workspace=@campground/api
 *
 * Politeness: strictly sequential requests with spacing, an identifying
 * User-Agent, and exponential backoff on 429. A disk cache
 * (data/generate-cache/) makes runs resumable and re-runs cheap; delete it to
 * force fresh pulls.
 *
 * This tool produced the committed seed on 2026-09-24. Curation rules it
 * encodes (see seed/README.md): overnight campground entities only, across
 * six parks keyed by Recreation.gov recarea ids.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSiteTypes } from "@campground/shared";
import { z } from "zod";
import { USER_AGENT } from "./health";

/** The six marquee parks, keyed by Recreation.gov recarea id (verified live 2026-09-24). */
const PARKS = [
  { recareaId: 2991, id: "yosemite", name: "Yosemite National Park" },
  { recareaId: 2988, id: "yellowstone", name: "Yellowstone National Park" },
  { recareaId: 2733, id: "grand-canyon", name: "Grand Canyon National Park" },
  { recareaId: 2994, id: "zion", name: "Zion National Park" },
  { recareaId: 2739, id: "great-smoky-mountains", name: "Great Smoky Mountains National Park" },
  { recareaId: 2725, id: "glacier", name: "Glacier National Park" },
] as const;

/**
 * Facility ids excluded from the catalog, discovered during the 2026-09-24
 * curation pull:
 *  - GSM picnic pavilions plus Appalachian Clubhouse / Spence Cabin: day-use venues
 *  - Colter Bay Marina End Ties: bookable boat slips, not campsites
 *  - Trailer Village RV Park (10111236): dead id — page and campsites endpoint 404
 */
const EXCLUDED_FACILITY_IDS = new Set([
  233_299, 234_712, 232_480, 232_439, 232_435, 232_475, 232_477, 232_476, 102_462_74, 101_112_36,
]);

/**
 * Deactivated campgrounds the search index hides but the reservation system
 * still knows (is_deactivated: true, pages 200). They stay in the catalog —
 * seasonal closures are availability state, not catalog absence.
 */
const MANUAL_FACILITY_IDS = [259_306, 259_307]; // Norris, Pebble Creek (Yellowstone)

const SEARCH_RESULT_SCHEMA = z.object({
  entity_id: z.string(),
  entity_type: z.string(),
  name: z.string(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  state_code: z.string().optional(),
  campsite_type_of_use: z.array(z.string()).optional(),
});
const SEARCH_RESPONSE_SCHEMA = z.object({ results: z.array(SEARCH_RESULT_SCHEMA) });

const DETAIL_SCHEMA = z.object({
  campground: z.object({
    facility_id: z.string(),
    facility_name: z.string(),
    facility_latitude: z.number(),
    facility_longitude: z.number(),
    parent_asset_id: z.string(),
    is_deactivated: z.boolean().nullable().optional(),
  }),
});

const CAMPSITES_SCHEMA = z.object({
  campsites: z.array(z.object({ campsite_type: z.string().nullable() })),
});

const ACRONYMS = new Set(["RV", "AZ", "UT", "WY", "MT", "CA", "TN", "NC", "US", "NPS"]);

function capitalizeToken(token: string): string {
  const firstLetter = [...token].findIndex((ch) => /[a-zA-Z]/.test(ch));
  if (firstLetter === -1) return token;
  const letters = token.replace(/[^a-zA-Z]/g, "");
  if (ACRONYMS.has(letters)) return token;
  return (
    token.slice(0, firstLetter) +
    token.charAt(firstLetter).toUpperCase() +
    token.slice(firstLetter + 1).toLowerCase()
  );
}

/**
 * Presentation name for the catalog: title-cases upstream ALL-CAPS names and
 * drops parenthetical suffixes that merely repeat the park name ("Mammoth
 * Campground (Yellowstone)" → "Mammoth Campground"), keeping compact state
 * tags like "(AZ)".
 */
export function displayName(name: string, parkName: string): string {
  const cleaned = name.replace(/\s*\(([^()]*)\)\s*$/, (match, tag: string) => {
    const lowerTag = tag.toLowerCase();
    const lowerPark = parkName.toLowerCase();
    return lowerPark.includes(lowerTag) || lowerTag.includes(lowerPark) ? "" : match;
  });
  if (cleaned !== cleaned.toUpperCase()) return cleaned;
  return cleaned.split(" ").map(capitalizeToken).join(" ");
}

/** Day-use-only entities are bookable venues, not tonight-sleepable campsites. */
function isDayUseOnly(uses: string[] | undefined): boolean {
  if (!uses || uses.length === 0) return false;
  return uses.includes("Day") && !uses.includes("Overnight");
}

export class CatalogGenerator {
  private readonly cacheDir: string;
  private readonly spacingMs: number;
  private readonly backoffBaseMs: number;
  private readonly maxAttempts: number;

  constructor(options: { cacheDir?: string; spacingMs?: number; backoffBaseMs?: number; maxAttempts?: number } = {}) {
    this.cacheDir = options.cacheDir ?? "data/generate-cache";
    this.spacingMs = options.spacingMs ?? 3_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 20_000;
    this.maxAttempts = options.maxAttempts ?? 4;
  }

  private cachedPath(url: string): string {
    return join(this.cacheDir, encodeURIComponent(url) + ".json");
  }

  /**
   * GET JSON with politeness (spacing after each live fetch, backoff on 429)
   * and a resumable disk cache. Returns null on 404 — the caller decides
   * whether that means skip or empty.
   */
  async getJson(url: string): Promise<unknown> {
    const cached = this.cachedPath(url);
    if (existsSync(cached)) {
      return JSON.parse(readFileSync(cached, "utf8"));
    }
    mkdirSync(this.cacheDir, { recursive: true });
    let delay = this.backoffBaseMs;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (response.status === 404) {
        return null;
      }
      if (response.ok) {
        const body = await response.json();
        writeFileSync(cached, JSON.stringify(body));
        await new Promise((resolve) => setTimeout(resolve, this.spacingMs));
        return body;
      }
      if (response.status !== 429 || attempt === this.maxAttempts) {
        throw new Error(`${url} failed: HTTP ${response.status}`);
      }
      console.warn(`  429 on ${url} — backing off ${delay / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
    throw new Error(`unreachable: ${url}`);
  }

  async writeSeedFiles(outputDir: string): Promise<void> {
    const generatedAt = new Date().toISOString();
    const parkRows = [];
    for (const park of PARKS) {
      const body = SEARCH_RESPONSE_SCHEMA.parse(
        await this.getJson(
          `https://www.recreation.gov/api/search?q=${encodeURIComponent(`"${park.name}"`)}&fq=${encodeURIComponent("entity_type:recarea")}&size=10`,
        ),
      );
      const recarea = body.results.find(
        (r) => r.entity_type === "recarea" && r.entity_id === String(park.recareaId),
      );
      if (!recarea) {
        throw new Error(`recarea ${park.recareaId} (${park.name}) not found in search index`);
      }
      parkRows.push({
        id: park.id,
        name: park.name,
        state: recarea.state_code ?? "",
        lat: Number(recarea.latitude ?? 0),
        lng: Number(recarea.longitude ?? 0),
      });
    }
    parkRows.sort((a, b) => a.id.localeCompare(b.id));

    const recareaById = new Map(PARKS.map((p) => [String(p.recareaId), p]));
    const facilityIds = new Set<number>();
    for (const park of PARKS) {
      const body = SEARCH_RESPONSE_SCHEMA.parse(
        await this.getJson(
          `https://www.recreation.gov/api/search?fq=${encodeURIComponent(`parent_asset_id:${park.recareaId}`)}&fq=${encodeURIComponent("entity_type:campground")}&size=100`,
        ),
      );
      for (const result of body.results) {
        if (result.entity_type !== "campground") continue;
        const facilityId = Number(result.entity_id);
        if (EXCLUDED_FACILITY_IDS.has(facilityId)) continue;
        if (isDayUseOnly(result.campsite_type_of_use)) {
          console.warn(
            `  day-use entity skipped: ${facilityId} ${result.name} [${result.campsite_type_of_use?.join(", ")}]`,
          );
          continue;
        }
        facilityIds.add(facilityId);
      }
    }
    for (const facilityId of MANUAL_FACILITY_IDS) {
      facilityIds.add(facilityId);
    }

    const campgroundRows = [];
    for (const facilityId of [...facilityIds].sort((a, b) => a - b)) {
      const detailBody = await this.getJson(
        `https://www.recreation.gov/api/camps/campgrounds/${facilityId}`,
      );
      if (detailBody === null) {
        console.warn(`  DEAD facility id — skipped, add to EXCLUDED_FACILITY_IDS: ${facilityId}`);
        continue;
      }
      const detail = DETAIL_SCHEMA.parse(detailBody).campground;
      const park = recareaById.get(detail.parent_asset_id);
      if (!park) {
        throw new Error(
          `facility ${facilityId} moved out of the curated parks (parent_asset_id ${detail.parent_asset_id})`,
        );
      }

      const sitesBody = await this.getJson(
        `https://www.recreation.gov/api/camps/campgrounds/${facilityId}/campsites?size=1000`,
      );
      const sites = sitesBody === null ? [] : CAMPSITES_SCHEMA.parse(sitesBody).campsites;
      const siteTypes = normalizeSiteTypes(
        sites.map((site) => site.campsite_type ?? "").filter(Boolean),
      );

      campgroundRows.push({
        facilityId,
        parkId: park.id,
        name: displayName(detail.facility_name, park.name),
        lat: Number(detail.facility_latitude.toFixed(6)),
        lng: Number(detail.facility_longitude.toFixed(6)),
        bookingUrl: `https://www.recreation.gov/camping/campgrounds/${facilityId}`,
        siteTypes,
      });
      console.log(`  ${facilityId} ${detail.facility_name}: ${siteTypes.join("/") || "no sites"}`);
    }
    campgroundRows.sort((a, b) => a.parkId.localeCompare(b.parkId) || a.facilityId - b.facilityId);

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(outputDir, "parks.json"),
      JSON.stringify({ version: 1, generatedAt, parks: parkRows }, null, 2) + "\n",
    );
    writeFileSync(
      join(outputDir, "campgrounds.json"),
      JSON.stringify({ version: 1, generatedAt, campgrounds: campgroundRows }, null, 2) + "\n",
    );
    console.log(
      `[generate-catalog] wrote ${parkRows.length} parks and ${campgroundRows.length} campgrounds to ${outputDir}`,
    );
  }
}

// CLI edge — the class stays importable for tests.
if (process.argv[1] && process.argv[1].endsWith("generate-catalog.ts")) {
  const generator = new CatalogGenerator();
  const seedDir = fileURLToPath(new URL("../../seed/", import.meta.url));
  generator
    .writeSeedFiles(seedDir)
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("[generate-catalog] failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
