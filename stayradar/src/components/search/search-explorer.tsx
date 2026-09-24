"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PropertySearchResult } from "@/lib/contracts";
import type { Market } from "@/fixtures/properties";
import { createStayRadarClient, type StayRadarClient } from "@/lib/api/client";
import { defaultSearchWindow, searchWindowError } from "@/lib/dates";
import { getSessionHash, rememberSearch } from "@/lib/session";
import { FilterBar, RADIUS_OPTIONS, type SearchFilters } from "@/components/search/filter-bar";
import { MapView } from "@/components/search/map-view";
import { ResultList } from "@/components/search/result-list";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StaleBanner,
  StaleErrorBanner,
} from "@/components/search/states";

/**
 * The search page's client orchestrator (traveler UX task): owns anchor +
 * filter state, runs contract-validated searches through the API client,
 * and keeps the map and list panes in sync. All API access happens here —
 * presentational children stay props-driven per the spec.
 */

interface Anchor {
  latitude: number;
  longitude: number;
  label: string;
}

type Phase = "loading" | "idle" | "error";

interface SearchExplorerProps {
  markets: readonly Market[];
  /** Preselect a market (from /?market= or the market landing links). */
  initialMarketId?: string | null;
  initialRadiusMiles?: number;
  /** Injectable API client for component tests; default is the real one. */
  client?: StayRadarClient;
}

const DEFAULT_RADIUS = 25;

function initialAnchor(markets: readonly Market[], marketId: string): Anchor {
  const market = markets.find((m) => m.id === marketId) ?? markets[0];
  return {
    latitude: market.center.latitude,
    longitude: market.center.longitude,
    label: `${market.name} center`,
  };
}

function nextWiderRadius(current: number): number | null {
  const wider = RADIUS_OPTIONS.find((miles) => miles > current);
  return wider ?? null;
}

