import { serve } from "@hono/node-server";
import { PoliteClient } from "./adapters/politeness";
import { RecreationGovAvailability } from "./adapters/recreation-gov";
import type { AvailabilitySource } from "./adapters/types";
import { createApp } from "./app";
import { openDb } from "./db";
import { createPoller } from "./poller";
import { createScheduler } from "./scheduler";
import { createSnapshotsSchema } from "./snapshots/store";

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.CAMPGROUND_DB_PATH ?? "campground.db";
const ADMIN_POLL_SECRET = process.env.ADMIN_POLL_SECRET;
// Spec default: every 15 minutes. Override with a cron expression, e.g.
// POLL_CRON="*/5 * * * *" npm start.
const CRON_SCHEDULE = process.env.POLL_CRON ?? "*/15 * * * *";
const USER_AGENT = process.env.POLL_USER_AGENT ?? "campground-tonight/0.1 (hackathon MVP; contact: hello@masonhooten.com)";

const db = openDb(DB_PATH);
createSnapshotsSchema(db);

const client = new PoliteClient({ userAgent: USER_AGENT });
const availability: AvailabilitySource = new RecreationGovAvailability(client);

// The poller consumes only the availability adapter: the poll cycle writes
// availability snapshots, while RIDB-derived metadata lives in the catalog
// (loaded by the seeder). The app serves cached snapshots from those tables.
const runPollCycle = createPoller({ db, availability });
const app = createApp({ db, pollNow: runPollCycle, adminPollSecret: ADMIN_POLL_SECRET });

const scheduler = createScheduler(CRON_SCHEDULE, () => {
  runPollCycle().catch((error: unknown) => {
    console.error("[campground-api] poll cycle failed:", error);
  });
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(
    `[campground-api] listening on http://localhost:${info.port} (db: ${DB_PATH}, poll cadence: ${CRON_SCHEDULE})`,
  );
});

scheduler.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
}
