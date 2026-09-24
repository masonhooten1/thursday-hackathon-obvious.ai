# thursday-hackathon-obvious.ai

Hackathon monorepo with two projects sharing the repo:

- **LinkedIn to Email** — Chrome (Manifest V3) extension at the repo root.
- **Plant ID from photos** — Next.js + FastAPI web app in `web/` and `api/`.

---

## LinkedIn to Email (Chrome MV3 extension)

A Chrome (Manifest V3) extension that resolves the LinkedIn profile you are viewing to that person's company email — one click, without leaving the page.

Bring your own enrichment key: lookups go straight from your browser to Prospeo (default) or Hunter. Your key, your credits, your account. Results are shown and copied, never stored.

> **Status: scaffold.** The manifest, CI, and tooling are in place. Placeholder files stand in for the lookup flow, popup, and options page, which land in later tasks.

### How it works

1. While you view a profile on `linkedin.com/in/...`, the extension reads the profile URL from the address bar — it never scrapes LinkedIn's page markup.
2. One click sends that URL to the enrichment provider through the extension's service worker. Your API key is stored locally and sent only to its provider's API.
3. The company email is shown inline and in the popup, with copy-to-clipboard.

### Load the extension unpacked

1. Clone or download this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this repo's root folder (the directory containing `manifest.json`).
5. Pin the extension and open **Options** to add your enrichment API key. (The options UI is a placeholder until the settings task lands.)

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

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs three jobs on every push to `main` and every PR:

- **Extension Vitest + manifest** — `npm ci`, Vitest, manifest sanity check (repo root)
- **Web lint + Vitest** — frozen pnpm install, ESLint, Vitest (`web/`)
- **API pytest** — pip install, pytest (`api/`)
