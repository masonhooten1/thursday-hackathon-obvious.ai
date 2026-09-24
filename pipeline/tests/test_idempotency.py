"""Idempotency test: a second run produces identical row counts and embeds nothing."""

from __future__ import annotations

import lancedb

from pipeline import config
from pipeline.embedder import CountingEmbedder, HashingEmbedder
from pipeline.tests.conftest import run_pipeline


def test_second_run_identical_rows_and_no_reembedding(tiny_dataset, offline_gbif) -> None:
    counting = CountingEmbedder(HashingEmbedder(dim=32))

    layout, first = run_pipeline(tiny_dataset, embedder=counting)
    table = lancedb.connect(layout.lancedb).open_table(config.INDEX_TABLE)
    rows_first = table.count_rows()
    embedded_first = counting.embedded

    _, second = run_pipeline(tiny_dataset, embedder=counting)
    rows_second = table.count_rows()

    # Identical row counts (acceptance criterion)...
    assert rows_first == rows_second
    assert first["reference_images"] == second["reference_images"]
    # ...and the second run spent no model time: references AND hold-out were
    # all cache-hits (calibration embeddings are cached too).
    assert embedded_first == counting.embedded
