"""POST /api/identify - a plant photo in, ranked reference matches out.

The ranking itself lives in app.retrieval (the accuracy tuple); this module is
the HTTP skin: multipart intake, the 413/415 error contract, and the response
schema the web UI's live client validates.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.retrieval import IdentifyService, NotAnImage, build_default_service

router = APIRouter()

# Wire contract: uploads over 10 MB are rejected before decoding (413 wins
# over 415 for an oversized payload, valid image or not).
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class Match(BaseModel):
    """One ranked reference photo; matches are ordered nearest-first."""

    species_id: str
    scientific_name: str
    common_name: str | None
    distance: float
    confidence: str
    reference_image: str


class IdentifyResponse(BaseModel):
    matches: list[Match]
    model_version: str
    latency_ms: int
    low_confidence: bool


_service: IdentifyService | None = None


def get_service() -> IdentifyService:
    """Lazy singleton: the BioCLIP 2 model and LanceDB index load on first use.

    Tests replace this dependency wholesale via app.dependency_overrides, so
    the model never loads under TestClient.
    """
    global _service
    if _service is None:
        _service = build_default_service()
    return _service


@router.post("/api/identify", response_model=IdentifyResponse)
def identify(
    image: Annotated[UploadFile, File(description="Plant photo, JPEG/PNG, <= 10 MB")],
    service: Annotated[IdentifyService, Depends(get_service)],
) -> IdentifyResponse:
    """Rank an uploaded photo against the reference index (top-5, nearest-first).

    Always ranks when the image decodes - refusing to rank is the UI's job,
    driven by the low_confidence flag.
    """
    if image.size is not None and image.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds the 10 MB limit")
    data = image.file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds the 10 MB limit")

    started = time.perf_counter()
    try:
        outcome = service.identify(data)
    except NotAnImage as error:
        raise HTTPException(status_code=415, detail=f"not a decodable image: {error}") from error
    return IdentifyResponse(
        matches=[
            Match(
                species_id=match.species_id,
                scientific_name=match.scientific_name,
                # The index stores "" when a species has no common name; the
                # contract type is null.
                common_name=match.common_name or None,
                distance=match.distance,
                confidence=match.confidence,
                reference_image=match.image_path,
            )
            for match in outcome.matches
        ],
        model_version=service.model_version,
        latency_ms=round((time.perf_counter() - started) * 1000),
        low_confidence=outcome.low_confidence,
    )
