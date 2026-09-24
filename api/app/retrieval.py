"""The accuracy tuple (embedder, index, thresholds) behind /api/identify.

Design rule from the blueprint: everything accuracy-relevant lives here, with
no web-specific dependencies, so the same tuple ports to offline on-device
serving unchanged. The HTTP layer (app.identify) only translates between
FastAPI and these calls.
"""

from __future__ import annotations

import io
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image
from pipeline import config as pipeline_config
from pipeline.embedder import BioCLIP2Embedder

from app.confidence import is_low_confidence, load_tiers, tier_for

TOP_K = 5


class NotAnImage(ValueError):
    """Uploaded bytes are not an image PIL can decode."""


class QueryEmbedder(Protocol):
    """The pipeline embedder seam, pointed at one query image at a time."""

    model_version: str

    def embed_paths(self, paths: list[Path]) -> np.ndarray: ...


@dataclass(frozen=True)
class IndexHit:
    """One nearest-neighbor row from the reference table."""

    species_id: str
    scientific_name: str
    common_name: str
    image_path: str
    distance: float


class ReferenceIndex(Protocol):
    def search(self, query: np.ndarray, k: int) -> list[IndexHit]: ...


class LanceDBReferenceIndex:
    """Cosine k-NN over the `references` table built by the ingest pipeline."""

    def __init__(self, lancedb_dir: Path, table_name: str = pipeline_config.INDEX_TABLE) -> None:
        import lancedb  # heavy import, only paid when the real index is used

        self._table = lancedb.connect(lancedb_dir).open_table(table_name)

    def search(self, query: np.ndarray, k: int) -> list[IndexHit]:
        # .metric("cosine") matches the calibrate stage's query shape exactly,
        # so the cut points in confidence.json are directly comparable to these
        # distances.
        rows = self._table.search(query).metric("cosine").limit(k).to_list()
        return [
            IndexHit(
                species_id=row["species_id"],
                scientific_name=row["scientific_name"],
                common_name=row["common_name"],
                image_path=row["image_path"],
                distance=float(row["_distance"]),
            )
            for row in rows
        ]


@dataclass(frozen=True)
class ScoredMatch:
    """An IndexHit plus its calibrated confidence tier."""

    species_id: str
    scientific_name: str
    common_name: str
    image_path: str
    distance: float
    confidence: str


@dataclass(frozen=True)
class IdentifyOutcome:
    matches: list[ScoredMatch]
    low_confidence: bool


class IdentifyService:
    """Embed a query image and rank it against the reference index.

    Tiers come verbatim from the calibration file the pipeline wrote - no cut
    points are chosen here. Stateless per request: the model, index, and tier
    config are loaded once and only read afterwards.
    """

    def __init__(self, embedder: QueryEmbedder, index: ReferenceIndex, tiers: dict) -> None:
        if tiers.get("model_version") != embedder.model_version:
            raise ValueError(
                f"calibration file is for {tiers.get('model_version')!r} "
                f"but the embedder reports {embedder.model_version!r}"
            )
        self._embedder = embedder
        self._index = index
        self._tiers = tiers
        self.model_version = embedder.model_version

    def embed_query(self, image_bytes: bytes) -> np.ndarray:
        """Embed one uploaded image; identical bytes embed identically.

        The bytes are staged to a temp file and go through the embedder's own
        embed_paths, so query vectors share the exact numeric recipe the
        reference vectors got at ingest.
        """
        with tempfile.NamedTemporaryFile(suffix=".jpg") as staged:
            staged.write(image_bytes)
            staged.flush()
            return np.asarray(self._embedder.embed_paths([Path(staged.name)])[0], dtype=np.float32)

    def identify(self, image_bytes: bytes) -> IdentifyOutcome:
        self._validate(image_bytes)
        vector = self.embed_query(image_bytes)
        matches = [
            ScoredMatch(
                species_id=hit.species_id,
                scientific_name=hit.scientific_name,
                common_name=hit.common_name,
                image_path=hit.image_path,
                distance=hit.distance,
                confidence=tier_for(hit.distance, self._tiers),
            )
            for hit in self._index.search(vector, k=TOP_K)
        ]
        best = matches[0].distance if matches else None
        low_confidence = best is None or is_low_confidence(best, self._tiers)
        return IdentifyOutcome(matches=matches, low_confidence=low_confidence)

    @staticmethod
    def _validate(image_bytes: bytes) -> None:
        """Decode-check the upload; anything PIL cannot fully decode is 415."""
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                image.load()  # open() only reads the header; load() catches truncation
        except Image.DecompressionBombError as error:
            raise NotAnImage(f"image is unreasonably large to decode: {error}") from error
        except (OSError, ValueError) as error:  # UnidentifiedImageError is an OSError
            raise NotAnImage(str(error)) from error


def build_default_service() -> IdentifyService:
    """Assemble the production tuple: BioCLIP 2 + LanceDB index + calibrated tiers."""
    return IdentifyService(
        embedder=BioCLIP2Embedder(),
        index=LanceDBReferenceIndex(pipeline_config.LANCEDB_DIR),
        tiers=load_tiers(),
    )
