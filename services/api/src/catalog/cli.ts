/**
 * Seeder CLI — `npm run seed --workspace=@campground/api [-- --db=<path>]`.
 *
 * Loads services/api/seed/*.json, validates against the shared contract,
 * replaces the catalog tables, and health-checks every facility id against
 * the live reservation site. Dead ids are printed as flags — the spec wants
 * visibility, not an aborted seed — so the process exits 0 with flags, and
 * exits non-zero only on hard failures (bad files, integrity, db errors).
 */
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { openDb } from "../db";
import { runSeeder } from "./seed";

const seedDir = fileURLToPath(new URL("../../seed/", import.meta.url));
const defaultDbPath = fileURLToPath(new URL("../../data/campground.db", import.meta.url));

const { values } = parseArgs({
  options: {
    db: { type: "string", default: defaultDbPath },
    "skip-health-check": { type: "boolean", default: false },
  },
});

try {
  const db = openDb(values.db);
  const report = await runSeeder(db, seedDir, { healthCheck: !values["skip-health-check"] });
  db.close();

  console.log(
    `[campground-seed] catalog replaced: ${report.campgrounds} campgrounds across ${report.parks} parks (seed generatedAt ${report.generatedAt})`,
  );
  if (report.health) {
    console.log(
      `[campground-seed] health check: ${report.health.alive}/${report.health.checked} alive`,
    );
    for (const facilityId of report.health.dead) {
      console.warn(`[campground-seed] DEAD facility id flagged: ${facilityId}`);
    }
    for (const facilityId of report.health.unverified) {
      console.warn(`[campground-seed] UNVERIFIED facility id (blocked/throttled/offline): ${facilityId}`);
    }
    if (report.health.unverified.length > 0) {
      console.warn("[campground-seed] hint: re-run the seed to retry unverified ids");
    }
  }
} catch (error) {
  console.error("[campground-seed] seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
