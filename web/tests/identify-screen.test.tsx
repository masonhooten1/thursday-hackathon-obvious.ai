import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import IdentifyScreen from "@/components/IdentifyScreen";
import type { IdentifyClient } from "@/lib/api/client";
import { MockIdentifyClient } from "@/lib/api/mock-client";
import { IdentifyError } from "@/lib/api/types";
import type { IdentifyResponse } from "@/lib/api/types";

const MOCK_THUMBNAIL = "data:image/svg+xml,placeholder";

function highConfidenceResponse(): IdentifyResponse {
  return {
    model_version: "bioclip2-vit-b16",
    latency_ms: 42,
    low_confidence: false,
    matches: [
      {
        species_id: "30056",
        scientific_name: "Acer macrophyllum",
        common_name: "bigleaf maple",
        distance: 0.18,
        confidence: "high",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "30058",
        scientific_name: "Acer circinatum",
        common_name: "vine maple",
        distance: 0.26,
        confidence: "high",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "30112",
        scientific_name: "Platanus racemosa",
        common_name: "western sycamore",
        distance: 0.34,
        confidence: "medium",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "29987",
        scientific_name: "Acer platanoides",
        common_name: "Norway maple",
        distance: 0.47,
        confidence: "medium",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "30061",
        scientific_name: "Acer glabrum",
        common_name: "Rocky Mountain maple",
        distance: 0.58,
        confidence: "low",
        reference_image: MOCK_THUMBNAIL,
      },
    ],
  };
}

function lowConfidenceResponse(): IdentifyResponse {
  return {
    model_version: "bioclip2-vit-b16",
    latency_ms: 42,
    low_confidence: true,
    matches: [
      {
        species_id: "30056",
        scientific_name: "Acer macrophyllum",
        common_name: "bigleaf maple",
        distance: 0.83,
        confidence: "low",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "30058",
        scientific_name: "Acer circinatum",
        common_name: "vine maple",
        distance: 0.9,
        confidence: "low",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "30112",
        scientific_name: "Platanus racemosa",
        common_name: "western sycamore",
        distance: 0.94,
        confidence: "low",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "29987",
        scientific_name: "Acer platanoides",
        common_name: "Norway maple",
        distance: 0.96,
        confidence: "low",
        reference_image: MOCK_THUMBNAIL,
      },
      {
        species_id: "30061",
        scientific_name: "Acer glabrum",
        common_name: "Rocky Mountain maple",
        distance: 0.97,
        confidence: "low",
        reference_image: MOCK_THUMBNAIL,
      },
    ],
  };
}

interface Deferred {
  promise: Promise<IdentifyResponse>;
  resolve: (response: IdentifyResponse) => void;
  reject: (error: unknown) => void;
}

