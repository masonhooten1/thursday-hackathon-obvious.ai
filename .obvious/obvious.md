# obvious.md — thursday-hackathon-obvious.ai

## Repo status

Two scaffolds share this monorepo:

1. **Chrome MV3 extension ("LinkedIn to Email")** at the repo root: `manifest.json`, placeholder
   source files, Vitest tooling, a manifest sanity check, and CI. Feature code — URL capture,
   provider adapters, popup/options UI — lands in later tasks; placeholders stand in until then.
   Spec: Obvious blueprint art_n2m5gMDY.
2. **Plant ID web app** in `web/` (Next.js) and `api/` (FastAPI): placeholder identify screen +
   `GET /health`. Ingestion, identify API, real UI states, and the eval harness are follow-up
   PRs (blueprint art_t8aXEd4u).

## Stack

- **Extension (repo root)** — Chrome Manifest V3, vanilla JS ES modules, no bundler. Node 20
  tooling; Vitest for unit tests; no runtime dependencies. npm + `package-lock.json`.
- **web/** — Next.js (App Router) + TypeScript + React 19, pnpm for packages. Vitest +
  Testing Library (jsdom) for component tests, ESLint (`eslint-config-next`, flat config) for
  lint, Prettier for format.
- **api/** — FastAPI + uvicorn, Python 3.13 venv at `api/.venv`. Pytest + httpx (TestClient)
  for tests. Ruff (lint + format) configured in the root `pyproject.toml`, pinned in
  `api/requirements-dev.txt` — not yet CI-gated.
- **CI** — three jobs in `.github/workflows/ci.yml`: extension (`npm ci` → Vitest →
  check:manifest), web (frozen pnpm install → ESLint → Vitest), api (pip install → pytest).
  No model or dataset downloads in CI by design.

## Commands

Extension (repo root):

- `npm install` — install dev dependencies
- `npm test` — run the Vitest suite
- `npm run check:manifest` — validate `manifest.json` (required keys, referenced files)
- Local verification: load the repo root unpacked at `chrome://extensions` (see README)

Web (from repo root):

- `pnpm --dir web install` — install deps
- `pnpm --dir web dev` — dev server on :3000
- `pnpm --dir web lint` / `pnpm --dir web test` / `pnpm --dir web build` / `pnpm --dir web format:check`

API (from repo root):

- `python3 -m venv api/.venv && source api/.venv/bin/activate && pip install -r api/requirements.txt`
- `pytest` — full suite (root `pyproject.toml` sets `pythonpath`/`testpaths`);
  `pytest api/tests/test_health.py` for the health endpoint only
- `cd api && uvicorn app.main:app --reload` — dev server on :8000

Verify before pushing: extension `npm test && npm run check:manifest`; web + api
`pnpm --dir web lint && pnpm --dir web test && pytest`.

## Handoff

- Extension: provider adapters must keep the normalized-result contract described in the
  extension project spec (Obvious blueprint art_n2m5gMDY).
- Root `vitest.config.ts` scopes root Vitest to the extension's `src/` and `tests/` so root
  `npm test` never scans `web/` — keep that boundary when adding extension tests.
- `web/app/page.tsx` is a deliberate placeholder; the four real UI states (upload,
  identifying, results, low-confidence) land with the UI PR per the blueprint.
- `api/app/main.py` only exposes `GET /health`; `/api/identify` arrives with the identify-API
  PR.
- Accuracy work (embedder, LanceDB index, thresholds) must stay web-independent — see the
  plant-ID blueprint's offline-iPhone design rule. `.gitignore` already excludes model
  weights, `*.lance/`, and `eval.json`.
