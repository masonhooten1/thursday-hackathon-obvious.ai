"""Calibration test: tiers from held-out distances are monotonic and pinned."""

from __future__ import annotations

import json

from pipeline import calibrate
from pipeline.tests.conftest import SPECIES


def test_config_from_pipeline_run_is_complete_and_monotonic(pipeline_ran) -> None:
    layout, _ = pipeline_ran

    config = json.loads(layout.confidence.read_text(encoding="utf-8"))

    assert config["model_version"] == "hash-test"
    assert config["metric"] == "cosine_distance"
    assert config["calibration"]["n_holdout"] == len(SPECIES)
    assert 0.0 < config["high_below"] < config["medium_below"] < 1.0


def test_tier_for_distance_boundaries(pipeline_ran) -> None:
    layout, _ = pipeline_ran
    config = calibrate.load_confidence_config(layout.confidence)

    assert calibrate.tier_for_distance(config["high_below"], config) == "high"
    assert calibrate.tier_for_distance(config["medium_below"], config) == "medium"
    assert calibrate.tier_for_distance(config["medium_below"] + 0.01, config) == "low"


def test_distances_below_high_tier_are_high(pipeline_ran) -> None:
    layout, _ = pipeline_ran
    config = calibrate.load_confidence_config(layout.confidence)

    assert calibrate.tier_for_distance(0.0, config) == "high"


def test_loader_rejects_wrong_metric(tmp_path) -> None:
    path = tmp_path / "confidence.json"
    path.write_text(json.dumps({"metric": "l2", "high_below": 0.1, "medium_below": 0.2}))

    try:
        calibrate.load_confidence_config(path)
    except ValueError as error:
        assert "unsupported metric" in str(error)
    else:
        raise AssertionError("expected ValueError for l2 metric")
