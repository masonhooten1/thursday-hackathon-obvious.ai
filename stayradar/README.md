# StayRadar

Vacation rental aggregation with radius-native search — see the StayRadar spec
(Obvious blueprint `art_XasJ5Kw8`) for the full architecture.

This directory is the StayRadar web app: Next.js 15 (App Router) + TypeScript
strict + Tailwind CSS, managed with pnpm. It lives alongside — and does not
touch — the Chrome extension at the repo root, the plant-ID `web/` app, or the
`api/` FastAPI service.

## Status: scaffold

Current state is a static search shell driven by fixture data
(`src/fixtures/properties.ts`) — no database, no API routes yet. The data
model, connectors, API layer, and marketing engine land in later tasks
(planned deps `drizzle-orm`, `drizzle-kit`, `zod`, and `maplibre-gl` are
already installed for that work).

## Commands

- `pnpm install` — install dependencies (run from this directory, or
  `pnpm --dir stayradar install` from the repo root)
- `pnpm dev` — dev server on :3000
- `pnpm lint` / `pnpm test` / `pnpm build`
