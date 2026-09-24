"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataSources, RunStatusPayload } from "@/lib/data-source";
import { isTerminalRunStatus } from "@/lib/fixture-ticker";

/**
 * Polls the authenticated run-status endpoint (brief §Stack: the dashboard
 * polls; realtime is a later refinement). Stops itself once the run reaches a
 * terminal status, keeps the last good payload when a poll fails (the UI
 * shows the error banner alongside slightly-stale data rather than blanking
 * the board), and never issues overlapping requests.
 */

export interface UseRunStatusResult {
  payload: RunStatusPayload | null;
  /** True until the first fetch attempt completes. */
  loading: boolean;
  /** True while a background poll is in flight. */
  refreshing: boolean;
  error: string | null;
  lastCheckedAt: string | null;
  cancelInFlight: boolean;
  cancel: () => Promise<void>;
  refreshNow: () => Promise<void>;
}

export function useRunStatus(
  sources: DataSources,
  runId: string | null,
  intervalMs = 3000,
): UseRunStatusResult {
  const [payload, setPayload] = useState<RunStatusPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(runId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [cancelInFlight, setCancelInFlight] = useState(false);

  const inFlight = useRef(false);
  const terminal = useRef(false);

  const fetchNow = useCallback(async () => {
    if (!runId || inFlight.current || terminal.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const next = await sources.runStatus.getRunStatus(runId);
      setPayload(next);
      setError(null);
      setLastCheckedAt(new Date().toISOString());
      if (isTerminalRunStatus(next.run.status)) terminal.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status check failed");
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, [runId, sources]);

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }
    terminal.current = false;
    void fetchNow();
    const timer = setInterval(() => void fetchNow(), intervalMs);
    return () => clearInterval(timer);
  }, [runId, fetchNow, intervalMs]);

  const cancel = useCallback(async () => {
    if (!runId || cancelInFlight) return;
    setCancelInFlight(true);
    try {
      const run = await sources.runStatus.cancelRun(runId);
      setPayload((prev) => (prev ? { ...prev, run } : prev));
      setError(null);
      terminal.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelInFlight(false);
    }
  }, [runId, sources, cancelInFlight]);

  return {
    payload,
    loading,
    refreshing,
    error,
    lastCheckedAt,
    cancelInFlight,
    cancel,
    refreshNow: fetchNow,
  };
}
