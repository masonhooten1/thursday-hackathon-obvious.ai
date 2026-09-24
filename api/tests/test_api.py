"""Contract cases for POST /api/identify (blueprint Verification table).

The embedder is a deterministic stub and the reference index is a real (tiny)
LanceDB table built by the pipeline's own writer, so the production search
path - cosine metric, limit, distance field - is exercised without torch.
"""

from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pipeline.index_writer import write_index

from app.confidence import load_tiers
from app.identify import MAX_UPLOAD_BYTES, get_service
from app.main import STATIC_DIR, app
from app.retrieval import IdentifyService, LanceDBReferenceIndex

DIM = 8
NOT_PLANT_AXIS = 3
MODEL_VERSION = "stub-test"

# (species_id, scientific_name, common_name, reference tint). Two species share
# the red tint - similar-looking species is realistic, and it guarantees an
# empty-common-name row lands inside the top-5 of a red query.
SPECIES = [
    ("100001", "Acer rubrum", "red maple", 0),
    ("100002", "Quercus robur", "English oak", 1),
    ("100003", "Platanus racemosa", "", 0),
]

# Calibrated-cut fixture: near matches land "high", the non-flora query's
# 1.0 distance lands past low_confidence_below.
TIERS = {"high_below": 0.25, "medium_below": 0.6}


def _jpeg(tint: int | None) -> bytes:
    """Tiny real JPEG; a tint makes one channel dominant, None stays near-gray."""
    array = np.full((16, 16, 3), 40, dtype=np.uint8)
    if tint is not None:
        array[:, :, tint] = 220
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, "JPEG")
    return buffer.getvalue()


def _write_jpeg(directory: Path, name: str, tint: int | None) -> Path:
    path = directory / name
    path.write_bytes(_jpeg(tint))
    return path


class ChannelEmbedder:
    """Deterministic stub: dominant channel -> one of four fixed unit vectors.

    The fourth direction matches nothing in the fixture index, so an untinted
    (near-gray) query behaves like a non-flora photo.
    """

    model_version = MODEL_VERSION
    dim = DIM

    def embed_paths(self, paths: list[Path]) -> np.ndarray:
        vectors = np.zeros((len(paths), DIM), dtype=np.float32)
        for position, path in enumerate(paths):
            means = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32).mean(axis=(0, 1))
            ordered = sorted(means, reverse=True)
            dominant = int(np.argmax(means)) if ordered[0] - ordered[1] > 20 else NOT_PLANT_AXIS
            vectors[position, dominant] = 1.0
        return vectors


def _write_tiers(path: Path) -> None:
    payload = {
        "version": 1,
        "metric": "cosine_distance",
        "model_version": MODEL_VERSION,
        "high_below": TIERS["high_below"],
        "medium_below": TIERS["medium_below"],
        "low_confidence_below": TIERS["medium_below"],
        "calibration": {
            "source": "test fixture",
            "n_holdout": 6,
            "high_percentile": 50,
            "medium_percentile": 95,
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


@pytest.fixture
def service(tmp_path: Path) -> IdentifyService:
    """The accuracy tuple under test: stub embedder + real tiny LanceDB index."""
    embedder = ChannelEmbedder()
    rows = []
    for species_id, scientific_name, common_name, tint in SPECIES:
        vector = embedder.embed_paths([_write_jpeg(tmp_path, f"ref-{species_id}", tint)])[0]
        for copy in range(2):  # two reference images per species
            rows.append(
                (
                    species_id,
                    scientific_name,
                    common_name,
                    f"api/static/thumbs/{species_id}/ref-{copy}.jpg",
                    vector.tolist(),
                )
            )
    write_index(rows, tmp_path, "references")
    tiers_path = tmp_path / "confidence.json"
    _write_tiers(tiers_path)
    return IdentifyService(
        embedder=embedder, index=LanceDBReferenceIndex(tmp_path), tiers=load_tiers(tiers_path)
    )


@pytest.fixture
def client(service: IdentifyService):
    app.dependency_overrides[get_service] = lambda: service
    yield TestClient(app)
    app.dependency_overrides.clear()


def _post(client: TestClient, data: bytes, name: str = "leaf.jpg") -> httpx.Response:
    return client.post("/api/identify", files={"image": (name, data, "image/jpeg")})


def test_valid_image_returns_five_matches_nearest_first(client: TestClient):
    response = _post(client, _jpeg(0))

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"matches", "model_version", "latency_ms", "low_confidence"}
    assert body["model_version"] == MODEL_VERSION
    assert isinstance(body["latency_ms"], int)
    assert body["low_confidence"] is False

    matches = body["matches"]
    assert len(matches) == 5
    distances = [match["distance"] for match in matches]
    assert distances == sorted(distances)  # nearest-first
    assert sorted(match["species_id"] for match in matches[:4]) == [
        "100001",
        "100001",
        "100003",
        "100003",
    ]  # the four zero-distance rows; ties within a distance have no guaranteed order
    assert matches[0]["confidence"] == "high"
    assert matches[-1]["confidence"] == "low"

    assert set(matches[0]) == {
        "species_id",
        "scientific_name",
        "common_name",
        "distance",
        "confidence",
        "reference_image",
    }
    # The index's repo-relative thumbnail path is returned verbatim.
    assert matches[0]["reference_image"] == "api/static/thumbs/100001/ref-0.jpg"
    platanus = next(match for match in matches if match["species_id"] == "100003")
    assert platanus["common_name"] is None  # empty common name -> contract null


def test_non_image_returns_415(client: TestClient):
    response = _post(client, b"definitely not an image", name="notes.txt")

    assert response.status_code == 415


def test_oversized_upload_returns_413(client: TestClient):
    response = _post(client, b"\0" * (MAX_UPLOAD_BYTES + 1))

    assert response.status_code == 413


def test_non_flora_query_reports_low_confidence(client: TestClient):
    response = _post(client, _jpeg(None))  # near-gray: matches no reference species

    assert response.status_code == 200
    body = response.json()
    # Ranking is the API's job; refusing to rank is the UI's low-confidence state.
    assert len(body["matches"]) == 5
    assert body["low_confidence"] is True
    assert all(match["confidence"] == "low" for match in body["matches"])


def test_identify_is_deterministic(client: TestClient, service: IdentifyService, tmp_path: Path):
    first = _post(client, _jpeg(0)).json()
    second = _post(client, _jpeg(0)).json()

    first.pop("latency_ms"), second.pop("latency_ms")
    assert first == second

    # The eval harness embeds the same image twice and compares vectors.
    leaf = _write_jpeg(tmp_path, "leaf.jpg", 0)
    assert np.array_equal(
        service.embed_query(leaf.read_bytes()), service.embed_query(leaf.read_bytes())
    )


def test_reference_thumbnail_is_served(client: TestClient):
    relative = "thumbs/100001/ref-0.jpg"
    thumb = STATIC_DIR / relative
    thumb.parent.mkdir(parents=True, exist_ok=True)
    thumb.write_bytes(_jpeg(0))
    try:
        # The verbatim reference_image path resolves against the /api/static mount.
        response = client.get(f"/api/static/{relative}")
        assert response.status_code == 200
    finally:
        shutil.rmtree(STATIC_DIR / "thumbs" / "100001", ignore_errors=True)
