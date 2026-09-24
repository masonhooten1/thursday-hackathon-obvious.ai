import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createScheduler } from "./scheduler";

const PORT = Number(process.env.PORT ?? 8787);

// The poll cycle lands with the D4 poller; the timer seam is armed from the
// start so cadence and shutdown behavior are exercised early.
const scheduler = createScheduler("*/15 * * * *", () => {
  console.log("[campground-api] poll tick — snapshot cycle lands in D4");
});

const server = serve({ fetch: createApp().fetch, port: PORT }, (info) => {
  console.log(`[campground-api] listening on http://localhost:${info.port}`);
});

scheduler.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
}
