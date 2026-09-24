/**
 * StayRadar demo inventory (fixture data for the static search shell).
 *
 * The real schema lands with the data-model task (Drizzle + PostGIS); these
 * fixtures mirror its property shape so components can move over unchanged.
 * Coordinates are cluster-relative approximations, good enough to place pins
 * on a map later — the lake-tahoe centroid matches the spec's campaign example.
 */

export type MarketId = "lake-tahoe" | "gatlinburg";

export type PropertyType = "cabin" | "condo" | "house";

export interface Market {
  readonly id: MarketId;
  readonly name: string;
  readonly tagline: string;
  /** Cluster centroid — becomes the campaign geo point in the marketing engine. */
  readonly center: { readonly latitude: number; readonly longitude: number };
}

export interface Property {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly market: MarketId;
  readonly propertyType: PropertyType;
  readonly maxGuests: number;
  readonly bedrooms: number;
  readonly baseNightly: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly amenities: readonly string[];
}

export const MARKETS: readonly Market[] = [
  {
    id: "lake-tahoe",
    name: "Lake Tahoe",
    tagline: "Alpine cabins and lakefront condos on the Sierra crest.",
    center: { latitude: 39.0968, longitude: -120.0324 },
  },
  {
    id: "gatlinburg",
    name: "Gatlinburg",
    tagline: "Smoky Mountain cabins minutes from the park boundary.",
    center: { latitude: 35.7143, longitude: -83.5102 },
  },
];

export const PROPERTIES: readonly Property[] = [
  {
    id: "lt-001",
    slug: "aspen-grove-cabin",
    title: "Aspen Grove Cabin",
    market: "lake-tahoe",
    propertyType: "cabin",
    maxGuests: 6,
    bedrooms: 3,
    baseNightly: 285,
    latitude: 39.0901,
    longitude: -120.0402,
    amenities: ["wifi", "fireplace", "kitchen", "hot tub"],
  },
  {
    id: "lt-002",
    slug: "lakeview-condo",
    title: "Lakeview Condo",
    market: "lake-tahoe",
    propertyType: "condo",
    maxGuests: 4,
    bedrooms: 2,
    baseNightly: 210,
    latitude: 39.1082,
    longitude: -120.0421,
    amenities: ["wifi", "kitchen", "lake access"],
  },
  {
    id: "lt-003",
    slug: "tahoe-pine-chalet",
    title: "Tahoe Pine Chalet",
    market: "lake-tahoe",
    propertyType: "cabin",
    maxGuests: 8,
    bedrooms: 4,
    baseNightly: 340,
    latitude: 39.0851,
    longitude: -120.0159,
    amenities: ["wifi", "fireplace", "ski storage", "pet-friendly"],
  },
  {
    id: "lt-004",
    slug: "northshore-lodge",
    title: "Northshore Lodge",
    market: "lake-tahoe",
    propertyType: "house",
    maxGuests: 10,
    bedrooms: 5,
    baseNightly: 425,
    latitude: 39.1103,
    longitude: -120.0087,
    amenities: ["wifi", "hot tub", "game room", "kitchen"],
  },
  {
    id: "gb-001",
    slug: "smoky-ridge-cabin",
    title: "Smoky Ridge Cabin",
    market: "gatlinburg",
    propertyType: "cabin",
    maxGuests: 4,
    bedrooms: 2,
    baseNightly: 165,
    latitude: 35.7202,
    longitude: -83.5172,
    amenities: ["wifi", "fireplace", "mountain view"],
  },
  {
    id: "gb-002",
    slug: "mountain-view-studio",
    title: "Mountain View Studio",
    market: "gatlinburg",
    propertyType: "condo",
    maxGuests: 2,
    bedrooms: 1,
    baseNightly: 120,
    latitude: 35.7233,
    longitude: -83.4955,
    amenities: ["wifi", "kitchen"],
  },
  {
    id: "gb-003",
    slug: "creekside-bungalow",
    title: "Creekside Bungalow",
    market: "gatlinburg",
    propertyType: "house",
    maxGuests: 6,
    bedrooms: 3,
    baseNightly: 230,
    latitude: 35.7058,
    longitude: -83.5241,
    amenities: ["wifi", "creek access", "pet-friendly", "porch swing"],
  },
  {
    id: "gb-004",
    slug: "panorama-lodge",
    title: "Panorama Lodge",
    market: "gatlinburg",
    propertyType: "cabin",
    maxGuests: 12,
    bedrooms: 5,
    baseNightly: 480,
    latitude: 35.7021,
    longitude: -83.4968,
    amenities: ["wifi", "hot tub", "home theater", "fireplace"],
  },
];

export function getMarket(id: string): Market | undefined {
  return MARKETS.find((market) => market.id === id);
}

export function propertiesByMarket(marketId: string): readonly Property[] {
  return PROPERTIES.filter((property) => property.market === marketId);
}
