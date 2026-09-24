import { describe, expect, it } from "vitest";
import { AvailabilityResponseSchema } from "@campground/shared";
import { createApp } from "./app";

const app = createApp();

describe("GET /health", () => {
  it("responds ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/availability", () => {
  it("returns a contract-valid empty response", async () => {
    const res = await app.request("/api/availability?date=2026-09-24");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AvailabilityResponseSchema.parse(body)).toMatchObject({
      date: "2026-09-24",
      stale: false,
      campgrounds: [],
    });
  });

  it("rejects malformed dates", async () => {
    const res = await app.request("/api/availability?date=yesterday");
    expect(res.status).toBe(400);
  });

  it("defaults to tonight (UTC)", async () => {
    const res = await app.request("/api/availability");
    expect(res.status).toBe(200);
    const body = AvailabilityResponseSchema.parse(await res.json());
    expect(body.date).toBe(new Date().toISOString().slice(0, 10));
  });
});
