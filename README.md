# thursday-hackathon-obvious.ai

Hackathon monorepo with five projects sharing the repo:

- **Campground Tonight** — last-minute campsite availability; Expo app, availability API, and shared contract in `apps/`, `services/`, and `packages/` (npm workspaces).
- **LinkedIn to Email** — Chrome (Manifest V3) extension at the repo root.
- **Plant ID from photos** — Next.js + FastAPI web app in `web/` and `api/`.
- **SignalPlan** — marketing-audit app in `signalplan/` (see `signalplan/README.md`).
- **StayRadar** — vacation rental aggregation + radius-native marketing in `stayradar/`.

---

## Campground Tonight (apps/ · services/ · packages/)

What is bookable tonight in the parks? A terrain map of national-park campgrounds with availability refreshed every 15 minutes by a polite poller and a booking deep link on every result. Spec: Obvious blueprint art_VwFCEgL3.

> **Status: live end to end (D1–D6).** Scaffold + contract + CI (PR #9), adapters (PR #14), map app (PR #15), catalog (PR #17), and poller + availability API (PR #21) are on `main`. PR #23 wires the app to the live API, serves the web demo from the API process, and finalizes this runbook. Hosted demo: <https://0e52dligaj-8090.hosted.obvious.ai>

### Structure

| Workspace | Path | What it is |
| --- | --- | --- |
| `@campground/shared` | `packages/shared` | Zod schemas + TypeScript types for the wire contract (`SiteType`, `Park`, `Campground`, `AvailabilitySnapshot`, `AvailabilityResponse`). Single source of truth — API and app both import it. |
| `@campground/api` | `services/api` | Hono on Node 20, better-sqlite3 in WAL mode, in-process node-cron scheduler. Owns all external requests. |
| `@campground/mobile` | `apps/mobile` | Expo + expo-router + TypeScript — iPhone, Android, and web from one codebase. Map-first UI: terrain map with color-coded availability markers, type/date filters, detail sheet, booking deep links. |

### Map app and the Google Maps key

The terrain map needs a billing-enabled Google Maps Platform key, provided
through env vars and never committed — see [`docs/google-maps.md`](docs/google-maps.md).
Without a key the web build renders a labeled fallback and native builds omit
the map config; nothing fails. With `EXPO_PUBLIC_API_URL` set — same origin
(`/`) for the web demo, `http://<your-lan-ip>:8787` in Expo Go — the app reads
live snapshots from the API; unset, it falls back to fixture data (six parks,
18 campgrounds).

### Commands (from the repo root)

One install, one lockfile — the three workspaces are npm workspaces:

```bash
npm install
npm test           # extension Vitest + per-workspace smoke tests
npm run lint       # per-workspace ESLint
npm run typecheck  # per-workspace tsc --noEmit
npm run export:web --workspace=@campground/mobile   # Expo web export -> apps/mobile/dist
```

Run locally:

```bash
npm run dev --workspace=@campground/api      # API on http://localhost:8787
npm start --workspace=@campground/mobile     # Expo dev server (Expo Go / web)
```

Load the campground catalog (services/api/data/ is gitignored):

```bash
npm run seed --workspace=@campground/api     # validates seed files, replaces SQLite catalog, health-checks all 60 facility ids
```

The catalog lives in `services/api/seed/` (six parks, 60 campgrounds pulled live
from Recreation.gov) — see `services/api/seed/README.md` for provenance and
curation rules. The seeder flags dead facility ids in its output instead of
failing; re-running retries anything unverified.

### Run the live demo (one process)

Build the web export with the same-origin API and the map key, then serve the
API and the demo from one process — `SERVE_WEB_DIST` makes the API serve the
static export with an SPA fallback (see `services/api/README.md`):

```bash
EXPO_PUBLIC_API_URL=/ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=$KEY \
  npm run export:web --workspace=@campground/mobile

SERVE_WEB_DIST=../apps/mobile/dist ADMIN_POLL_SECRET=local-dev \
  npm run dev --workspace=@campground/api

# one real poll cycle now — writes snapshots for all 60 campgrounds
curl -X POST -H "Authorization: Bearer local-dev" \
  http://localhost:8787/api/admin/poll
```

Open `http://localhost:8787` for the web demo. For native, run Expo Go against
the API on your dev machine:

```bash
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8787 npm start --workspace=@campground/mobile
```

API surface: `GET /health`, `GET /api/parks`, `GET /api/campgrounds?parkId=&type=`,
`GET /api/availability?date=YYYY-MM-DD`, `POST /api/admin/poll` (bearer) — full
reference in [`services/api/README.md`](services/api/README.md).

### Conventions

- Wire-format changes go through `packages/shared/src/contract.ts` — zod schemas are the source of truth; types are inferred from them.
- Only `services/api` talks to Recreation.gov/RIDB. The availability adapter keeps one request in flight per host, request spacing, an identifying User-Agent, exponential backoff on 429/5xx, and never retries a 403.
- Metadata-only mode is a designed state: if the availability endpoint proves unusable, map, filters, booking links, and an honest "availability unknown" state still ship.
- CI (`.github/workflows/campground.yml`) runs lint, typecheck, tests, and the Expo web export on every PR and push to `main`.

---

## LinkedIn to Email (Chrome MV3 extension)

A Chrome (Manifest V3) extension that resolves the LinkedIn profile you are viewing to that person's company email — one click, without leaving the page.

Bring your own enrichment key: lookups go straight from your browser to Prospeo (default) or Hunter. Your key, your credits, your account. Results are shown and copied, never stored.

> **Status: functional.** The lookup flow is implemented end to end: service-worker router, provider adapters, popup state machine, options page, and the on-profile pill. Remaining: pinning the live provider response fixture (first run with a real key).

### How it works

1. While you view a profile on `linkedin.com/in/...`, the extension reads the profile URL from the address bar — it never scrapes LinkedIn's page markup.
2. One click sends that URL to the enrichment provider through the extension's service worker. Your API key is stored locally and sent only to its provider's API.
3. The company email is shown inline and in the popup, with copy-to-clipboard.

### Visual QA evidence (spec V6)

Captured against a local stub provider (`tests/qa/qa-stub.js`) serving the test fixtures, with a disposable extension copy built by `tests/qa/build-qa-copy.js` (endpoint overrides, a narrow localhost host permission, and a local stand-in for a profile page — test-only patches that never ship). Evidence lives in `docs/qa/`.

| Check | Popup | On-profile pill |
| --- | --- | --- |
| No key | [`tc-1-popup-nokey.png`](docs/qa/tc-1-popup-nokey.png) | [`tc-11-pill-nokey.png`](docs/qa/tc-11-pill-nokey.png) |
| Ready / idle | [`tc-2-popup-ready.png`](docs/qa/tc-2-popup-ready.png) | [`tc-7-pill-idle.png`](docs/qa/tc-7-pill-idle.png) |
| Loading | [`tc-3-popup-loading.png`](docs/qa/tc-3-popup-loading.png) | [`tc-8-pill-busy.png`](docs/qa/tc-8-pill-busy.png) |
| Found (+ copied) | [`tc-4-popup-found.png`](docs/qa/tc-4-popup-found.png) · [`tc-4b-popup-copied.png`](docs/qa/tc-4b-popup-copied.png) | [`tc-9-pill-found.png`](docs/qa/tc-9-pill-found.png) |
| Not found | [`tc-5-popup-notfound.png`](docs/qa/tc-5-popup-notfound.png) | [`tc-10-pill-miss.png`](docs/qa/tc-10-pill-miss.png) |
| Rate limited | [`tc-6-popup-ratelimited.png`](docs/qa/tc-6-popup-ratelimited.png) | [`tc-10b-pill-ratelimited.png`](docs/qa/tc-10b-pill-ratelimited.png) |
| Loads clean / key saved | [`tc-8-v1-extensions-page.png`](docs/qa/tc-8-v1-extensions-page.png) · [`tc-12-options-saved.png`](docs/qa/tc-12-options-saved.png) | click→result recorded: [`tc-8-pill-flow.webm`](docs/qa/tc-8-pill-flow.webm) |

Two loading constraints discovered while capturing: Chrome 154 rejects path-specific `web_accessible_resources` match patterns (the shipped patterns are origin-rooted), and content scripts are classic scripts — a bootstrap dynamically imports the pill modules. Both are covered by tests in `tests/qa/`.

### Load the extension unpacked

1. Clone or download this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this repo's root folder (the directory containing `manifest.json`).
5. Pin the extension and open **Options** to add your enrichment API key.

### Development

Requires Node 20+.

```bash
npm install
npm test                 # Vitest unit tests
npm run check:manifest   # validate manifest.json keys + referenced files
```

### Scope

In scope: single-profile lookup, two providers (Prospeo, Hunter), bring-your-own key, results shown but never stored. Out of scope: bulk or CSV enrichment, automated crawling, email sending, CRM sync. Automated access is against LinkedIn's ToS — this extension reads only the URL you are already viewing — and matching identities to work emails is GDPR-relevant, so use it for legitimate outreach from your own account.

---

## Plant ID from photos (web app)

A web app that names a plant from an uploaded photo. A frozen BioCLIP 2 embedder plus a reference-image index (LanceDB) does the matching — no model training. The architecture is chosen so the same embedder + index tuple can later run fully offline on iPhone (the project blueprint carries the full spec).

> **Status: identify flow live end to end.** The four identify-screen states (PR #7), the
> Pl@ntNet-300K ingestion pipeline + BioCLIP 2/LanceDB reference index (PR #10), and the
> identify API — `POST /api/identify` with calibrated confidence tiers — are on `main`.
> Remaining: the eval harness and the hosted demo.

### Web — Next.js + pnpm (Node 20+, pnpm 10)

```bash
pnpm --dir web install
pnpm --dir web dev      # http://localhost:3000
```

Checks:

```bash
pnpm --dir web lint          # ESLint (eslint-config-next, flat config)
pnpm --dir web test          # Vitest + Testing Library (jsdom)
pnpm --dir web build         # production build
pnpm --dir web format:check  # Prettier
```

### API — FastAPI (Python 3.13)

```bash
python3 -m venv api/.venv
source api/.venv/bin/activate
pip install -r api/requirements.txt
```

Run the dev server:

```bash
cd api
uvicorn app.main:app --reload   # http://localhost:8000 — OpenAPI docs at /docs
```

Tests (from the repo root):

```bash
pytest api/tests/test_health.py   # health endpoint
pytest                            # full suite
```

Lint + format (Ruff — pinned in `api/requirements-dev.txt`, not yet CI-gated):

```bash
ruff check api
ruff format --check api
```

---

## SignalPlan (signalplan/)

Marketing-audit app — Next.js 15 + TypeScript foundation with frozen Zod contracts (`signalplan/lib/contracts`), Supabase schema + RLS, fail-closed auth, and Trigger.dev v4 scaffolding. Details in `signalplan/README.md`.

```bash
cd signalplan && npm install
cd signalplan && npm run lint && npx tsc --noEmit && npx vitest run && npm run build
```

RLS + worker-repo tests need real Postgres:

```bash
TEST_DATABASE_URL="postgresql://user@127.0.0.1:54322/postgres" npx vitest run   # from signalplan/
```

---

## StayRadar (stayradar/)

Vacation rental aggregation with radius-native marketing: a map-first Next.js app (pnpm, TypeScript, Tailwind v4) for finding stays with real, date-keyed availability — Postgres 16 + PostGIS `ST_DWithin` radius search over 40 seeded properties across four markets — plus a marketing engine that turns first-party search behavior into Google Ads–shaped radius campaigns (segments, a generator enforcing Google's 1 km proximity floor, a deterministic mock Ads client, and JSON / Google Ads Editor–style CSV export). Bookings/payments, OTA scraping, and person-level location targeting are intentionally out of scope. Full runbook and architecture one-pager in [`stayradar/README.md`](stayradar/README.md); spec: Obvious blueprint art_XasJ5Kw8.

```bash
pnpm --dir stayradar install
pnpm --dir stayradar lint
pnpm --dir stayradar test   # DB-backed integration suite needs TEST_DATABASE_URL — see stayradar/README.md
pnpm --dir stayradar build
pnpm --dir stayradar db:migrate && pnpm --dir stayradar db:seed   # needs Postgres 16 + PostGIS
```

---

## CI

GitHub Actions runs on every push to `main` and every PR:

- `.github/workflows/ci.yml` — extension (npm ci → Vitest → manifest check), plant-ID web (pnpm → ESLint → Vitest), plant-ID api (pip → pytest), StayRadar (pnpm → lint → Vitest → build)
- `.github/workflows/signalplan.yml` — SignalPlan (lint → tsc → Vitest with a Postgres service → Next build)
- `.github/workflows/campground.yml` — Campground Tonight (lint + typecheck + tests, plus the Expo web export with artifact upload)
