"""Hold-out exclusion test: no held-out image ever enters the index."""

from __future__ import annotations

import json

import lancedb

from pipeline import config
from pipeline.tests.conftest import SPECIES


def _identity(image_path: str) -> tuple[str, str]:
    """(species_id, basename) - the identity shared by source and thumbnail paths."""
    return image_path.rsplit("/", 2)[-2], image_path.rsplit("/", 1)[-1]


def test_manifest_has_exactly_one_image_per_species(pipeline_ran) -> None:
    layout, _ = pipeline_ran
    manifest = json.loads(layout.holdout.read_text(encoding="utf-8"))

    assert set(manifest["holdout"]) == set(SPECIES)
    assert all(
        entry["image_path"].startswith(f"{species}/")
        for species, entry in manifest["holdout"].items()
    )


def test_no_holdout_image_appears_in_the_index(pipeline_ran) -> None:
    layout, _ = pipeline_ran
    table = lancedb.connect(layout.lancedb).open_table(config.INDEX_TABLE)

    holdout_keys = {
        _identity(entry["image_path"])
        for entry in json.loads(layout.holdout.read_text(encoding="utf-8"))["holdout"].values()
    }
    indexed_keys = {_identity(row["image_path"]) for row in table.to_arrow().to_pylist()}

    assert len(holdout_keys) == len(SPECIES)
    assert indexed_keys & holdout_keys == set(), "hold-out images leaked into the index"
