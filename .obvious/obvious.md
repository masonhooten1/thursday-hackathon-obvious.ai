# obvious.md — thursday-hackathon-obvious.ai

## Repo status

Five projects share this monorepo:

1. **Campground Tonight** (`apps/mobile`, `services/api`, `packages/shared` — npm workspaces from the root):
   last-minute campsite availability on a terrain map. Expo + expo-router client, Hono API with
   better-sqlite3 (WAL) and an in-process node-cron poller, shared zod contract. Spec: Obvious
   blueprint art_VwFCEgL3. Scaffold (D1), availability/metadata adapters (D3 — live endpoint
   discovery in `docs/recreation-gov-endpoints.md`, Recreation.gov + RIDB adapters, politeness
   client), the campground catalog (D2 — versioned seed in `services/api/seed/`, seeder with
   live facility-id health checks, reproducible generator; provenance in
   `services/api/seed/README.md`), and the map app (D5 — fixture data layer, map-first screen,
   filters, detail sheet, booking links, Google Maps JS/react-native-maps integration), and
   the poller + API (D4 — snapshot store, staggered single-flight poll cycle, GET
   parks/campgrounds/availability, bearer-guarded admin trigger; see `services/api/README.md`)
   are done; RIDB live verification is pending a valid API key (see the doc). Live integration
   demo (D6) lands next; the app switches from fixtures to the API when
   `EXPO_PUBLIC_API_BASE_URL` is reachable.
2. **Chrome MV3 extension ("LinkedIn to Email")** at the repo root: `manifest.json`, the lookup
   flow (service-worker router, popup state machine, options page, on-profile pill), provider
   adapters, Vitest tooling, a manifest sanity check, and CI. Remaining: visual QA evidence (V6)
   and the live-provider response fixture (V3). Spec: art_n2m5gMDY.
