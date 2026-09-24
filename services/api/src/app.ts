import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import {
  AvailabilityResponseSchema,
  CampgroundSchema,
  ParkSchema,
  SITE_TYPES,
  SiteTypeSchema,
  type SiteType,
} from "@campground/shared";
import { listCampgrounds, listParks } from "./catalog/schema";
import type { Db } from "./db";
import { PollCycleInProgress, type PollCycleReport } from "./poller";
import { responseIsStale } from "./snapshots/staleness";
import { latestSnapshot } from "./snapshots/store";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real UTC calendar date — rejects impossible dates like 2026-02-30. */
function isValidUtcDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === date;
}

const ParksResponse = z.array(ParkSchema);
const CampgroundsResponse = z.array(CampgroundSchema);

/** Constant-time comparison of a presented bearer against the configured secret. */
function bearerMatches(presented: string, secret: string): boolean {
  const presentedBytes = Buffer.from(presented, "utf8");
  const secretBytes = Buffer.from(secret, "utf8");
  return presentedBytes.length === secretBytes.length && timingSafeEqual(presentedBytes, secretBytes);
}

export interface AppOptions {
  db: Db;
  /** Runs one poll cycle now — the admin trigger awaits its report. */
  pollNow: () => Promise<PollCycleReport>;
  /** Bearer secret guarding POST /api/admin/poll; unset disables the endpoint. */
  adminPollSecret?: string;
  /**
   * Directory of the Expo static web export (apps/mobile/dist). When set, the
   * same process serves the built demo on one port with the API — the hosted
   * web demo's same-origin setup (spec D6). Unset serves the API only.
   */
  webDistDir?: string;
  /** Injectable clock (tests pin freshness boundaries). */
  now?: () => Date;
}

/**
 * Builds the API app (spec D4). Reads the catalog and snapshot stores; the
 * only external-system work happens inside the poller the app triggers.
 * Tests drive it with app.request() — no port binding.
 */
export function createApp(options: AppOptions): Hono {
  const { db, pollNow } = options;
  const now = options.now ?? (() => new Date());
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/api/parks", (c) => c.json(ParksResponse.parse(listParks(db))));

  app.get("/api/campgrounds", (c) => {
    const typeQuery = c.req.query("type");
    let siteType: SiteType | undefined;
    if (typeQuery !== undefined) {
      const parsedType = SiteTypeSchema.safeParse(typeQuery);
      if (!parsedType.success) {
        return c.json({ error: `type must be one of: ${SITE_TYPES.join(", ")}` }, 400);
      }
      siteType = parsedType.data;
    }
    const parkId = c.req.query("parkId");
    const campgrounds = listCampgrounds(db).filter(
      (campground) =>
        (parkId === undefined || campground.parkId === parkId) &&
        (siteType === undefined || campground.siteTypes.includes(siteType)),
    );
    return c.json(CampgroundsResponse.parse(campgrounds));
  });

  app.get("/api/availability", (c) => {
    const at = now();
    const date = c.req.query("date") ?? at.toISOString().slice(0, 10);
    if (!isValidUtcDate(date)) {
      return c.json({ error: "date must be a valid calendar date (YYYY-MM-DD)" }, 400);
    }
    // The latest snapshot per campground — the poller's cycle is the only
    // writer, so this is the cached view the app re-fetches every 5 minutes.
    const campgrounds = listCampgrounds(db).map((campground) => ({
      ...campground,
      snapshot: latestSnapshot(db, campground.facilityId),
    }));
    return c.json(
      AvailabilityResponseSchema.parse({
        date,
        fetchedAt: at.toISOString(),
        // The banner state: every served snapshot, freshest included, is past
        // twice the poll interval. Per-campground freshness rides on capturedAt.
        stale: responseIsStale(
          campgrounds.map((campground) => campground.snapshot?.capturedAt ?? null),
          at,
        ),
        campgrounds,
      }),
    );
  });

  // Manual poll trigger (spec: guarded by a bearer secret). Awaiting the
  // cycle returns its report directly; a cycle already in flight is a 409,
  // not a queue — the cron cadence never overlaps itself at v1 scale.
  app.post("/api/admin/poll", async (c) => {
    const secret = options.adminPollSecret;
    if (!secret) {
      return c.json({ error: "admin poll endpoint is not configured (set ADMIN_POLL_SECRET)" }, 503);
    }
    const authorization = c.req.header("Authorization") ?? "";
    const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
    if (!presented || !bearerMatches(presented, secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    try {
      return c.json(await pollNow());
    } catch (error) {
      if (error instanceof PollCycleInProgress) {
        return c.json({ error: "a poll cycle is already running" }, 409);
      }
      console.error("[campground-api] manual poll failed:", error);
      return c.json({ error: "poll cycle failed" }, 500);
    }
  });

  // Same-origin web demo (spec D6): when webDistDir points at the Expo static
  // export, this process serves both the API and the built app on one port —
  // the browser fetches with a relative base URL, so no CORS or second host.
  // Registered after the API routes so /api/* is never shadowed.
  const webDistDir = options.webDistDir;
  if (webDistDir !== undefined) {
    // node-server's serveStatic resolves root against the process cwd; the
    // relative path keeps an absolute env var working from any launch dir.
    const root = relative(process.cwd(), resolve(webDistDir));
    let indexHtml: string | null = null;
    const readIndex = (): string => {
      // Cached after first read; a missing export fails here with a clear
      // ENOENT message instead of a confusing 404 per path.
      if (indexHtml === null) indexHtml = readFileSync(join(root, "index.html"), "utf8");
      return indexHtml;
    };
    app.use("*", serveStatic({ root }));
    app.get("*", (c) => {
      // Unknown API paths stay 404 — only app routes fall back to the SPA shell.
      if (c.req.path.startsWith("/api/")) return c.notFound();
      try {
        return c.html(readIndex());
      } catch {
        return c.text("web demo not built — run: npm run export:web --workspace=@campground/mobile", 503);
      }
    });
  }

  return app;
}
