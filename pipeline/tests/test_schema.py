"""Schema test: the index table has exactly the contracted columns."""

from __future__ import annotations

import lancedb

from pipeline import config
from pipeline.tests.conftest import IMAGES_PER_SPECIES, SPECIES

EXPECTED_COLUMNS = ["species_id", "scientific_name", "common_name", "image_path", "embedding"]


def test_index_has_contracted_columns(pipeline_ran) -> None:
    layout, _ = pipeline_ran
    table = lancedb.connect(layout.lancedb).open_table(config.INDEX_TABLE)

    assert [field.name for field in table.schema] == EXPECTED_COLUMNS


def test_embedding_is_fixed_size_vector(pipeline_ran) -> None:
    layout, _ = pipeline_ran
    table = lancedb.connect(layout.lancedb).open_table(config.INDEX_TABLE)

    embedding_field = table.schema.field("embedding")
    assert str(embedding_field.type.value_type) == "float"
    assert embedding_field.type.list_size == 32  # HashingEmbedder dim from conftest


def test_every_catalog_species_is_indexed(pipeline_ran) -> None:
    layout, _ = pipeline_ran
    table = lancedb.connect(layout.lancedb).open_table(config.INDEX_TABLE)

    rows = table.to_arrow().to_pylist()
    indexed_species = {row["species_id"] for row in rows}
    assert indexed_species == set(SPECIES)
    # 4 images per species, minus exactly one held out, never indexed.
    assert len(rows) == len(SPECIES) * (IMAGES_PER_SPECIES - 1)
