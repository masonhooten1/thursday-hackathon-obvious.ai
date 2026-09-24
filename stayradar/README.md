# StayRadar

Vacation rental aggregation with radius-native search — see the StayRadar spec
(Obvious blueprint `art_XasJ5Kw8`) for the full architecture.

This directory is the StayRadar web app: Next.js 15 (App Router) + TypeScript
strict + Tailwind CSS, managed with pnpm. It lives alongside — and does not
touch — the Chrome extension at the repo root, the plant-ID `web/` app, or the
`api/` FastAPI service.

## Status: data model, geo search, and ingestion

The Drizzle schema (`src/db/schema.ts`) models `properties`
(geography(Point, 4326) with a GiST index), date-keyed `availability`,
`search_events`, `leads`, and `campaigns`. `searchService`
(`src/lib/services/search-service.ts`) runs index-backed `ST_DWithin` radius
search with availability-window disqualification and records a first-party
`search_events` row per query. Inventory enters only through connectors
(`src/lib/services/ingestion/`): the deterministic `SeedConnector` (40
properties across lake-tahoe / gatlinburg / austin / cape-cod with 90-day
calendars), `ICalConnector` (VEVENT → booked nights, idempotent), and
`CsvConnector` (RFC 4180 bulk import). Deduplication is on
`(source, external_id)` — re-syncs and re-seeds leave row counts unchanged.

## Commands

- `pnpm install` — install dependencies (run from this directory, or
  `pnpm --dir stayradar install` from the repo root)
- `pnpm dev` — dev server on :3000
- `pnpm lint` / `pnpm test` / `pnpm build`

Database (requires a PostGIS-enabled Postgres; see below):

- `pnpm db:migrate` — apply checked-in Drizzle migrations
- `pnpm db:seed` — upsert the 40-property seed inventory with 90-day
  availability calendars (idempotent; safe to re-run)
- `pnpm test` runs unit tests always; when `TEST_DATABASE_URL` is set it also
  runs the PostGIS integration suite (radius boundary, availability-window
  flip, iCal double-sync, dedup). CI provisions `postgis/postgis:16-3.5` as a
  service container and sets the variable.

## PostGIS provisioning

- **CI** — the `stayradar` job in `.github/workflows/ci.yml` starts
  `postgis/postgis:16-3.5` as a service container (`TEST_DATABASE_URL` is set for
  you).
- **Local** — run Postgres 16 + PostGIS in Docker when available:

  ```sh
  docker run -d --name stayradar-postgis -p 5432:5432 \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=stayradar_test \
    postgis/postgis:16
  export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/stayradar_test"
  ```

  Without Docker, install a PostGIS-enabled Postgres server (e.g.
  `postgresql-16-postgis` on Debian/Ubuntu — PostGIS 3.x works on Postgres
  16/17), create a `stayradar_test` database, and export `TEST_DATABASE_URL`
  as above. Integration tests skip cleanly when the variable is unset.
