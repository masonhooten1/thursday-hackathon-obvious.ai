import Link from "next/link";
import type { PropertyDetailResponse } from "@/lib/contracts";
import type { Market } from "@/fixtures/properties";
import { haversineMiles } from "@/lib/geo";
import { AvailabilityCalendar } from "./availability-calendar";
import { InquiryForm } from "./inquiry-form";

/**
 * Server-renderable property detail (traveler UX task): photos, summary,
 * distance from the market cluster center, the 90-day availability
 * calendar from the API, and the inquiry form. Receives an already-parsed
 * PropertyDetailResponse — no API calls in the component body.
 */

interface PropertyDetailViewProps {
  detail: PropertyDetailResponse;
  /** When known, shows distance from the cluster center and market back-links. */
  market?: Market;
}

export function PropertyDetailView({ detail, market }: PropertyDetailViewProps) {
  const { property, availability } = detail;
  const distanceFromCenter = market
    ? haversineMiles(market.center, { latitude: property.latitude, longitude: property.longitude })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <nav aria-label="Breadcrumb" className="text-xs text-stone-500">
          <Link href={market ? `/?market=${market.id}` : "/"} className="hover:underline">
            ← Back to search{market ? ` — ${market.name}` : ""}
          </Link>
        </nav>

        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium uppercase tracking-wide text-stone-600">
              {property.propertyType}
            </span>
            <span className="text-stone-500">
              {property.market.replace(/-/g, " ")} · inventory source: {property.source}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">{property.title}</h1>
          <p className="text-sm text-stone-500">
            {property.address ? `${property.address} · ` : ""}
            Sleeps {property.maxGuests} · {property.bedrooms}
            {property.bedrooms === 1 ? " bedroom" : " bedrooms"}
            {distanceFromCenter !== null
              ? ` · ${distanceFromCenter.toFixed(1)} mi from the ${market?.name} cluster center`
              : ""}
          </p>
          <p className="text-sm font-semibold text-stone-900">
            from ${Math.round(property.baseNightly)}
            <span className="font-normal text-stone-500"> / night base rate</span>
          </p>
        </header>

        {property.images.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {property.images.slice(0, 4).map((src, index) => (
              // eslint-disable-next-line @next/next/no-img-element -- seed inventory uses plain remote URLs
              <img
                key={src}
                src={src}
                alt={`${property.title} photo ${index + 1}`}
                className={`h-48 w-full rounded-lg object-cover ${index === 0 ? "col-span-2" : ""}`}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-xs text-stone-500">
            Photos coming soon — this stay was imported without images.
          </div>
        )}

        <section aria-label="About this stay" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-stone-900">Amenities</h2>
          <ul role="list" className="flex flex-wrap gap-2">
            {property.amenities.map((amenity) => (
              <li
                key={amenity}
                className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700"
              >
                {amenity}
              </li>
            ))}
          </ul>
        </section>

        <AvailabilityCalendar calendar={availability} />
      </div>

      <aside className="w-full shrink-0 lg:w-96">
        <InquiryForm propertyId={property.id} />
      </aside>
    </div>
  );
}
