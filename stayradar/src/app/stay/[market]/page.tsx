import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPlaceholder } from "@/components/map-placeholder";
import { PropertyCard } from "@/components/property-card";
import { MARKETS, getMarket, propertiesByMarket } from "@/fixtures/properties";

interface MarketPageProps {
  params: Promise<{ market: string }>;
}

// Prerender the known markets at build time; unknown slugs hit notFound().
export function generateStaticParams() {
  return MARKETS.map((market) => ({ market: market.id }));
}

export default async function MarketPage({ params }: MarketPageProps) {
  const { market: marketId } = await params;
  const market = getMarket(marketId);
  if (!market) notFound();

  const stays = propertiesByMarket(marketId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-6 text-sm">
        <Link href="/" className="text-teal-700 hover:underline">
          &larr; All stays
        </Link>
      </nav>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{market.name}</h1>
        <p className="text-sm text-stone-500">{market.tagline}</p>
        <p className="mt-2 text-sm text-stone-500">
          {stays.length} stays in this market · cluster centroid{" "}
          {market.center.latitude.toFixed(4)},{" "}
          {market.center.longitude.toFixed(4)} (campaign geo point)
        </p>
      </header>
      <main className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section
          aria-label={`${market.name} stays`}
          className="grid gap-4 sm:grid-cols-2"
        >
          {stays.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              marketName={market.name}
            />
          ))}
        </section>
        <aside>
          <MapPlaceholder className="h-full min-h-96" />
        </aside>
      </main>
    </div>
  );
}
