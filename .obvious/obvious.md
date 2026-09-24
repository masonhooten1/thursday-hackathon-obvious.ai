# obvious.md — thursday-hackathon-obvious.ai

## Repo status

Active monorepo scaffold: Next.js web app (`web/`), FastAPI service (`api/`), GitHub Actions
CI (`.github/workflows/ci.yml`). No ML/model code yet — ingestion, identify API, real UI
states, and the eval harness are follow-up PRs (see the project blueprint).

## Stack

- **web/** — Next.js (App Router) + TypeScript + React 19, pnpm for packages. Vitest +
  Testing Library (jsdom) for component tests, ESLint (`eslint-config-next`, flat config) for
  lint, Prettier for format.
- **api/** — FastAPI + uvicorn, Python 3.13 venv at `api/.venv`. Pytest + httpx (TestClient)
  for tests. Ruff (lint + format) is configured in the root `pyproject.toml` and pinned in
  `api/requirements-dev.txt` — not yet CI-gated.
- **CI** — web job: frozen pnpm install → `eslint .` → Vitest. api job: pip install →
  `pytest api/tests/test_health.py`. No model or dataset downloads in CI by design.

## Commands

Web (from repo root):

- `pnpm --dir web install` — install deps
- `pnpm --dir web dev` — dev server on :3000
- `pnpm --dir web lint` / `pnpm --dir web test` / `pnpm --dir web build` / `pnpm --dir web format:check`

API (from repo root):

- `python3 -m venv api/.venv && source api/.venv/bin/activate && pip install -r api/requirements.txt`
- `pytest` — full suite (root `pyproject.toml` sets `pythonpath`/`testpaths`);
  `pytest api/tests/test_health.py` for the health endpoint only
- `cd api && uvicorn app.main:app --reload` — dev server on :8000

Verify before pushing: `pnpm --dir web lint && pnpm --dir web test && pytest`.

## Handoff

- `web/app/page.tsx` is a deliberate placeholder; the four real UI states (upload,
  identifying, results, low-confidence) land with the UI PR per the blueprint.
- `api/app/main.py` only exposes `GET /health`; `/api/identify` arrives with the identify-API
  PR.
- Accuracy work (embedder, LanceDB index, thresholds) must stay web-independent — see the
  blueprint's offline-iPhone design rule. `.gitignore` already excludes model weights,
  `*.lance/`, and `eval.json`.
