"""One end-to-end case against the real sandbox index.

Skipped unless the ingest pipeline has landed its outputs (data/lancedb,
api/config/confidence.json) AND the model dependencies are installed - so CI,
which runs the mocked suite only, always skips this. Where the real run lives,
it proves the full path: BioCLIP 2 query embedding -> LanceDB cosine k-NN ->
calibrated tiers, plus exact determinism of the query embedding.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pipeline import config as pipeline_config


def _reference_images():
    """Catalog originals that are NOT the per-species hold-out (those aren't indexed)."""
    holdout = {
        entry["image_path"]
        for entry in json.loads(Path(pipeline_config.HOLDOUT_MANIFEST).read_text(encoding="utf-8"))[
            "holdout"
        ].values()
    }
    return (
        path
        for path in sorted(Path(pipeline_config.IMAGES_DIR).glob("*/*/*.jpg"))
        if path.relative_to(pipeline_config.IMAGES_DIR).as_posix() not in holdout
    )


def _pick_reference_image() -> Path:
    images = list(_reference_images())
    assert images, "real index present but no reference images on disk"
    return images[0]


def _real_index_ready() -> bool:
    lancedb_dir = Path(pipeline_config.LANCEDB_DIR)
    if not lancedb_dir.is_dir() or not any(lancedb_dir.glob("*.lance")):
        return False
    if not Path(pipeline_config.CONFIDENCE_CONFIG).exists():
        return False
    try:
        import lancedb  # noqa: F401
        import open_clip  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        return False
    # The end-to-end case feeds a non-hold-out catalog ORIGINAL; an eval-only
    # checkout holds just hold-out images, which are never indexed.
    return next(_reference_images(), None) is not None


pytestmark = pytest.mark.skipif(
    not _real_index_ready(), reason="real index + BioCLIP 2 weights not present in this environment"
)


def test_real_index_identifies_a_reference_image():
    from app.main import app

    image_path = _pick_reference_image()
    image_bytes = image_path.read_bytes()

    with TestClient(app) as client:
        response = client.post(
            "/api/identify", files={"image": ("leaf.jpg", image_bytes, "image/jpeg")}
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["matches"]) == 5
    distances = [match["distance"] for match in body["matches"]]
    assert distances == sorted(distances)
    # A reference image is in its own index: near-zero distance, own species.
    assert body["matches"][0]["species_id"] == image_path.parts[-3]
    assert body["matches"][0]["distance"] < 0.02
    assert body["low_confidence"] is False
    assert body["model_version"] == pipeline_config.MODEL_VERSION


def test_real_embedder_is_deterministic():
    from app.retrieval import build_default_service

    service = build_default_service()
    image_bytes = _pick_reference_image().read_bytes()

    first = service.embed_query(image_bytes)
    second = service.embed_query(image_bytes)

    assert np.array_equal(first, second)
