import Link from "next/link";
import { getRequestDb } from "@/db/request-db";
import { listCampaigns } from "@/lib/services/marketing/campaign-service";
import { CampaignConfigSchema } from "@/lib/services/marketing/schemas";
import type { CampaignRow } from "@/db/schema";

// The console reads live campaign state — never prerender it at build time
// (there is no database during `next build`).
export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<CampaignRow["status"], string> = {
  draft: "bg-stone-200 text-stone-700",
  generated: "bg-teal-100 text-teal-800",
  exported: "bg-amber-100 text-amber-800",
};

const MARKET_LABELS: Record<string, string> = {
  "lake-tahoe": "Lake Tahoe",
  gatlinburg: "Gatlinburg",
  austin: "Austin",
  "cape-cod": "Cape Cod",
};

/**
 * Presentation-only extraction of the delivery stamp the service records
 * inside the stored config. A stored row always parsed at write time, but a
 * console must degrade honestly rather than crash if a payload ever drifts.
 */
function deliveryFields(row: CampaignRow): { client: string; resourceName: string } {
  const parsed = CampaignConfigSchema.safeParse(row.config);
  // Draft rows were never submitted through a client, so delivery is optional.
  return parsed.success
    ? (parsed.data.campaign.delivery ?? { client: "unsent", resourceName: "—" })
    : { client: "unknown", resourceName: "—" };
}

function campaignName(row: CampaignRow): string {
  const parsed = CampaignConfigSchema.safeParse(row.config);
  return parsed.success ? parsed.data.campaign.name : "unnamed (config failed validation)";
}

function utcTimestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export default async function CampaignsConsolePage() {
  const campaigns = await listCampaigns(getRequestDb());

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Campaign console</h1>
        <p className="mt-1 text-sm text-stone-500">
          Radius campaigns generated from first-party search signals — export a
          config and import it into Google Ads Editor. Campaigns are never
          delivered live; the mock client is the shipping path until a Google
          Ads developer token is approved.
        </p>
      </header>

      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <p className="font-medium">No campaigns generated yet</p>
          <p className="mt-2 text-sm text-stone-500">
            Create the first one from the API, e.g.
            <code className="ml-1 rounded bg-stone-100 px-1 py-0.5">
              POST /api/campaigns/generate {"{"}&quot;market&quot;: &quot;lake-tahoe&quot;{"}"}
            </code>
            , then reload this console.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((row) => {
            const delivery = deliveryFields(row);
            return (
              <li
                key={row.id}
                className="rounded-lg border border-stone-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {MARKET_LABELS[row.market] ?? row.market} ·{" "}
                      {Math.round(row.radiusMeters / 1609.34)} mi radius
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {campaignName(row)} · {delivery.client} client ·{" "}
                      {delivery.resourceName} · generated {utcTimestamp(row.generatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                    >
                      {row.status}
                    </span>
                    <Link
                      href={`/api/campaigns/${row.id}/export`}
                      prefetch={false}
                      className="rounded border border-teal-700 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    >
                      JSON
                    </Link>
                    <Link
                      href={`/api/campaigns/${row.id}/export?format=csv`}
                      prefetch={false}
                      className="rounded border border-teal-700 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    >
                      CSV
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
