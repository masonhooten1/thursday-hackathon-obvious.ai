/**
 * The search page's off-happy-path states (traveler UX task): loading,
 * empty ("no results in radius"), API error with retry, and the stale
 * banner shown while a refetch is in flight over previous results.
 * Pure presentational — every state is props-driven.
 */

interface LoadingStateProps {
  anchorLabel: string;
}

export function LoadingState({ anchorLabel }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-label="Searching"
      className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-8 text-center"
    >
      <p className="text-sm font-medium text-stone-700">Searching stays near {anchorLabel}…</p>
      <p className="text-xs text-stone-400">Radius search with live availability.</p>
    </div>
  );
}

interface EmptyStateProps {
  anchorLabel: string;
  radiusMiles: number;
  canWiden: boolean;
  onWiden: () => void;
}

export function EmptyState({ anchorLabel, radiusMiles, canWiden, onWiden }: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-label="No results"
      className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center"
    >
      <p className="text-sm font-semibold text-stone-700">
        No stays within {radiusMiles} mi of {anchorLabel}
      </p>
      <p className="max-w-xs text-xs text-stone-500">
        Every property inside the radius is booked or blocked for your dates. Try a wider radius or
        different dates.
      </p>
      {canWiden ? (
        <button
          type="button"
          onClick={onWiden}
          className="mt-1 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
        >
          Try a wider radius
        </button>
      ) : null}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      aria-label="Search failed"
      className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 p-8 text-center"
    >
      <p className="text-sm font-semibold text-red-800">Search failed</p>
      <p className="max-w-xs text-xs text-red-700">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function StaleBanner() {
  return (
    <p
      role="status"
      aria-label="Updating results"
      className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
    >
      Updating results for your new search — the list below is from your last query.
    </p>
  );
}

interface StaleErrorBannerProps {
  message: string;
  onRetry: () => void;
}

/** Error over still-valid previous results — refresh, not dead end. */
export function StaleErrorBanner({ message, onRetry }: StaleErrorBannerProps) {
  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
    >
      <span>Showing your last results — the refresh failed: {message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-red-300 px-2 py-1 font-semibold text-red-800 hover:bg-red-100"
      >
        Retry
      </button>
    </div>
  );
}
