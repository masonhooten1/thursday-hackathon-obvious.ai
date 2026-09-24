# SignalPlan

Evidence-backed startup marketing audits: scan a batch of startup websites,
detect public HubSpot integration evidence, run specialist analyses, and
produce a ranked board plus two-page, evidence-cited audit and outreach plans.

This app lives in `signalplan/` with its own dependency tree. The Chrome
extension at the repo root and the `web/`/`api/` skeleton are separate
projects. Vercel's Root Directory for this app is `signalplan`.

## Stack

Next.js 15 + TypeScript on Vercel; Supabase (invite-only email/password auth,
Postgres, private storage); Trigger.dev v4 workers with the Playwright
extension; schema-validated BYOK model adapter (OpenAI or Anthropic).

## Commands

```bash
cd signalplan
npm install
npm run lint          # ESLint
npx tsc --noEmit      # typecheck
npx vitest run        # unit + API + RLS tests
npm run build         # Next.js production build
npm run dev           # dev server
```

RLS and worker-repository tests need a real Postgres (they create scratch
databases against `TEST_DATABASE_URL`):

```bash
TEST_DATABASE_URL="postgresql://user@127.0.0.1:54322/postgres" npx vitest run
```

## Environment

See `.env.example`. `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `TRIGGER_PROJECT_REF`, and
`TRIGGER_SECRET_KEY` all have credential-free fallbacks so the code, tests,
and builds run without cloud values; the same env vars power the live
deployment once real values exist.

## Layout

- `lib/contracts/` — shared Zod contracts (frozen)
- `lib/auth/` — fail-closed session verification + workspace membership
- `lib/data/`, `lib/repositories/` — Postgres/storage adapters
- `app/api/` — the six authenticated endpoints
- `trigger/` — run-batch / run-company orchestration and module seams
- `db/schema.sql` — tables, RLS policies, same-workspace parent checks
- `tests/` — contracts, API auth, RLS cross-user, orchestration, worker repo