function deferredResponse(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<IdentifyResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Client whose responses the test resolves manually, in order. */
class ScriptedClient implements IdentifyClient {
  identifyCalls = 0;
  private queue: Deferred[] = [];

  enqueue(): Deferred {
    const deferred = deferredResponse();
    this.queue.push(deferred);
    return deferred;
  }

  identify(_file: File, signal?: AbortSignal): Promise<IdentifyResponse> {
    this.identifyCalls += 1;
    const deferred = this.queue.shift();
    if (!deferred) return Promise.reject(new Error("ScriptedClient: no queued response"));
    if (signal?.aborted) {
      deferred.reject(new DOMException("The identification was cancelled", "AbortError"));
    }
    return deferred.promise;
  }
}

function photo(name = "leaf.jpg", options: FilePropertyBag = {}): File {
  return new File(["jpeg-bytes"], name, { type: "image/jpeg", ...options });
}

function choosePhoto(file: File) {
  fireEvent.change(screen.getByLabelText("Choose a plant photo"), {
    target: { files: [file] },
  });
}

// jsdom implements neither blob URL factories.
beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:test-url"),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

describe("upload state", () => {
  it("renders one affordance with an image file input", () => {
    render(<IdentifyScreen client={new MockIdentifyClient(0)} />);

    const affordance = screen.getByTestId("upload-affordance");
    expect(affordance).toHaveTextContent("Drop a plant photo here");
    expect(screen.getByLabelText("Choose a plant photo")).toHaveAttribute("accept", "image/*");
  });

  it("starts identifying when a photo is dropped on the affordance", () => {
    // Scripted client keeps the identifying state open — a latency-0 mock can
    // reach results before the assertion runs, so this must not be transient.
    const client = new ScriptedClient();
    client.enqueue();
    render(<IdentifyScreen client={client} />);

    fireEvent.drop(screen.getByTestId("upload-affordance"), {
      dataTransfer: { files: [photo("dropped.jpg")] },
    });

    expect(screen.getByAltText("The plant photo being identified")).toBeInTheDocument();
  });

  it("rejects non-image files before any request", () => {
    const client = new ScriptedClient();
    render(<IdentifyScreen client={client} />);

    choosePhoto(new File(["text"], "notes.txt", { type: "text/plain" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/that file isn't an image/i);
    expect(client.identifyCalls).toBe(0);
    expect(screen.queryByAltText(/plant photo/i)).not.toBeInTheDocument();
  });

  it("rejects photos larger than 10 MB before any request", () => {
    const client = new ScriptedClient();
    render(<IdentifyScreen client={client} />);

    const oversized = photo("huge.jpg");
    Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });
    choosePhoto(oversized);

    expect(screen.getByRole("alert")).toHaveTextContent(/photo too large/i);
    expect(client.identifyCalls).toBe(0);
  });
});

describe("identifying state", () => {
  it("shows the photo, moving progress, and a working cancel", async () => {
    const client = new ScriptedClient();
    render(<IdentifyScreen client={client} />);

    choosePhoto(photo());

    expect(screen.getByAltText("The plant photo being identified")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Identifying plant" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("upload-affordance")).toBeInTheDocument();
  });

  it("ignores a response that arrives after cancel", async () => {
    const client = new ScriptedClient();
    const deferred = client.enqueue();
    render(<IdentifyScreen client={client} />);

    choosePhoto(photo());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    deferred.resolve(highConfidenceResponse());
    await waitFor(() => {});

    expect(screen.getByTestId("upload-affordance")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /species matches/i })).not.toBeInTheDocument();
  });
});

describe("results state", () => {
  it("renders five matches nearest-first with confidence bars by length", async () => {
    render(<IdentifyScreen client={new MockIdentifyClient(0)} />);

    choosePhoto(photo());
    const list = await screen.findByRole("list", { name: "Species matches, nearest first" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Acer macrophyllum"),
      expect.stringContaining("Acer circinatum"),
      expect.stringContaining("Platanus racemosa"),
      expect.stringContaining("Acer platanoides"),
      expect.stringContaining("Acer glabrum"),
    ]);

    const meters = within(list).getAllByRole("meter");
    expect(meters.map((meter) => meter.getAttribute("aria-valuenow"))).toEqual([
      "82",
      "74",
      "66",
      "53",
      "42",
    ]);
    const firstFill = meters[0]!.querySelector(".confidence-fill") as HTMLElement;
    expect(firstFill.style.width).toBe("82%");
  });

  it("shows common names and returns to upload for another photo", async () => {
    render(<IdentifyScreen client={new MockIdentifyClient(0)} />);

    choosePhoto(photo());
    await screen.findByRole("list", { name: /species matches/i });

    expect(screen.getByText("bigleaf maple")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Identify another photo" }));
    expect(screen.getByTestId("upload-affordance")).toBeInTheDocument();
  });

  it("expands a reference photo on tap and collapses on second tap", async () => {
    render(<IdentifyScreen client={new MockIdentifyClient(0)} />);

    choosePhoto(photo());
    await screen.findByRole("list", { name: /species matches/i });

    const thumbnailButton = screen.getByRole("button", {
      name: "Reference photo for Acer macrophyllum",
    });
    fireEvent.click(thumbnailButton);
    expect(screen.getByAltText("Reference photo of Acer macrophyllum")).toBeInTheDocument();
    fireEvent.click(thumbnailButton);
    expect(screen.queryByAltText("Reference photo of Acer macrophyllum")).not.toBeInTheDocument();
  });
});

describe("low-confidence state", () => {
  it("renders the banner and possible matches without a forced guess", async () => {
    render(<IdentifyScreen client={new MockIdentifyClient(0)} />);

    choosePhoto(photo("unknown-plant.jpg"));

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent(/may be outside the reference set/i);
    expect(banner).toHaveTextContent(/a closer photo of a leaf or flower helps/i);
    expect(screen.getAllByText("possible match")).toHaveLength(5);
    // No forced top-1 guess: the common name must not be presented as the answer.
    expect(screen.queryByText("bigleaf maple")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("retry re-runs identification with the photo preserved", async () => {
    const client = new MockIdentifyClient(0);
    const identifySpy = vi.spyOn(client, "identify");
    render(<IdentifyScreen client={client} />);

    choosePhoto(photo("unknown-plant.jpg"));
    await screen.findByRole("status");

    const secondCall = deferredResponse();
    vi.mocked(client.identify).mockImplementationOnce(() => secondCall.promise);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByAltText("The plant photo being identified")).toBeInTheDocument();
    expect(identifySpy).toHaveBeenCalledTimes(2);

    secondCall.resolve(lowConfidenceResponse());
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});

describe("error state", () => {
  it("reuses the low-confidence layout with the photo preserved and a retry", async () => {
    const client = new ScriptedClient();
    const deferred = client.enqueue();
    render(<IdentifyScreen client={client} />);

    choosePhoto(photo());
    deferred.reject(new TypeError("fetch failed"));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/connection problem/i);
    expect(screen.getByAltText("The plant photo that failed to identify")).toBeInTheDocument();

    const retry = client.enqueue();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByAltText("The plant photo being identified")).toBeInTheDocument();
    retry.resolve(highConfidenceResponse());
    await screen.findByRole("list", { name: /species matches/i });
  });

  it("surfaces API error codes with plain-language banners", async () => {
    const client = new ScriptedClient();
    const deferred = client.enqueue();
    render(<IdentifyScreen client={client} />);

    choosePhoto(photo());
    deferred.reject(new IdentifyError(413, "image larger than 10 MB"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/photo too large/i);
  });
});
