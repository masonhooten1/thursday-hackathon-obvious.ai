# thursday-hackathon-obvious.ai

Hackathon monorepo with five projects sharing the repo:

- **Campground Tonight** — last-minute campsite availability; Expo app, availability API, and shared contract in `apps/`, `services/`, and `packages/` (npm workspaces).
- **LinkedIn to Email** — Chrome (Manifest V3) extension at the repo root.
- **Plant ID from photos** — Next.js + FastAPI web app in `web/` and `api/`.
- **SignalPlan** — marketing-audit app in `signalplan/` (see `signalplan/README.md`).
- **StayRadar** — accommodation-market research shell in `stayradar/`.

---

## Campground Tonight (apps/ · services/ · packages/)

What is bookable tonight in the parks? A terrain map of national-park campgrounds with availability refreshed every 15 minutes by a polite poller and a booking deep link on every result. Spec: Obvious blueprint art_VwFCEgL3.

> **Status: catalog (milestone D2).** Scaffold, shared wire contract, Recreation.gov/RIDB adapters, CI, and the campground catalog are in place. The poller (D4) and map UI (D5) land in follow-up PRs.

### Structure

| Workspace | Path | What it is |
| --- | --- | --- |
| `@campground/shared` | `packages/shared` | Zod schemas + TypeScript types for the wire contract (`SiteType`, `Park`, `Campground`, `AvailabilitySnapshot`, `AvailabilityResponse`). Single source of truth — API and app both import it. |
| `@campground/api` | `services/api` | Hono on Node 20, better-sqlite3 in WAL mode, in-process node-cron scheduler. Owns all external requests. |
| `@campground/mobile` | `apps/mobile` | Expo + expo-router + TypeScript — iPhone, Android, and web from one codebase. |

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

API surface while the poller is pending: `GET /health` and `GET /api/availability?date=YYYY-MM-DD` (empty but contract-valid until D4 wires snapshots in).

### Conventions

- Wire-format changes go through `packages/shared/src/contract.ts` — zod schemas are the source of truth; types are inferred from them.
- Only `services/api` talks to Recreation.gov/RIDB. The future adapter keeps one request in flight per host, request spacing, an identifying User-Agent, exponential backoff on 429/5xx, and never retries a 403.
- Metadata-only mode is a designed state: if the availability endpoint proves unusable, map, filters, booking links, and an honest "availability unknown" state still ship.
- CI (`.github/workflows/campground.yml`) runs lint, typecheck, tests, and the Expo web export on every PR and push to `main`.

---

## LinkedIn to Email (Chrome MV3 extension)

A Chrome (Manifest V3) extension that resolves the LinkedIn profile you are viewing to that person's company email — one click, without leaving the page.

Bring your own enrichment key: lookups go straight from your browser to Prospeo (default) or Hunter. Your key, your credits, your account. Results are shown and copied, never stored.

> **Status: functional.** The lookup flow is implemented end to end: service-worker router, provider adapters, popup state machine, options page, and the on-profile pill. Remaining: visual QA evidence (V6, its own task) and pinning the live provider response fixture (V3, first run with a real key).

### How it works

1. While you view a profile on `linkedin.com/in/...`, the extension reads the profile URL from the address bar — it never scrapes LinkedIn's page markup.
2. One click sends that URL to the enrichment provider through the extension's service worker. Your API key is stored locally and sent only to its provider's API.
3. The company email is shown inline and in the popup, with copy-to-clipboard.

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

> **Status: scaffold.** The identify screen is a placeholder and the API only exposes `GET /health`. Ingestion, the identify endpoint, real UI states, and the eval harness land in follow-up PRs.

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

Accommodation-market research shell — Next.js (pnpm) with a fixture-backed search UI. Details in `stayradar/README.md`.

```bash
pnpm --dir stayradar install
pnpm --dir stayradar lint
pnpm --dir stayradar test
pnpm --dir stayradar build
```

---

## CI

GitHub Actions runs on every push to `main` and every PR:

- `.github/workflows/ci.yml` — extension (npm ci → Vitest → manifest check), plant-ID web (pnpm → ESLint → Vitest), plant-ID api (pip → pytest), StayRadar (pnpm → lint → Vitest → build)
- `.github/workflows/signalplan.yml` — SignalPlan (lint → tsc → Vitest with a Postgres service → Next build)
- `.github/workflows/campground.yml` — Campground Tonight (lint + typecheck + tests, plus the Expo web export with artifact upload)