/** utm_* params from the landing URL — the origin-market signal (spec). */
function utmFromLocation(): Record<string, string> | undefined {
  if (typeof window === "undefined") return undefined;
  const utm: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(window.location.search).entries()) {
    if (key.startsWith("utm_")) utm[key] = value;
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

export function SearchExplorer({
  markets,
  initialMarketId = null,
  initialRadiusMiles,
  client,
}: SearchExplorerProps) {
  const validInitialRadius =
    initialRadiusMiles &&
    RADIUS_OPTIONS.includes(initialRadiusMiles as (typeof RADIUS_OPTIONS)[number])
      ? initialRadiusMiles
      : DEFAULT_RADIUS;
  const validInitialMarketId = markets.some((m) => m.id === initialMarketId)
    ? (initialMarketId as string)
    : markets[0].id;

  const [marketId, setMarketId] = useState(validInitialMarketId);
  const [anchor, setAnchor] = useState<Anchor>(() => initialAnchor(markets, validInitialMarketId));
  // The search contract requires both dates — start from the default window
  // (two weekends out) so the first search is always valid.
  const [filters, setFilters] = useState<SearchFilters>(() => ({
    ...defaultSearchWindow(),
    guests: 2,
    propertyType: "any",
    radiusMiles: validInitialRadius,
  }));
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [results, setResults] = useState<PropertySearchResult[] | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Center the user panned the map to, pending "Search this area".
  const [pendingCenter, setPendingCenter] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );

  const windowError = useMemo(
    () => searchWindowError(filters.checkIn, filters.checkOut),
    [filters.checkIn, filters.checkOut],
  );

  const runSearch = useCallback(
    async (searchAnchor: Anchor, searchFilters: SearchFilters) => {
      if (!searchFilters.checkIn || !searchFilters.checkOut) {
        setPhase("error");
        setErrorMessage("Choose check-in and check-out dates to search.");
        return;
      }
      if (windowError) {
        setPhase("error");
        setErrorMessage(windowError);
        return;
      }
      setPhase("loading");
      setErrorMessage(null);
      const api = client ?? createStayRadarClient();
      try {
        const response = await api.search({
          latitude: searchAnchor.latitude,
          longitude: searchAnchor.longitude,
          radiusMiles: searchFilters.radiusMiles,
          checkIn: searchFilters.checkIn,
          checkOut: searchFilters.checkOut,
          guests: searchFilters.guests,
          propertyType: searchFilters.propertyType === "any" ? undefined : searchFilters.propertyType,
          sessionHash: getSessionHash(),
          utm: utmFromLocation(),
        });
        setResults(response.results);
        setSelectedId(null);
        setPhase("idle");
        // Marketing raw material (spec: search events + first-party signals).
        rememberSearch({
          searchEventId: response.searchEventId,
          propertyIds: response.results.map((r) => r.id),
          checkIn: searchFilters.checkIn,
          checkOut: searchFilters.checkOut,
          guests: searchFilters.guests,
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
        setPhase("error");
      }
    },
    [client, windowError],
  );

  // Refetch whenever the anchor or filters change.
  useEffect(() => {
    void runSearch(anchor, filters);
  }, [anchor, filters, runSearch]);

  const handleFilterChange = useCallback((next: SearchFilters) => setFilters(next), []);

  const handleMarketChange = useCallback(
    (nextId: string) => {
      const market = markets.find((m) => m.id === nextId);
      if (!market) return;
      setMarketId(nextId);
      setAnchor({
        latitude: market.center.latitude,
        longitude: market.center.longitude,
        label: `${market.name} center`,
      });
      setPendingCenter(null);
    },
    [markets],
  );

  const handleWiden = useCallback(() => {
    const wider = nextWiderRadius(filters.radiusMiles);
    if (!wider) return;
    setFilters((prev) => ({ ...prev, radiusMiles: wider }));
  }, [filters.radiusMiles]);

  const handleSearchThisArea = useCallback(() => {
    if (!pendingCenter) return;
    setAnchor({
      latitude: pendingCenter.latitude,
      longitude: pendingCenter.longitude,
      label: "map center",
    });
    setPendingCenter(null);
  }, [pendingCenter]);

  const anchorLabel = anchor.label;
  const radiusMiles = filters.radiusMiles;
  const listBusy = phase === "loading";
  const mapHidden = viewMode !== "map" ? "hidden lg:block" : "";
  const listHidden = viewMode !== "list" ? "hidden lg:block" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="search-explorer">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        onSearch={() => void runSearch(anchor, filters)}
        windowError={windowError}
        busy={listBusy}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="market-select" className="font-medium text-stone-600">
            Market
          </label>
          <select
            id="market-select"
            aria-label="Select market"
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900"
            value={marketId}
            onChange={(event) => handleMarketChange(event.target.value)}
          >
            {markets.map((market) => (
              <option key={market.id} value={market.id}>
                {market.name}
              </option>
            ))}
          </select>
          <span aria-live="polite" className="text-stone-500" data-testid="results-summary">
            {results === null
              ? "Loading results…"
              : `${results.length} ${results.length === 1 ? "stay" : "stays"} within ${radiusMiles} mi of ${anchorLabel}`}
          </span>
        </div>
        <div
          role="group"
          aria-label="Result view"
          className="flex overflow-hidden rounded-md border border-stone-300"
        >
          <button
            type="button"
            aria-pressed={viewMode === "map"}
            onClick={() => setViewMode("map")}
            className={`px-3 py-1.5 text-xs font-semibold ${
              viewMode === "map" ? "bg-teal-700 text-white" : "bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            Map
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 text-xs font-semibold ${
              viewMode === "list" ? "bg-teal-700 text-white" : "bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            List
          </button>
        </div>
      </div>

      <div className="grid min-h-[480px] flex-1 gap-4 lg:grid-cols-2">
        <div className={`relative min-h-72 overflow-hidden rounded-xl border border-stone-200 ${mapHidden}`}>
          <MapView
            center={{ latitude: anchor.latitude, longitude: anchor.longitude }}
            radiusMiles={radiusMiles}
            results={results ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUserMoveEnd={setPendingCenter}
            className="absolute inset-0"
          />
          {pendingCenter ? (
            <button
              type="button"
              onClick={handleSearchThisArea}
              data-testid="search-this-area"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-stone-900 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-stone-800"
            >
              Search this area
            </button>
          ) : null}
        </div>

        <div
          className={`min-h-0 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-4 ${listHidden}`}
        >
          {results === null && listBusy ? <LoadingState anchorLabel={anchorLabel} /> : null}
          {results === null && phase === "error" ? (
            <ErrorState
              message={errorMessage ?? "Something went wrong."}
              onRetry={() => void runSearch(anchor, filters)}
            />
          ) : null}
          {results !== null ? (
            <div className="flex flex-col gap-3">
              {listBusy ? <StaleBanner /> : null}
              {!listBusy && phase === "error" ? (
                <StaleErrorBanner
                  message={errorMessage ?? "Something went wrong."}
                  onRetry={() => void runSearch(anchor, filters)}
                />
              ) : null}
              {results.length === 0 ? (
                <EmptyState
                  anchorLabel={anchorLabel}
                  radiusMiles={radiusMiles}
                  canWiden={nextWiderRadius(radiusMiles) !== null}
                  onWiden={handleWiden}
                />
              ) : (
                <ResultList
                  results={results}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  anchorLabel={anchorLabel}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-stone-400">
        Radius anchored on {anchorLabel} — drag the map and use “Search this area” to move it.
      </p>
    </div>
  );
}
