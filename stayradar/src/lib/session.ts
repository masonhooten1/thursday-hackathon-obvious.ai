/**
 * First-party session attribution (spec art_XasJ5Kw8: "Only a rotating
 * session hash is stored — no emails in ad platforms without consent").
 * The hash is a fresh UUID per browser session (sessionStorage lifetime);
 * the last search's event id and result set let an inquiry trace back to
 * the search that produced it. All accessors are SSR-safe no-ops.
 */

const SESSION_HASH_KEY = "stayradar:session-hash";
const LAST_SEARCH_KEY = "stayradar:last-search";

export interface LastSearch {
  searchEventId: string;
  propertyIds: string[];
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null; // storage disabled — attribution degrades silently
  }
}

/** Per-session hash sent with every search (≥8 chars per the contract). */
export function getSessionHash(): string {
  const store = storage();
  if (!store) return "server-side-default-hash";
  const existing = store.getItem(SESSION_HASH_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  store.setItem(SESSION_HASH_KEY, fresh);
  return fresh;
}

export function rememberSearch(last: LastSearch): void {
  storage()?.setItem(LAST_SEARCH_KEY, JSON.stringify(last));
}

/** The search event to attribute an inquiry to, when the property was in its result set. */
export function searchEventFor(propertyId: string): string | undefined {
  const store = storage();
  if (!store) return undefined;
  const raw = store.getItem(LAST_SEARCH_KEY);
  if (!raw) return undefined;
  try {
    const last = JSON.parse(raw) as LastSearch;
    return last.propertyIds.includes(propertyId) ? last.searchEventId : undefined;
  } catch {
    return undefined;
  }
}

/** Search window to prefill an inquiry with, when the property was in the last search. */
export function lastSearchWindowFor(propertyId: string): Pick<LastSearch, "checkIn" | "checkOut" | "guests"> {
  const store = storage();
  if (!store) return {};
  const raw = store.getItem(LAST_SEARCH_KEY);
  if (!raw) return {};
  try {
    const last = JSON.parse(raw) as LastSearch;
    return last.propertyIds.includes(propertyId)
      ? { checkIn: last.checkIn, checkOut: last.checkOut, guests: last.guests }
      : {};
  } catch {
    return {};
  }
}
