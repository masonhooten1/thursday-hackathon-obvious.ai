# Plant ID from photos

A web app that names a plant from an uploaded photo. A frozen BioCLIP 2 embedder plus a
reference-image index (LanceDB) does the matching — no model training. The architecture is
chosen so the same embedder + index tuple can later run fully offline on iPhone (the project
blueprint carries the full spec).

This is a monorepo: `web/` (Next.js UI) and `api/` (FastAPI identification service).

> **Status:** scaffold. The identify screen is a placeholder and the API only exposes
> `GET /health`. Ingestion, the identify endpoint, real UI states, and the eval harness land
> in follow-up PRs.

## Setup

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

## Layout

| Path | What |
| --- | --- |
| `web/` | Next.js (App Router, TypeScript) — identify screen |
| `api/` | FastAPI service — `GET /health` now, `/api/identify` next |
| `.github/workflows/ci.yml` | CI: web lint + Vitest, api pytest |
| `.obvious/obvious.md` | Agent guidance: stack layout + dev commands |
