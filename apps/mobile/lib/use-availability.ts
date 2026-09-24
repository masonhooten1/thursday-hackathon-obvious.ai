import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { resolveDataSource, type AvailabilityDataSource, type AvailabilityPayload } from "./data-source";
import { tonightISO } from "./dates";

/** The app re-fetches at this cadence while foregrounded (spec: 5 minutes). */
export const FOREGROUND_REFETCH_MS = 5 * 60 * 1000;
/** Returning to the foreground triggers an immediate fetch only if data is older than this. */
const MIN_FOREGROUND_REFRESH_MS = 60 * 1000;

export interface AvailabilityState {
  data: AvailabilityPayload | null;
  /** True until the first fetch resolves. */
  loading: boolean;
  /** True while a pull-to-refresh (or interval) refresh is in flight. */
  refreshing: boolean;
  /** Set when a fetch fails — the banner keeps last-known data visible. */
  error: string | null;
}

export interface AvailabilityHook extends AvailabilityState {
  /** Manual refresh — wired to pull-to-refresh. */
  refresh: () => Promise<void>;
}

export function shouldRefetchOnForeground(lastFetchMs: number | null, nowMs: number, minIntervalMs: number): boolean {
  return lastFetchMs === null || nowMs - lastFetchMs >= minIntervalMs;
}

/**
 * Loads availability, re-fetches every FOREGROUND_REFETCH_MS while the app
 * is foregrounded, refreshes on foreground transitions, and exposes refresh()
 * for pull-to-refresh. Failures keep the last-known data on screen and set
 * `error` — the UI shows the "availability data is delayed" banner (spec).
 */
export function useAvailability(dataSource: AvailabilityDataSource = resolveDataSource()): AvailabilityHook {
  const [state, setState] = useState<AvailabilityState>({ data: null, loading: true, refreshing: false, error: null });
  const lastFetchMsRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const fetchNow = useCallback(
    async (mode: "initial" | "refresh") => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setState((prev) => ({ ...prev, loading: mode === "initial" && prev.data === null, refreshing: true }));
      try {
        const data = await dataSource.fetch(tonightISO(new Date()));
        lastFetchMsRef.current = Date.now();
        setState({ data, loading: false, refreshing: false, error: null });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: error instanceof Error ? error.message : "availability fetch failed",
        }));
      } finally {
        inFlightRef.current = false;
      }
    },
    [dataSource],
  );

  useEffect(() => {
    void fetchNow("initial");

    const interval = setInterval(() => {
      if (AppState.currentState === "active") void fetchNow("refresh");
    }, FOREGROUND_REFETCH_MS);

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && shouldRefetchOnForeground(lastFetchMsRef.current, Date.now(), MIN_FOREGROUND_REFRESH_MS)) {
        void fetchNow("refresh");
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [fetchNow]);

  const refresh = useCallback(() => fetchNow("refresh"), [fetchNow]);

  return { ...state, refresh };
}