3. **Plant ID web app** in `web/` (Next.js) and `api/` (FastAPI): identify screen with the four
   UI states (upload, identifying, results, low-confidence) + mock-default API client;
   `GET /health`. Ingestion pipeline lives in `pipeline/` (merged, PR #10); the identify API
   and eval harness are follow-up PRs (blueprint art_t8aXEd4u).
4. **SignalPlan** in `signalplan/`: Next.js 15 + TypeScript foundation — frozen Zod contracts
   (`lib/contracts`), Supabase schema + RLS, fail-closed auth, six authenticated API routes,
   Trigger.dev v4 scaffolding. Spec: art_zjmuRNQY.
5. **StayRadar** in `stayradar/`: Next.js (pnpm) search shell with fixtures, plus a
   Drizzle/PostGIS data layer (`properties` with a geography column + GiST
   index, date-keyed `availability`, `search_events`, `leads`, `campaigns`),
   an `ST_DWithin` radius search service, and seed/iCal/CSV ingestion
   connectors with idempotent upserts.

## Stack

- **Campground Tonight** — npm workspaces (`apps/*`, `services/*`, `packages/*`) on the root
  lockfile. Expo SDK 57 (React Native + TypeScript), Hono + @hono/node-server on Node 20,
  better-sqlite3 12.x in WAL mode (v13 dropped Node 20), node-cron in-process, zod v4, Vitest per
  workspace, ESLint flat configs per workspace.
- **Extension (repo root)** — Chrome Manifest V3, vanilla JS ES modules, no bundler. Node 20
  tooling; Vitest for unit tests; no runtime dependencies. npm + `package-lock.json`.
- **web/** — Next.js (App Router) + TypeScript + React 19, pnpm for packages. Vitest + Testing
  Library (jsdom) for component tests, ESLint (`eslint-config-next`, flat config), Prettier.
- **api/** — FastAPI + uvicorn, Python 3.13 venv at `api/.venv`. Pytest + httpx (TestClient).
  Ruff (lint + format) in the root `pyproject.toml`, pinned in `api/requirements-dev.txt` — not
  yet CI-gated.
- **SignalPlan** — own package-lock and CI workflow; RLS tests need real Postgres.
- **StayRadar** — own pnpm lockfile; built in the shared `ci.yml` lane.
- **CI** — `.github/workflows/ci.yml` (extension + web + api + stayradar),
  `.github/workflows/signalplan.yml` (lint → tsc → Vitest with a Postgres service → Next build),
  `.github/workflows/campground.yml` (lint + typecheck + tests + Expo web export).

## Commands

Campground Tonight (from repo root; one `npm install` covers root + all three workspaces):

- `npm test` — extension Vitest, then per-workspace smoke tests
- `npm run lint` / `npm run typecheck` — per-workspace fan-out
- `npm run export:web --workspace=@campground/mobile` — Expo web export to `apps/mobile/dist`
- `GOOGLE_MAPS_API_KEY` (native config) and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (web bundle) supply
  the terrain map key — see `docs/google-maps.md`; builds work without it (labeled web fallback)
- `npm run dev --workspace=@campground/api` — API on :8787 (scheduler armed, poll cadence 15 min)
- `npm start --workspace=@campground/api` — one-shot run without the watch loop
- `npm run seed --workspace=@campground/api` — load `services/api/seed/*.json` into SQLite
  (catalog tables replaced atomically), health-checking every facility id against the live
  booking page (spaced GETs); dead ids are flagged in output, never a failure
- Manual poll trigger (requires ADMIN_POLL_SECRET at server start):
  `curl -X POST -H "Authorization: Bearer $ADMIN_POLL_SECRET" http://localhost:8787/api/admin/poll`
  — runs one full cycle and returns its report (polled/succeeded/failed/pruned)
- `npm start --workspace=@campground/mobile` — Expo dev server

Extension (repo root):

- `npm install`
- `npm test`
- `npm run check:manifest`

Web (from repo root):

- `pnpm --dir web install` / `pnpm --dir web dev` (:3000)
- `pnpm --dir web lint` / `pnpm --dir web test` / `pnpm --dir web build` / `pnpm --dir web format:check`

API (from repo root):

- `python3 -m venv api/.venv && source api/.venv/bin/activate && pip install -r api/requirements.txt`
- `pytest` (root `pyproject.toml` sets `pythonpath`/`testpaths`)
- `cd api && uvicorn app.main:app --reload` (:8000)

SignalPlan (from repo root):

- `cd signalplan && npm install`
- `cd signalplan && npm run lint` / `npx tsc --noEmit` / `npx vitest run` / `npm run build`
- RLS + worker-repo tests need real Postgres:
  `TEST_DATABASE_URL="postgresql://user@127.0.0.1:54322/postgres" npx vitest run` from `signalplan/`

StayRadar (from repo root):

- `pnpm --dir stayradar install` / `pnpm --dir stayradar lint` / `pnpm --dir stayradar test` / `pnpm --dir stayradar build`
- `pnpm --dir stayradar db:migrate` / `pnpm --dir stayradar db:seed` — apply
  migrations and upsert the 40-property seed inventory (idempotent); need a
  PostGIS Postgres. Integration tests run when `TEST_DATABASE_URL` is set
  (CI: `postgis/postgis:16-3.5` service container; local path in
  `stayradar/README.md`).

## Conventions & handoff

- **Contract discipline:** wire-format changes go through `packages/shared/src/contract.ts`
  (zod schemas are the source of truth; types are inferred from them). The API and the app must
  not hand-roll their own shapes.
- **Politeness:** only `services/api` touches Recreation.gov/RIDB. The availability adapter
  (D3) keeps one request in flight per host, spaces requests, sends an identifying User-Agent,
  backs off exponentially on 429/5xx, and never retries a 403 (a block is a signal, not an
  error to hammer). The poller (D4) polls the catalog sequentially with a 250 ms stagger — one
  cycle is a stroll across campgrounds, never a burst.
- **Degradation:** metadata-only mode is a designed state — if the availability endpoint proves
  unusable, ship map, filters, booking links, and an honest "availability unknown" state. In
  the API the same rule shows up as last-known data: a failing facility keeps its previous
  snapshot and is logged degraded, and the response-level `stale` flag flips only when every
  served snapshot is past twice the poll interval.
- **Vitest boundaries:** every workspace has its own `vitest.config.ts` so nothing inherits the
  root (extension) config by directory-walk; the root config stays scoped to `src/` and `tests/`
  so root `npm test` never scans `web/` or the workspaces. Root `npm test` chains extension
  Vitest + per-workspace tests — keep that chain intact when adding workspaces.
- `web/components/IdentifyScreen.tsx` implements the four UI states (upload, identifying,
  results, low-confidence) plus the error variant per the blueprint; `web/app/page.tsx` only
  mounts it.
- API access goes through the `IdentifyClient` seam in `web/lib/api/` — mock by default, live
  when `NEXT_PUBLIC_API_BASE` is set at build time.
- `api/app/main.py` only exposes `GET /health`; `/api/identify` arrives with the identify-API
  PR.
- Accuracy work (embedder, LanceDB index, thresholds) must stay web-independent — see the
  plant-ID blueprint's offline-iPhone design rule.
- SignalPlan: contracts in `signalplan/lib/contracts` are frozen; don't touch root shared files
  (package.json, ci.yml, vitest.config.ts) for SignalPlan-only changes.
- Conventional commits; CI green before merge; merge method is squash (`.obvious/config.yml`).
