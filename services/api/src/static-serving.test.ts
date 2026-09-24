import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createCatalogSchema } from "./catalog/schema";
import { openDb } from "./db";
import { createSnapshotsSchema } from "./snapshots/store";

/**
 * D6 same-origin demo harness: the app option that serves the Expo web
 * export from the API process. No port binding — app.request() throughout.
 */
function harness(webDistDir: string | undefined) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "static-serving-")), "test.db"));
  createCatalogSchema(db);
  createSnapshotsSchema(db);
  return createApp({ db, pollNow: async () => { throw new Error("unused"); }, webDistDir });
}

function makeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "web-dist-"));
  writeFileSync(join(dir, "index.html"), "<html><body>campground tonight demo</body></html>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log('bundle');");
  return dir;
}

describe("static web demo serving", () => {
  it("serves index.html at / when webDistDir is configured", async () => {
    const app = harness(makeDist());
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("campground tonight demo");
  });

  it("serves asset files from the export", async () => {
    const app = harness(makeDist());
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  it("falls back to index.html for unknown app routes (SPA shell)", async () => {
    const app = harness(makeDist());
    const res = await app.request("/some/unknown/route");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("campground tonight demo");
  });

  it("keeps unknown /api paths a 404 instead of the SPA shell", async () => {
    const app = harness(makeDist());
    const res = await app.request("/api/unknown");
    expect(res.status).toBe(404);
  });

  it("answers 503 with guidance when the export is not built", async () => {
    const app = harness(join(mkdtempSync(join(tmpdir(), "web-dist-empty-")), "no-dist-here"));
    const res = await app.request("/");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("export:web");
  });

  it("serves the API only when webDistDir is unset (default behavior)", async () => {
    const app = harness(undefined);
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    const root = await app.request("/");
    expect(root.status).toBe(404); // Hono default — no static mount
  });
});
