import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORAGE_BUCKET, putPdf, putSnapshot } from "@/lib/data/storage";

/**
 * Storage is the credential-free seam: null when unconfigured (call sites
 * degrade to honest labeled states), a key on successful upload, and a throw
 * only for real upload failures (drives the export `failed` path).
 */

const ENV_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

/** Merges provided values over the current env; absent keys are untouched. */
function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function fetchOk(): ReturnType<typeof vi.fn> {
  return vi.fn(async () =>
    new Response(JSON.stringify({ Key: "object" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function fetchError(status: number, body: string): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(body, { status }));
}

describe("lib/data/storage", () => {
  const saved = new Map<string, string | undefined>();
  const savedFetch = globalThis.fetch;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
    clearEnv();
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    globalThis.fetch = savedFetch;
  });

  describe("unconfigured", () => {
    it("putPdf returns null — never throws — without URL and service key", async () => {
      const fetchMock = fetchOk();
      vi.stubGlobal("fetch", fetchMock);
      await expect(putPdf("ws", "exp", new Uint8Array([1]))).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("putSnapshot returns null without credentials", async () => {
      await expect(putSnapshot("ws", "co", "cap", "text")).resolves.toBeNull();
    });

    it("URL alone is not enough — service key is required", async () => {
      setEnv({ SUPABASE_URL: "https://proj.supabase.co" });
      await expect(putPdf("ws", "exp", new Uint8Array([1]))).resolves.toBeNull();
    });

    it("accepts NEXT_PUBLIC_SUPABASE_URL when SUPABASE_URL is unset", async () => {
      setEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://public.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      });
      const fetchMock = fetchOk();
      vi.stubGlobal("fetch", fetchMock);

      await expect(putPdf("ws", "exp", new Uint8Array([1]))).resolves.toBe(
        "workspaces/ws/exports/exp.pdf",
      );
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url.startsWith("https://public.supabase.co/storage/v1/object/")).toBe(true);
    });
  });

  describe("configured upload", () => {
    beforeEach(() => {
      setEnv({
        SUPABASE_URL: "https://proj.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      });
    });

    it("putPdf POSTs the bytes to the private bucket and returns the key", async () => {
      const fetchMock = fetchOk();
      vi.stubGlobal("fetch", fetchMock);
      const pdf = new Uint8Array([1, 2, 3]);

      const key = await putPdf("ws-1", "exp-1", pdf);

      expect(key).toBe("workspaces/ws-1/exports/exp-1.pdf");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `https://proj.supabase.co/storage/v1/object/${DEFAULT_STORAGE_BUCKET}/workspaces/ws-1/exports/exp-1.pdf`,
      );
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer service-role-key");
      expect(headers["Content-Type"]).toBe("application/pdf");
      expect(headers["x-upsert"]).toBe("true");
      // Body is a fresh copy of the view — compare contents, not identity.
      expect(Array.from(init.body as Uint8Array)).toEqual([1, 2, 3]);
    });

    it("putSnapshot POSTs text and returns the capture key", async () => {
      const fetchMock = fetchOk();
      vi.stubGlobal("fetch", fetchMock);

      const key = await putSnapshot("ws-1", "co-1", "cap-1", "captured text");

      expect(key).toBe("workspaces/ws-1/companies/co-1/captures/cap-1.txt");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/storage/v1/object/exports/workspaces/ws-1/companies/co-1/captures/cap-1.txt");
      expect(init.body).toBe("captured text");
    });

    it("honors SUPABASE_STORAGE_BUCKET over the default", async () => {
      setEnv({ SUPABASE_STORAGE_BUCKET: "custom-bucket" });
      const fetchMock = fetchOk();
      vi.stubGlobal("fetch", fetchMock);

      const key = await putSnapshot("ws", "co", "cap", "t");

      expect(key).toBe("workspaces/ws/companies/co/captures/cap.txt");
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("/storage/v1/object/custom-bucket/");
    });

  });

  describe("upload failure", () => {
    beforeEach(() => {
      setEnv({
        SUPABASE_URL: "https://proj.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      });
    });

    it("putPdf throws on a non-2xx upload", async () => {
      vi.stubGlobal("fetch", fetchError(507, "Insufficient Storage"));
      await expect(putPdf("ws", "exp", new Uint8Array([1]))).rejects.toThrow(
        /Supabase Storage upload failed \(507\): Insufficient Storage/,
      );
    });

    it("putSnapshot throws on a non-2xx upload", async () => {
      vi.stubGlobal("fetch", fetchError(403, "denied"));
      await expect(putSnapshot("ws", "co", "cap", "t")).rejects.toThrow(
        /Supabase Storage upload failed \(403\): denied/,
      );
    });
  });
});
