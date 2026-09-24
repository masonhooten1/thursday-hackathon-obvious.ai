import { Hono } from "hono";
import { AvailabilityResponseSchema } from "@campground/shared";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Builds the API app. Tests drive it with app.request() — no port binding. */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Scaffold shape of the spec's availability endpoint: empty but
  // contract-valid. Real snapshots arrive with the poller (spec D4).
  app.get("/api/availability", (c) => {
    const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
    if (!DATE_PATTERN.test(date)) {
      return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    }
    return c.json(
      AvailabilityResponseSchema.parse({
        date,
        fetchedAt: new Date().toISOString(),
        stale: false,
        campgrounds: [],
      }),
    );
  });

  return app;
}
