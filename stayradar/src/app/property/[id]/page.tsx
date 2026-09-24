import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PropertyDetailView } from "@/components/property/property-detail-view";
import { MARKETS } from "@/fixtures/properties";
import { ApiClientError, createStayRadarClient } from "@/lib/api/client";
import { serverApiBaseUrl } from "@/lib/api/server";

/**
 * Property detail page (traveler UX task): fetches the contract-validated
 * detail + calendar response server-side and hands it to the view. API
 * failures render an honest error page, not a fake property.
 */

interface PropertyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ market?: string }>;
}

export async function generateMetadata({ params }: PropertyPageProps): Promise<Metadata> {
  await params;
  return {
    title: "Stay details — StayRadar",
    description: "Availability calendar and direct inquiry for this stay.",
  };
}

export default async function PropertyPage({ params, searchParams }: PropertyPageProps) {
  const { id } = await params;
  const { market: marketParam } = await searchParams;

  try {
    // Server components fetch the deployment's own API surface, which needs
    // an absolute origin (serverApiBaseUrl) — same client the browser uses.
    const client = createStayRadarClient(await serverApiBaseUrl());
    const detail = await client.propertyDetail(id);
    const market =
      MARKETS.find((m) => m.id === marketParam) ??
      MARKETS.find((m) => m.id === detail.property.market);
    return <PropertyDetailView detail={detail} market={market} />;
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "not_found") notFound();
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-stone-50 p-8 text-center">
        <p role="alert" className="text-sm font-semibold text-red-800">
          Could not load this stay
        </p>
        <p className="max-w-sm text-xs text-stone-600">
          {error instanceof ApiClientError ? error.message : "Something went wrong."}
        </p>
      </main>
    );
  }
}
