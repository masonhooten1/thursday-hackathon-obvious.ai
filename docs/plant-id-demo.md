# Plant ID — eval harness and hosted demo

Evaluation and demo deployment for the identify pipeline. Spec: blueprint
art_t8aXEd4u (Verification table). Built in two passes: the reference index
ships first as a PARTIAL build (9,000 rows / 83 of 110 species), and the
ingestion pipeline re-ships a full index later — nothing here hard-codes row
counts, so the re-run is a re-deploy, not a rebuild.

## Eval harness

```bash
make eval        # runs the served identify path over every hold-out image
```

`make eval` needs, relative to the repo root:

- `data/holdout.json` — the hold-out manifest (committed).
- `data/images/<species>/<split>/<file>.jpg` — the hold-out image files
  themselves, extracted from the dataset shards by `make eval-data`
  (resumable; streams only shards holding manifest rows).
- `data/lancedb/` — the reference index (from the index release archive).
- `api/config/confidence.json` — calibrated tier thresholds.
- A Python env with torch/open_clip (see `requirements-eval.txt`) plus the
  pipeline and API requirements.

It writes `eval.json` (not committed) with top1/top5 **raw** (all hold-out
species) and **over covered species** (hold-out species present in the index),
per-species detail, p50 latency, coverage, and index provenance. With a
partial index, raw top-5 is structurally bounded by coverage — held-out
images from uncovered species miss by construction — so the CI gate reads the
covered-species number and both print on every run.

The gate (`pipeline.eval gate_decision`) fails below covered top-5 < 0.75 and
prints the achieved number either way; a missed gate is surfaced, never
hidden. Embedder fallback (DINOv2) is an orchestrator decision, not an
automatic swap (spec Risk R1).

## CI eval gate

`.github/workflows/eval.yml` runs `make eval` in CI against two release
assets: `index.tar.gz` (unpacks to `data/lancedb/` + `api/config/`) and
`holdout-images.tar.gz` (unpacks to `data/images/`). Both are cached and keyed
on the release tag (default `plantnet-eval-full-11953`; a repo admin's
`PLANT_EVAL_RELEASE` variable, if ever set, overrides it); BioCLIP 2 weights
come from the HF cache. When the ingestion pipeline re-ships the index, point
the workflow default at the new release tag — the cache key follows it.
`eval.json` is uploaded as a CI artifact on every run.

## Hosted demo

Two services on the project sandbox (`computerId: obvious`), checkout at
`/home/user/work/thursday-hackathon-obvious.ai` with `data/lancedb` and
`api/static/thumbs` in place and `.venv` installed per the repo README:

1. API on :8000 — tmux `svc-8000`, startup `scripts/demo/serve-api.sh`.
   `PLANT_API_CORS_ORIGINS` carries the web origin (the browser's identify
   fetch is cross-origin; thumbnails are plain `<img>` loads and need no
   CORS).
2. Web on :3000 — tmux `svc-3000`, startup `scripts/demo/serve-web.sh`.
   The identify client goes live at build time via
   `NEXT_PUBLIC_API_BASE=<api hosted url> corepack pnpm build` (Next inlines
   it); `corepack pnpm start` then serves the production build.

Deploy order breaks the URL chicken-and-egg: register the API first with a
placeholder CORS list, register the web app, then restart the API with
`PLANT_API_CORS_ORIGINS` set to the real web origin — the registered startup
command must already carry the final value so wake-from-sleep keeps CORS.

### Full-index refresh (pass 2)

1. Unpack the new index archive (fresh `data/lancedb`, `api/config/`,
   `api/static/thumbs`) in the demo checkout.
2. `make demo-seed` — regenerates `web/lib/api/demo-species.json` from the
   new index (mock-mode UI metadata); commit it.
3. Restart `svc-8000` (picks up the new index; the eval service builds from
   `PLANT_INDEX_DIR`-style config, no hard-coded counts).
4. `make eval` — real numbers for the full index; coverage should reach 1.0.
5. Browser-verify end-to-end again (identify < 3 s p50).

## Known limitations (partial index)

- Coverage is 83/110 hold-out species; raw accuracy under-reports retrieval
  quality until the full index lands — read `eval.json`'s covered columns.
- Species names carry GBIF author citations (e.g. "Lactuca virosa L.") and
  common names are sparse in the seeded catalog — the UI shows "common name
  not on file" where GBIF lacks vernacular names.
- Reference thumbnails missing from the archive degrade to a placeholder
  tile (`ReferenceImage` in `ResultsPanel.tsx`), never a broken image.
