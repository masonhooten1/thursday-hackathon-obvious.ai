import { and, eq, sql } from "drizzle-orm";
import type { StayRadarDb } from "@/db";
import { availability, properties } from "@/db/schema";
import type { AvailabilityNightInput, IngestSummary, PropertyInput } from "./connector";

/**
 * Ingestion pipeline shared by every connector (spec: dedup on
 * (source, external_id), idempotent re-runs). Postgres owns dedup through
 * the unique index; upserts make re-syncs — a second seed run, a nightly
 * iCal poll, a corrected CSV — update in place and leave row counts
 * unchanged. Availability rows ride along in chunks under the parameter
 * limit.
 */

const AVAILABILITY_CHUNK = 1000;

function dedupeByExternalKey(inputs: PropertyInput[]): PropertyInput[] {
  // A single source batch containing the same (source, externalId) twice
  // would trip Postgres's "cannot affect row a second time" — last wins.
  const byKey = new Map<string, PropertyInput>();
  for (const input of inputs) {
    byKey.set(`${input.source}::${input.externalId}`, input);
  }
  return [...byKey.values()];
}

function externalKeyFilter(input: PropertyInput) {
  return and(
    eq(properties.source, input.source),
    eq(properties.externalId, input.externalId),
  );
}

/** Reference the incoming row's value in an ON CONFLICT DO UPDATE set clause. */
function excludedColumn(column: string) {
  return sql.raw(`excluded.${column}`);
}

export async function ingestProperties(
  db: StayRadarDb,
  inputs: PropertyInput[],
): Promise<IngestSummary> {
  const deduped = dedupeByExternalKey(inputs);
  let availabilityRows = 0;

  for (const input of deduped) {
    const values = {
      source: input.source,
      externalId: input.externalId,
      slug: input.slug,
      title: input.title,
      market: input.market,
      propertyType: input.propertyType,
      maxGuests: input.maxGuests,
      bedrooms: input.bedrooms,
      baseNightly: input.baseNightly,
      location: input.location,
      address: input.address,
      amenities: input.amenities,
      images: input.images,
    };
    await db
      .insert(properties)
      .values(values)
      .onConflictDoUpdate({
        target: [properties.source, properties.externalId],
        set: {
          slug: values.slug,
          title: values.title,
          market: values.market,
          propertyType: values.propertyType,
          maxGuests: values.maxGuests,
          bedrooms: values.bedrooms,
          baseNightly: values.baseNightly,
          location: values.location,
          address: values.address,
          amenities: values.amenities,
          images: values.images,
        },
      });

    if (input.availability && input.availability.length > 0) {
      availabilityRows += await upsertAvailability(db, input, input.availability);
    }
  }

  return { propertiesUpserted: deduped.length, availabilityRows };
}

async function upsertAvailability(
  db: StayRadarDb,
  input: PropertyInput,
  nights: AvailabilityNightInput[],
): Promise<number> {
  const found = await db
    .select({ id: properties.id })
    .from(properties)
    .where(externalKeyFilter(input))
    .limit(1);
  const propertyId = found[0]?.id;
  if (!propertyId) {
    throw new Error(
      `ingest: property row missing after upsert (${input.source}, ${input.externalId})`,
    );
  }

  let written = 0;
  for (let i = 0; i < nights.length; i += AVAILABILITY_CHUNK) {
    const chunk = nights.slice(i, i + AVAILABILITY_CHUNK).map((night) => ({
      propertyId,
      date: night.date,
      status: night.status,
      nightlyPrice: night.nightlyPrice,
    }));
    await db
      .insert(availability)
      .values(chunk)
      .onConflictDoUpdate({
        target: [availability.propertyId, availability.date],
        set: {
          status: excludedColumn("status"),
          nightlyPrice: excludedColumn("nightly_price"),
        },
      });
    written += chunk.length;
  }
  return written;
}
