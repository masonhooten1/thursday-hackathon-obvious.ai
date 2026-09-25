#!/bin/bash
# Serve the built web app for the hosted demo (tmux session svc-3000).
#
# Serves the production build in web/.next — rebuild with NEXT_PUBLIC_API_BASE
# set to the identify API's hosted URL so the live client is inlined (see
# docs/plant-id-demo.md).
set -euo pipefail

PLANT_DEMO_ROOT="${PLANT_DEMO_ROOT:-/home/user/work/thursday-hackathon-obvious.ai}"
cd "$PLANT_DEMO_ROOT/web"

export PORT="${PLANT_WEB_PORT:-3000}"
exec corepack pnpm start
