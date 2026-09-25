import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentifyClient, isAbortError } from "@/lib/api/client";
import demoSpecies from "@/lib/api/demo-species.json";
import { LiveIdentifyClient, parseIdentifyResponse } from "@/lib/api/live-client";
import { MockIdentifyClient } from "@/lib/api/mock-client";
import { IdentifyError } from "@/lib/api/types";

// The mock's fixtures are built from the seeded catalog; assert against the
// seed itself so re-seeding after a new index build never breaks this test.
const SEEDED_SPECIES = (
  demoSpecies as { model_version: string; species: { scientific_name: string }[] }
).species;

function photo(name = "leaf.jpg", type = "image/jpeg", size = 10): File {
  const file = new File(["jpeg-bytes"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const OK_PAYLOAD = {
  matches: [
    {
      species_id: "30056",
      scientific_name: "Acer macrophyllum",
      common_name: "bigleaf maple",
      distance: 0.18,
      confidence: "high",
      reference_image: "/references/30056-01.jpg",
    },
  ],
  model_version: "bioclip2-vit-b16",
  latency_ms: 42,
  low_confidence: false,
};

describe("createIdentifyClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the mock by default", () => {
    expect(createIdentifyClient()).toBeInstanceOf(MockIdentifyClient);
  });

  it("returns the live client when NEXT_PUBLIC_API_BASE is set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE", "https://api.example.com");
    expect(createIdentifyClient()).toBeInstanceOf(LiveIdentifyClient);
  });
});

describe("MockIdentifyClient", () => {
  it("rejects undecodable files with 415", async () => {
    const client = new MockIdentifyClient(0);
    await expect(client.identify(photo("notes.txt", "text/plain"))).rejects.toMatchObject({
      name: "IdentifyError",
      status: 415,
    });
  });

  it("rejects oversized images with 413", async () => {
    const client = new MockIdentifyClient(0);
    await expect(
      client.identify(photo("huge.jpg", "image/jpeg", 11 * 1024 * 1024)),
    ).rejects.toMatchObject({ name: "IdentifyError", status: 413 });
  });

  it("resolves the high-confidence fixture by default", async () => {
    const response = await new MockIdentifyClient(0).identify(photo());
    expect(response.low_confidence).toBe(false);
    expect(response.matches).toHaveLength(5);
    expect(response.matches[0]!.scientific_name).toBe(SEEDED_SPECIES[0]!.scientific_name);
  });

  it("resolves the low-confidence fixture for files named unknown*", async () => {
    const response = await new MockIdentifyClient(0).identify(photo("unknown-plant.jpg"));
    expect(response.low_confidence).toBe(true);
    expect(response.matches[0]!.confidence).toBe("low");
  });

  it("honours cancellation while the simulated request is in flight", async () => {
    const client = new MockIdentifyClient(50);
    const controller = new AbortController();
    const pending = client.identify(photo(), controller.signal);
    controller.abort();
    const error = await pending.catch((caught: unknown) => caught);
    expect(isAbortError(error)).toBe(true);
  });
});

describe("LiveIdentifyClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the image and resolves relative reference paths against the base URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(OK_PAYLOAD), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await new LiveIdentifyClient("https://api.example.com").identify(photo());

    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/api/identify");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    expect(response.model_version).toBe("bioclip2-vit-b16");
    expect(response.matches[0]!.reference_image).toBe(
      "https://api.example.com/references/30056-01.jpg",
    );
  });

  it("passes absolute and data thumbnail URLs through untouched", () => {
    const parsed = parseIdentifyResponse(
      {
        matches: [{ ...OK_PAYLOAD.matches[0], reference_image: "data:image/svg+xml,thumb" }],
        model_version: "bioclip2-vit-b16",
        latency_ms: 1,
        low_confidence: false,
      },
      "https://api.example.com",
    );
    expect(parsed.matches[0]!.reference_image).toBe("data:image/svg+xml,thumb");
  });

  it("maps non-2xx responses onto IdentifyError with the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 413 })));

    await expect(
      new LiveIdentifyClient("https://api.example.com").identify(photo()),
    ).rejects.toMatchObject({ name: "IdentifyError", status: 413 });
  });

  it("lets network failures surface as connection errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(
      new LiveIdentifyClient("https://api.example.com").identify(photo()),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects malformed upstream payloads with 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    await expect(
      new LiveIdentifyClient("https://api.example.com").identify(photo()),
    ).rejects.toMatchObject({ name: "IdentifyError", status: 502 });
  });

  it("rejects matches with unknown confidence tiers with 502", () => {
    expect(() =>
      parseIdentifyResponse(
        {
          matches: [{ ...OK_PAYLOAD.matches[0], confidence: "certain" }],
          model_version: "bioclip2-vit-b16",
          latency_ms: 1,
          low_confidence: false,
        },
        "https://api.example.com",
      ),
    ).toThrow(IdentifyError);
  });
});
