"""Batched embedding with a resumable on-disk cache.

The cache is a single parquet keyed by (image_path, file_size, model_version);
a re-run embeds only new or changed images, which is what makes pipeline
re-runs cheap and idempotent.
"""

from __future__ import annotations

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .embedder import Embedder

CACHE_COLUMNS = ["image_path", "species_id", "file_size", "model_version", "embedding"]

# Checkpoint cadence: long runs survive a kill and resume from the last flush.
CHECKPOINT_EVERY = 1000


def load_cache(cache_path: Path) -> dict[tuple[str, int, str], tuple[str, list[float]]]:
    """{(image_path, file_size, model_version): (species_id, embedding)}."""
    if not cache_path.exists():
        return {}
    table = pq.read_table(cache_path, columns=CACHE_COLUMNS)
    cache: dict[tuple[str, int, str], tuple[str, list[float]]] = {}
    for row in table.to_pylist():
        key = (row["image_path"], row["file_size"], row["model_version"])
        cache[key] = (row["species_id"], row["embedding"])
    return cache


def build_embedding_cache(
    paths_by_species: dict[str, list[str]],
    images_dir: Path,
    embedder: Embedder,
    cache_path: Path,
    checkpoint_every: int = CHECKPOINT_EVERY,
) -> Path:
    """Embed every image in paths_by_species, reusing cached vectors."""
    cache = load_cache(cache_path)

    pending: list[tuple[str, str, Path]] = []  # (image_path, species_id, abs path)
    for species, relative_paths in sorted(paths_by_species.items()):
        for relative in relative_paths:
            absolute = images_dir / relative
            key = (relative, absolute.stat().st_size, embedder.model_version)
            if key not in cache:
                pending.append((relative, species, absolute))

    if pending:
        for start in range(0, len(pending), checkpoint_every):
            chunk = pending[start : start + checkpoint_every]
            vectors = embedder.embed_paths([absolute for _, _, absolute in chunk])
            for (relative, species, absolute), vector in zip(chunk, vectors, strict=True):
                key = (relative, absolute.stat().st_size, embedder.model_version)
                cache[key] = (species, vector.tolist())
            save_cache(cache, cache_path)

    return cache_path


def save_cache(
    cache: dict[tuple[str, int, str], tuple[str, list[float]]], cache_path: Path
) -> None:
    rows = [
        {
            "image_path": image_path,
            "species_id": species_id,
            "file_size": file_size,
            "model_version": model_version,
            "embedding": embedding,
        }
        for (image_path, file_size, model_version), (species_id, embedding) in sorted(cache.items())
    ]
    first = rows[0]["embedding"] if rows else [0.0]
    table = pa.Table.from_pylist(rows, schema=_cache_schema(len(first)))
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_path.with_suffix(cache_path.suffix + ".tmp")
    pq.write_table(table, tmp)
    tmp.replace(cache_path)


def _cache_schema(dim: int) -> pa.Schema:
    return pa.schema(
        [
            ("image_path", pa.string()),
            ("species_id", pa.string()),
            ("file_size", pa.int64()),
            ("model_version", pa.string()),
            ("embedding", pa.list_(pa.float32(), dim)),
        ]
    )


def cache_rows(
    cache_path: Path,
    model_version: str,
) -> list[tuple[str, str, list[float]]]:
    """(image_path, species_id, embedding) rows for one embedder version."""
    table = pq.read_table(cache_path, columns=CACHE_COLUMNS)
    return [
        (row["image_path"], row["species_id"], row["embedding"])
        for row in table.to_pylist()
        if row["model_version"] == model_version
    ]
