"""Shared fixtures: a tiny synthetic Pl@ntNet-style dataset.

Three species x four JPEGs across two splits, written as parquet shards with
the same image/label schema (and HF class_label metadata) as the real mirror,
plus a species-names JSON. The pipeline then runs end-to-end against a tmp
layout with the deterministic HashingEmbedder - no dataset download, no torch,
no network.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from PIL import Image

from pipeline import run as run_module
from pipeline.embedder import HashingEmbedder

SPECIES = ["110000", "110001", "110002"]
IMAGES_PER_SPECIES = 4
SPLITS = ("validation", "test")


def _jpeg_bytes(rng: np.random.Generator, hue: int) -> bytes:
    """Tiny but real JPEG, tinted per species so bytes differ across images."""
    array = rng.integers(0, 60, size=(24, 32, 3), dtype=np.uint8)
    array[:, :, hue] = np.full((24, 32), 220, dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, "JPEG")
    return buffer.getvalue()


def write_shard(path: Path, rows: list[tuple[str, int, bytes]], label_names: list[str]) -> None:
    """Write one shard mimicking the HF image/class_label parquet schema."""
    schema_meta = {
        "info": {
            "features": {
                "image": {"_type": "Image"},
                "label": {"_type": "ClassLabel", "names": label_names},
            }
        }
    }
    schema = pa.schema(
        [
            ("image", pa.struct([pa.field("bytes", pa.binary()), pa.field("path", pa.string())])),
            ("label", pa.int64()),
        ],
        metadata={b"huggingface": json.dumps(schema_meta).encode("utf-8")},
    )
    table = pa.Table.from_arrays(
        [
            pa.array(
                [{"bytes": data, "path": name} for name, _, data in rows],
                type=schema.field("image").type,
            ),
            pa.array([label for _, label, _ in rows], type=pa.int64()),
        ],
        schema=schema,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path)


@pytest.fixture
def tiny_dataset(tmp_path: Path) -> Path:
    rng = np.random.default_rng(7)
    shards = tmp_path / "raw" / "shards"
    for split in SPLITS:
        rows = [
            (f"{species}_{split}_{index}.jpg", label, _jpeg_bytes(rng, label))
            for label, species in enumerate(SPECIES)
            for index in range(IMAGES_PER_SPECIES // len(SPLITS))
        ]
        write_shard(shards / f"{split}-00000-of-00001-abcdef12.parquet", rows, SPECIES)
    names = tmp_path / "raw" / "plantnet300K_species_id_2_name.json"
    names.parent.mkdir(parents=True, exist_ok=True)
    names.write_text(json.dumps({s: f"Testus {s} Hooth." for s in SPECIES}), encoding="utf-8")
    return tmp_path


@pytest.fixture
def offline_gbif(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the select stage off the network: canned common names."""
    monkeypatch.setattr(
        run_module.names, "gbif_common_name", lambda name: f"Common {name.split()[0]}"
    )


def run_pipeline(
    data_dir: Path,
    stages: tuple[str, ...] = ("select", "embed", "index", "calibrate", "thumbs"),
    embedder=None,
) -> tuple[run_module._Layout, dict]:
    """Run the pipeline against tmp paths with the test embedder."""
    layout = run_module._Layout(
        data_dir=data_dir,
        confidence_path=data_dir / "api" / "config" / "confidence.json",
        thumbs_dir=data_dir / "thumbs",
    )
    stats = run_module.run(
        stages=stages,
        layout=layout,
        min_images=2,
        max_species=3,
        splits=SPLITS,
        embedder=embedder or HashingEmbedder(dim=32),
    )
    return layout, stats


@pytest.fixture
def pipeline_ran(tiny_dataset: Path, offline_gbif: None):
    return run_pipeline(tiny_dataset)
