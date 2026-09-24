import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { MapPlaceholder } from "@/components/map-placeholder";
import { PropertyCard } from "@/components/property-card";
import { MARKETS, PROPERTIES } from "@/fixtures/properties";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">StayRadar</h1>
          <p className="text-sm text-stone-500">
            Vacation rentals with real availability — searched by radius.
          </p>
        </div>
        <nav className="flex gap-3 text-sm text-teal-700">
          {MARKETS.map((market) => (
            <Link
              key={market.id}
              href={`/stay/${market.id}`}
              className="hover:underline"
            >
              {market.name}
            </Link>
          ))}
        </nav>
      </header>

      <FilterBar />

      <main className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-label="Search results">
          <p className="mb-3 text-sm text-stone-500">
            {PROPERTIES.length} stays across {MARKETS.length} markets (fixture
            data)
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {PROPERTIES.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        </section>
        <aside>
          <MapPlaceholder className="h-full min-h-96" />
        </aside>
      </main>
    </div>
  );
}
