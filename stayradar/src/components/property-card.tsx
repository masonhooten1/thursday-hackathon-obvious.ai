import type { Property } from "@/fixtures/properties";

const AMENITY_LIMIT = 3;

interface PropertyCardProps {
  property: Property;
  marketName?: string;
}

export function PropertyCard({ property, marketName }: PropertyCardProps) {
  return (
    <article className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex h-24 items-center justify-center bg-teal-50">
        <span className="text-xs font-medium uppercase tracking-wide text-teal-800">
          {marketName ?? property.market} · {property.propertyType}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <h3 className="font-semibold text-stone-900">{property.title}</h3>
        <p className="text-sm text-stone-500">
          Sleeps {property.maxGuests} · {property.bedrooms} bedroom
          {property.bedrooms === 1 ? "" : "s"}
        </p>
        <ul className="flex flex-wrap gap-1">
          {property.amenities.slice(0, AMENITY_LIMIT).map((amenity) => (
            <li
              key={amenity}
              className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600"
            >
              {amenity}
            </li>
          ))}
        </ul>
        <p className="pt-1 text-sm font-semibold text-stone-900">
          ${property.baseNightly}
          <span className="font-normal text-stone-500"> / night base</span>
        </p>
      </div>
    </article>
  );
}
