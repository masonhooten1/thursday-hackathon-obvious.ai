# Plant-ID eval harness and demo tooling (blueprint art_t8aXEd4u, Verification).
#
# `make eval` runs the served identify path - real BioCLIP 2 embedder, real
# LanceDB reference index, calibrated tiers - over every hold-out image in
# data/holdout.json and writes eval.json. The gate reads top-5 over
# index-covered species: with a partial index, raw top-5 is structurally
# bounded by coverage; both numbers print on every run. The hold-out images
# themselves come from `make eval-data`, which streams the source shards once
# and keeps only manifest rows (see pipeline/fetch_holdout.py).

PY ?= .venv/bin/python
INDEX_DIR ?= data/lancedb
CONFIDENCE_CONFIG ?= api/config/confidence.json
EVAL_OUTPUT ?= eval.json
EVAL_GATE_TOP5 ?= 0.75
EVAL_INDEX_LABEL ?=

.PHONY: eval eval-data demo-seed

demo-seed:
	PYTHONPATH=. $(PY) scripts/demo/seed_species.py

eval-data:
	$(PY) -m pipeline.fetch_holdout

eval:
	PYTHONPATH=api $(PY) -m pipeline.eval \
		--index-dir $(INDEX_DIR) \
		--confidence $(CONFIDENCE_CONFIG) \
		--output $(EVAL_OUTPUT) \
		--gate-top5 $(EVAL_GATE_TOP5) \
		$(if $(EVAL_INDEX_LABEL),--index-label '$(EVAL_INDEX_LABEL)',)
