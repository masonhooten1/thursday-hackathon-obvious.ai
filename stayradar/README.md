# StayRadar

Vacation rental aggregation with radius-native marketing. Travelers search a map
for stays with real, date-keyed availability; a marketing engine turns first-party
on-site search behavior into Google Ads–shaped radius campaigns. Full product +
architecture spec: Obvious blueprint [art_XasJ5Kw8](https://app.obvious.ai/p/prj_tdFv9hH5?blueprint=art_XasJ5Kw8).

This directory is the StayRadar web app: Next.js 15 (App Router), TypeScript
strict, Tailwind CSS v4, managed with pnpm. It is one deployable — map-first
frontend, thin API routes, and a framework-free service layer — living
alongside, and not touching, the Chrome extension at the repo root and the
other projects in this monorepo.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node | 20+ | CI runs Node 22 |
| pnpm | 10.x | `packageManager` pins `pnpm@10.34.5` — `corepack prepare pnpm@10.34.5 --activate` |
| Postgres 16 + PostGIS | 16-3.5 image | required for `db:migrate`, `db:seed`, the API routes, and the integration tests — see below |

## Quick start

```sh
# 1. dependencies
pnpm --dir stayradar install

# 2. Postgres 16 + PostGIS (Docker)
docker run -d --name stayradar-postgis -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=stayradar \
  postgis/postgis:16-3.5
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/stayradar"

# 3. schema + demo inventory (both idempotent — safe to re-run)
pnpm --dir stayradar db:migrate   # applies the checked-in Drizzle migrations; enables PostGIS
pnpm --dir stayradar db:seed      # upserts 40 properties across 4 markets, 90-day calendars

# 4. dev server
pnpm --dir stayradar dev          # http://localhost:3000
```

Without a reachable Postgres the UI still boots and renders its designed
empty/error states, but every API route is DB-backed and fails until
`DATABASE_URL` points at a PostGIS-enabled server. Migrations run
`CREATE EXTENSION IF NOT EXISTS postgis` themselves — no manual extension step.

## Commands (from the repo root)

| Command | What it does |
| --- | --- |
| `pnpm --dir stayradar dev` | dev server on :3000 (Turbopack) |
| `pnpm --dir stayradar lint` | ESLint (flat config) |
| `pnpm --dir stayradar test` | Vitest — unit + component tests always; PostGIS integration suite when `TEST_DATABASE_URL` is set |
| `pnpm --dir stayradar build` | production build (no database needed — every data route is server-rendered on demand) |
| `pnpm --dir stayradar db:migrate` | apply checked-in migrations (`DATABASE_URL`) |
| `pnpm --dir stayradar db:seed` | upsert the 40-property seed inventory (`DATABASE_URL`) |
| `pnpm --dir stayradar db:generate` | generate a migration after editing `src/db/schema.ts` (drizzle-kit) |

### Testing details

The integration suite (radius boundary cases, availability-window flips,
iCal double-sync idempotency, connector dedup) runs against a real PostGIS
database and **skips cleanly** when `TEST_DATABASE_URL` is unset:

```sh
docker run -d --name stayradar-postgis-test -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=stayradar_test \
  postgis/postgis:16-3.5
export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/stayradar_test"
pnpm --dir stayradar test
```

CI does exactly this: the `stayradar` job in
[`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs
lint → Vitest → build with a `postgis/postgis:16-3.5` service container and
`TEST_DATABASE_URL` preset. Without Docker, install a PostGIS-enabled Postgres
natively (e.g. `postgresql-16-postgis` on Debian/Ubuntu), create a
`stayradar_test` database, and export `TEST_DATABASE_URL` as above.

## API surface

Every route is zod-validated at the boundary — the schemas in
`src/lib/contracts/` are the single source of truth for wire shapes (types are
inferred; nothing hand-rolls shapes) — and every non-2xx uses one error
envelope: `{ error: { code: "bad_request" | "not_found" | "internal_error", message, details? } }`.

| Route | Purpose |
| --- | --- |
| `GET /api/search` | Radius search. Query: `latitude`, `longitude`, `radiusMiles` (default 25), `checkIn`/`checkOut` (YYYY-MM-DD), `guests` (default 2), optional `propertyType` (`cabin`/`condo`/`house`) and `sessionHash`; `utm_*` params ride along as the origin-market signal. Returns nearest-first results with `distanceMiles`, cheapest in-window `minNightly`, and `availableForWindow`, plus the persisted `searchEventId` — every search records a first-party `search_events` row. |
| `GET /api/properties/[id]` | Property detail + date-keyed availability calendar. Optional `checkIn`/`checkOut` slice the window (both or neither); omitted = full calendar. Unknown id → 404. |
| `POST /api/inquiries` | Validated inquiry → `leads` row, linked back to the originating search event when `searchEventId` is supplied. 201 with the persisted lead. |
| `GET /api/campaigns` | Stored campaigns, newest first; `?market=` filters. |
| `POST /api/campaigns/generate` | Build, validate, persist, and submit a radius campaign for one market cluster. A radius below Google's 1 km proximity floor → 400; unknown market → 404. |
| `GET /api/campaigns/[id]/export` | Download the stored config as `?format=json` (default) or `?format=csv` (Google Ads Editor–style). A successful download marks the campaign exported; the stored config is re-validated before handoff. |

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | dev server, `db:migrate`, `db:seed` | Runtime Postgres connection (PostGIS required). Integration tests prefer `TEST_DATABASE_URL` when both are set. |
| `TEST_DATABASE_URL` | integration tests, CI | Isolated database for the integration suite; unset = those tests skip. |
| `STAYRADAR_SERVER_API_ORIGIN` | server components (SSR fetches) | Absolute origin for the app's internal API calls — **the one required env var for production-like runs**. Server components fetch their own deployment's routes, and without this override those nested fetches hairpin back through the public edge, which preview proxies and some load balancers refuse or serialize. Falls back to forwarded headers (localhost in direct dev). See `src/lib/api/server.ts`. |

## Architecture one-pager

Contracts → routes → services → Drizzle/PostGIS, in one deployable. The
service layer is the only writer of the database; route handlers are thin
adapters and stay replaceable.

```
src/lib/contracts/        zod schemas — every wire shape; TS types inferred from them
src/app/api/**/route.ts   thin adapters: collect input → service call → typed JSON | error envelope
src/lib/services/         all business logic, framework-free (db handle is the first argument)
  search-service.ts         ST_DWithin radius search + availability-window disqualification + search_events
  property-service.ts       detail + calendar lookup
  lead-service.ts           inquiry capture
  ingestion/                SeedConnector (curated fixtures) · ICalConnector (VEVENT → booked nights)
                            · CsvConnector (RFC 4180) — one interface, dedup on (source, external_id)
  marketing/                segmentation · campaign generator · mock AdsClient · JSON/CSV export
src/db/schema.ts          Drizzle schema: properties (geography(Point,4326) + GiST index),
                          availability (date-keyed PK), search_events, leads, campaigns
src/app/                  map-first search UI (MapLibre GL on OpenStreetMap tiles), property
                          detail + availability calendar + inquiry form, /stay/[market] landing
                          pages, /campaigns console
```

The search that the whole product stands on: `ST_DWithin` over the
geography column with a GiST index — distance in meters, index-backed, not an
application-side Haversine loop. A booked date anywhere inside the requested
window disqualifies the property (`availableForWindow: false`); the cheapest
available night prices the card. The UI adds search-this-area / widen-radius
actions, and `/stay/[market]` renders each cluster sorted by distance from the
market center with copy varied by origin-city UTM signal — the radius does the
targeting, the origin signal personalizes the copy.

**Schema changes:** edit `src/db/schema.ts`, run
`pnpm --dir stayradar db:generate`, and check the new `drizzle/` folder into
git. Known quirk: drizzle-kit double-quotes custom-type names in generated
SQL — unquote `geography(point, 4326)` in new statements before committing
(details in `drizzle.config.ts`). Apply with `db:migrate`; drizzle-kit apply
alone would miss the PostGIS extension step.

## Marketing engine

First-party and radius-native: the radius targets the property cluster, and
personalization comes from on-site behavior — never from tracking people.

- **Segments** (`src/lib/services/marketing/segmentation.ts`) — rebuilt per
  market from `search_events` and `leads`: `dateSearchers7d` (searched with
  real dates in the last 7 days — the remarketing audience),
  `browsers30d` (viewed without dates — broad-match prospecting), and
  `leadSubmitters` (the exclusion list — they belong in email follow-up, not
  paid search). Members are anonymous, rotating session hashes; no emails,
  device ids, or person-level coordinates.
- **Campaign generator** (`src/lib/services/marketing/campaign-service.ts`) —
  per market cluster, emits a Google Ads–shaped config: a `ProximityInfo` geo
  target at the cluster centroid (computed from the properties table), search
  ad copy drawn from the cluster's property mix, the market's segments as
  audience criteria, and the top origin-city UTM variants for landing-page
  personalization.
- **Validation** (`src/lib/services/marketing/schemas.ts`) — zod enforces
  Google's real limits so no invalid payload can be stored or exported:
  radius between the 1 km proximity floor and a 100 mi application cap,
  at most 15 headlines of 30 characters, at most 4 descriptions of 90
  characters.
- **AdsClient** (`src/lib/services/marketing/ads-client.ts`) — the one seam
  between StayRadar and Google Ads. `MockGoogleAdsClient` is the shipping
  path: deterministic, no network, no credentials — it records every payload
  and returns a stable synthetic resource name (hash-derived, so demos and
  tests reproduce). `LiveGoogleAdsClient` is a later swap at the same
  interface, credential-gated: it activates only with a human-approved Google
  Ads developer token plus OAuth credentials stored via the project's secrets
  flow. Nothing at the call sites changes when that swap lands.
- **Export** (`src/lib/services/marketing/export.ts`) — the real handoff
  workflow until live delivery exists: validated configs download as JSON
  (full fidelity) or a Google Ads Editor–style CSV (Headline 1–15 /
  Description 1–4 columns, one row per ad) from the `/campaigns` console or
  `/api/campaigns/[id]/export`, then import into Google Ads Editor by hand.

The [`/campaigns`](src/app/campaigns/page.tsx) console lists stored campaigns
with their status (`draft` → `generated` → `exported`) and the delivery stamp
recorded by the AdsClient.

## What is intentionally NOT here

- **No bookings or payments.** StayRadar is an aggregator with inquiry
  capture — booking and payment stay off-platform with the source.
- **No OTA scraping.** Airbnb/Vrbo/Booking APIs are partner-gated and their
  terms prohibit scraping. Inventory enters only through connectors — seed
  fixtures, iCal availability sync, CSV import — and a future PMS/partner
  feed (Guesty, Hostaway, Expedia Rapid) implements the same interface
  without touching the schema.
- **No person-level location targeting.** Campaigns target a configurable
  radius around a property cluster; personalization uses first-party,
  anonymous session signals. No third-party identity graphs, no tracking
  identifiable individuals' locations.
