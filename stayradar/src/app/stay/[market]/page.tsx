import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MARKETS, PROPERTIES } from "@/fixtures/properties";
import type { PropertySearchResult } from "@/lib/contracts";
import { createStayRadarClient } from "@/lib/api/client";
import { serverApiBaseUrl } from "@/lib/api/server";
import { originCopy } from "@/lib/origin-copy";
import { defaultSearchWindow } from "@/lib/dates";

/**
 * Per-market landing page (traveler UX task): server-rendered summary of
 * the market's properties (nearest to the cluster center first — the API
 * already sorts by distance), copy that varies by origin-city UTM signal,
 * and a deep link into map search centered on this market. Campaigns
 * point here: the radius does the targeting, the origin signal
 * personalizes the copy.
 */

interface MarketPageProps {
  params: Promise<{ market: string }>;
  searchParams: Promise<{ utm_source?: string; utm_campaign?: string }>;
}

export async function generateMetadata({ params }: MarketPageProps): Promise<Metadata> {
  const { market: marketId } = await params;
  const market = MARKETS.find((m) => m.id === marketId);
  return {
    title: market ? `${market.name} stays — StayRadar` : "Market — StayRadar",
    description: market
      ? `Vacation rentals in ${market.name} with real availability.`
      : "Vacation rentals with real availability.",
  };
}

export default async function MarketPage({ params, searchParams }: MarketPageProps) {
  const { market: marketId } = await params;
  const { utm_source: utmSource } = await searchParams;

  const market = MARKETS.find((m) => m.id === marketId);
  if (!market) notFound();

  const origin = originCopy(market.name, utmSource);

  let stays: PropertySearchResult[] = [];
  let errorMessage: string | null = null;
  try {
    // The search contract requires both dates — use the default window so
    // the landing summary reflects real bookable inventory.
    const window = defaultSearchWindow();
    const response = await createStayRadarClient(await serverApiBaseUrl()).search({
      latitude: market.center.latitude,
      longitude: market.center.longitude,
      radiusMiles: 25,
      checkIn: window.checkIn,
      checkOut: window.checkOut,
      guests: 2,
    });
    stays = response.results;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unexpected error";
  }

  const fallbackCount = PROPERTIES.filter((p) => p.market === market.id).length;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-xs text-stone-500">
        <Link href="/" className="hover:underline">
          ← All markets
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{market.name} stays</h1>
        <p className="text-sm text-stone-600">{origin}</p>
        <p className="text-xs text-stone-500">
          {stays.length > 0
            ? `${stays.length} stays within 25 mi of the ${market.name} cluster center`
            : `${fallbackCount} curated stays in this market`}
        </p>
      </header>

      {errorMessage ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Live availability is unavailable right now: {errorMessage}
        </p>
      ) : null}

      <Link
        href={`/?market=${market.id}&radius=25`}
        data-testid="market-search-link"
        className="self-start rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
      >
        Search {market.name} on the map
      </Link>

      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {stays.slice(0, 6).map((stay) => (
          <li key={stay.id}>
            <Link
              href={`/property/${stay.id}?market=${market.id}`}
              className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-teal-600"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                {stay.propertyType}
              </p>
              <p className="mt-1 font-semibold text-stone-900">{stay.title}</p>
              <p className="mt-1 text-xs text-stone-500">
                {stay.distanceMiles.toFixed(1)} mi from center · from ${Math.round(stay.minNightly)}
                /night
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
