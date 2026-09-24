import type { Metadata } from "next";
import { SearchExplorer } from "@/components/search/search-explorer";
import { MARKETS } from "@/fixtures/properties";

export const metadata: Metadata = {
  title: "Find a stay — StayRadar",
  description:
    "Map-first radius search across vacation rentals with real, date-keyed availability.",
};

/**
 * Traveler search page (traveler UX task): map-first radius search with a
 * synced results list. Reads optional ?market= / ?radius= so market
 * landing pages and campaign links can deep-link straight into a
 * centered search. The initial radius is bounded to the filter bar's
 * options; unknown values fall back to 25 mi.
 */

interface SearchPageProps {
  searchParams: Promise<{ market?: string; radius?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const radius = params.radius ? Number(params.radius) : undefined;

  return (
    <main className="flex min-h-screen flex-1 flex-col gap-4 bg-stone-50 lg:h-screen lg:overflow-hidden">
      <header className="flex items-center justify-between px-4 pt-5">
        <div>
          <p className="text-lg font-bold tracking-tight text-stone-900">StayRadar</p>
          <p className="text-xs text-stone-500">
            Radius search with real availability — no booking, no service fees.
          </p>
        </div>
      </header>
      <SearchExplorer
        markets={MARKETS}
        initialMarketId={params.market ?? null}
        initialRadiusMiles={Number.isFinite(radius) ? radius : undefined}
      />
    </main>
  );
}
