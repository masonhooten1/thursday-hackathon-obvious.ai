"""Stream driver resume: processed shards are skipped, not re-downloaded or recounted."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np

from pipeline import stream_ingest
from pipeline.tests.conftest import _jpeg_bytes, write_shard

SHARDS = {"train-a.parquet": [0, 0, 0], "train-b.parquet": [1, 1]}
LABEL_NAMES = {0: "110000", 1: "110001"}


def _fake_download_factory(parquets_dir: Path, calls: list[str]):
    def fake_download(url: str, dest: Path, expected_size: int | None = None) -> Path:
        name = Path(dest).name
        calls.append(name)
        shutil.copy(parquets_dir / name, dest)
        return Path(dest)

    return fake_download


def test_resume_skips_processed_shards(tmp_path, monkeypatch) -> None:
    """Re-running with a checkpoint downloads and counts nothing already done."""
    parquets_dir = tmp_path / "parquets"
    shards_dir = tmp_path / "shards"
    images_dir = tmp_path / "images"
    state_path = tmp_path / "state.json"
    parquets_dir.mkdir()
    shards_dir.mkdir()

    jpeg = _jpeg_bytes(np.random.default_rng(0), 0)
    for name, labels in SHARDS.items():
        rows = [(f"{Path(name).stem}-{i}.jpg", label, jpeg) for i, label in enumerate(labels)]
        write_shard(parquets_dir / name, rows, list(LABEL_NAMES.values()))

    inventory = {name: 1 for name in SHARDS}
    monkeypatch.setattr(
        stream_ingest.download, "shard_inventory", lambda *a, **k: inventory
    )
    calls: list[str] = []
    monkeypatch.setattr(
        stream_ingest.download, "_download_file", _fake_download_factory(parquets_dir, calls)
    )

    names = sorted(SHARDS)
    counts = stream_ingest.stream_extract(names, shards_dir, images_dir, state_path)
    assert counts == {"110000": 3, "110001": 2}
    assert calls == names

    # Same state again: no downloads, no recount.
    calls.clear()
    assert stream_ingest.stream_extract(names, shards_dir, images_dir, state_path) == counts
    assert calls == []

    # Partial checkpoint: only the unprocessed shard is downloaded and counted.
    state_path.write_text(json.dumps({"processed": ["train-a.parquet"], "counts": {"110000": 3}}))
    calls.clear()
    counts3 = stream_ingest.stream_extract(names, shards_dir, images_dir, state_path)
    assert calls == ["train-b.parquet"]
    assert counts3 == {"110000": 3, "110001": 2}


def test_legacy_state_file_loads_as_counts(tmp_path) -> None:
    """A flat species map checkpoint (pre-resume format) still loads."""
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({"110000": 7}))
    processed, counts = stream_ingest._load_state(state_path)
    assert processed == []
    assert counts == {"110000": 7}
