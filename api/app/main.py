"""FastAPI service entry point: health probe, identify endpoint, thumbnails."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.identify import router

app = FastAPI(title="Plant ID API", version="0.2.0")

# Mounted at /api/static so the index's verbatim repo-relative image_path
# ("api/static/thumbs/...") doubles as the servable URL the web client builds.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/api/static", StaticFiles(directory=STATIC_DIR), name="static")

app.include_router(router)


def configure_cors(application: FastAPI, origins: list[str]) -> None:
    """Allow browser clients from the listed origins; same-origin needs no CORS.

    The hosted demo serves the web app and this API from separate origins, so
    the browser's /api/identify fetch is cross-origin. Thumbnails are plain
    <img> loads and are exempt. Default (no origins) ships CORS off.
    """
    if origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )


def cors_origins_from_env() -> list[str]:
    """Comma-separated PLANT_API_CORS_ORIGINS; empty/unset means CORS off."""
    raw = os.environ.get("PLANT_API_CORS_ORIGINS", "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


configure_cors(app, cors_origins_from_env())


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe: return service status."""
    return {"status": "ok"}
