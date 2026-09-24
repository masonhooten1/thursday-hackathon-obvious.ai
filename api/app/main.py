"""FastAPI service entry point. The identify endpoint arrives in a later PR."""

from fastapi import FastAPI

app = FastAPI(title="Plant ID API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe: return service status."""
    return {"status": "ok"}
