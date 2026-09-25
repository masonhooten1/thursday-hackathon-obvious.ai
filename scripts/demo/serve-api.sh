#!/bin/bash
# Serve the identify API for the hosted demo (tmux session svc-8000).
#
# Expects the repo checkout at the path below with data/lancedb populated and
# .venv installed (see docs/plant-id-demo.md). PLANT_API_CORS_ORIGINS is a
# comma-separated allow-list of web origins; empty means CORS off.
set -euo pipefail

PLANT_DEMO_ROOT="${PLANT_DEMO_ROOT:-/home/user/work/thursday-hackathon-obvious.ai}"
cd "$PLANT_DEMO_ROOT"

export PYTHONPATH=".:api"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir api
