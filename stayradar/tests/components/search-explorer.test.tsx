import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MARKETS } from "@/fixtures/properties";
import type { PropertySearchQuery, PropertySearchResponse } from "@/lib/contracts";
import { ApiClientError } from "@/lib/api/client";
import { SearchExplorer } from "@/components/search/search-explorer";
import { searchResult, searchResponse } from "./fixtures";

// MapView touches maplibre-gl in a mount effect; jsdom has no WebGL, so the
// module is stubbed. The stub's Map never fires "load", keeping downstream
// marker/overlay effects inert — those are map-library behavior, not ours.
vi.mock("maplibre-gl", () => {
  class MapStub {
    on = vi.fn();
    remove = vi.fn();
    flyTo = vi.fn();
    fitBounds = vi.fn();
    getCenter = vi.fn(() => ({ lat: 0, lng: 0 }));
  }
  class MarkerStub {
    setLngLat = vi.fn(() => this);
    addTo = vi.fn(() => this);
    remove = vi.fn();
  }
  return { Map: MapStub, Marker: MarkerStub };
});

interface ClientStub {
  search: ReturnType<typeof vi.fn>;
  propertyDetail: ReturnType<typeof vi.fn>;
  submitInquiry: ReturnType<typeof vi.fn>;
}

function clientWith(
  impl: (query: PropertySearchQuery) => Promise<PropertySearchResponse>,
): ClientStub {
  return { search: vi.fn(impl), propertyDetail: vi.fn(), submitInquiry: vi.fn() };
}

const tahoe = MARKETS.find((m) => m.id === "lake-tahoe")!;

describe("SearchExplorer", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("runs a contract-shaped search on mount and renders the results list", async () => {
    const client = clientWith(() =>
      Promise.resolve(
        searchResponse([
          searchResult({ title: "Lakeside Cabin" }),
          searchResult({ title: "Ski Chalet", availableForWindow: false }),
        ]),
      ),
    );
    render(<SearchExplorer markets={MARKETS} client={client} />);

    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(1));
    const [query] = client.search.mock.calls[0] as [PropertySearchQuery];
    expect(query.latitude).toBe(tahoe.center.latitude);
    expect(query.longitude).toBe(tahoe.center.longitude);
    expect(query.radiusMiles).toBe(25);
    expect(query.guests).toBe(2);
    expect(query.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.checkOut).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.checkOut > query.checkIn).toBe(true);
    expect(query.sessionHash).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByTestId("results-summary")).toHaveTextContent(
        "2 stays within 25 mi of Lake Tahoe center",
      ),
    );
    expect(screen.getByText("Lakeside Cabin")).toBeInTheDocument();
    expect(screen.getByText("Ski Chalet")).toBeInTheDocument();
  });

  it("shows the empty state with a widen action when nothing is in radius", async () => {
    const client = clientWith(() => Promise.resolve(searchResponse([])));
    render(<SearchExplorer markets={MARKETS} client={client} />);

    await waitFor(() => expect(screen.getByText(/No stays within/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Try a wider radius/i }));

    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(2));
    const [query] = client.search.mock.calls[1] as [PropertySearchQuery];
    expect(query.radiusMiles).toBe(50);
  });

  it("shows the error state with retry after an API failure", async () => {
    const client = clientWith(() => {
      throw new ApiClientError("internal_error", "Could not reach the StayRadar API (radius search).");
    });
    render(<SearchExplorer markets={MARKETS} client={client} />);

    await waitFor(() =>
      expect(screen.getByText(/Could not reach the StayRadar API/)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));

    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(2));
  });

  it("keeps previous results visible with a stale banner while refetching", async () => {
    let resolveSecond: (response: PropertySearchResponse) => void = () => {};
    const client = clientWith(() => {
      if (client.search.mock.calls.length === 1) {
        return Promise.resolve(searchResponse([searchResult({ title: "First Pass" })]));
      }
      return new Promise<PropertySearchResponse>((resolve) => {
        resolveSecond = resolve;
      });
    });
    render(<SearchExplorer markets={MARKETS} client={client} />);
    await waitFor(() => expect(screen.getByText("First Pass")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Guests/i), "4");
    expect(screen.getByText(/Updating results/i)).toBeInTheDocument();
    expect(screen.getByText("First Pass")).toBeInTheDocument();

    resolveSecond(searchResponse([searchResult({ title: "Second Pass" })]));
    await waitFor(() => expect(screen.getByText("Second Pass")).toBeInTheDocument());
    expect(screen.queryByText(/Updating results/i)).not.toBeInTheDocument();
  });

  it("sends the property-type filter with the search", async () => {
    const client = clientWith(() => Promise.resolve(searchResponse([])));
    render(<SearchExplorer markets={MARKETS} client={client} />);
    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByLabelText(/Property type/i), "cabin");
    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(2));
    const [query] = client.search.mock.calls[1] as [PropertySearchQuery];
    expect(query.propertyType).toBe("cabin");
  });

  it("switches the anchor when the market changes", async () => {
    const client = clientWith(() => Promise.resolve(searchResponse([])));
    render(<SearchExplorer markets={MARKETS} client={client} />);
    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByLabelText(/Select market/i), "gatlinburg");
    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(2));
    const [query] = client.search.mock.calls[1] as [PropertySearchQuery];
    const gatlinburg = MARKETS.find((m) => m.id === "gatlinburg")!;
    expect(query.latitude).toBe(gatlinburg.center.latitude);
    expect(query.longitude).toBe(gatlinburg.center.longitude);
  });

  it("blocks the search when the date window is invalid", async () => {
    const client = clientWith(() => Promise.resolve(searchResponse([])));
    render(<SearchExplorer markets={MARKETS} client={client} />);
    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(1));

    // jsdom date inputs ignore character typing — set the value directly to a
    // date before the default check-in (today + 14 days).
    fireEvent.change(screen.getByLabelText(/Check-out/i), {
      target: { value: "2020-01-01" },
    });
    // Multiple alerts can be on screen (filter errors + state banners) — the
    // window-rule alert must be among them.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent).join(" ")).toMatch(
      /checkOut must be after checkIn/i,
    );
  });
});
