"""FastAPI service entry point: health probe, identify endpoint, thumbnails."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.identify import router

app = FastAPI(title="Plant ID API", version="0.2.0")

# Mounted at /api/static so the index's verbatim repo-relative image_path
# ("api/static/thumbs/...") doubles as the servable URL the web client builds.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/api/static", StaticFiles(directory=STATIC_DIR), name="static")

app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe: return service status."""
    return {"status": "ok"}
