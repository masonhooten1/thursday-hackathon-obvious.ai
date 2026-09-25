"""Eval-harness logic: holdout mapping, hit-at-k, summary metrics, gate.

Pure-function coverage only - the real embedder/index run happens in `make eval`,
which needs torch and the dataset; tests stay torch-free by design.
"""

import json

import pytest

from pipeline.eval import SpeciesEval, gate_decision, hit_at_k, summarize
from pipeline.holdout import load_holdout_mapping


def _row(species_id: str, **overrides) -> SpeciesEval:
    values = dict(
        species_id=species_id,
        image_path=f"{species_id}/train/x.jpg",
        status="ok",
        in_index=True,
        top1=True,
        top5=True,
        latency_ms=100,
        low_confidence=False,
    )
    values.update(overrides)
    return SpeciesEval(**values)


def test_hit_at_k_matches_within_k():
    matched = ["a", "b", "c"]
    assert hit_at_k(matched, "a", 1)
    assert hit_at_k(matched, "b", 2)
    assert not hit_at_k(matched, "c", 2)
    assert hit_at_k(matched, "c", 3)


def test_summarize_reports_coverage_beside_accuracy():
    rows = [
        _row("1", top1=True, top5=True),
        _row("2", top1=False, top5=True, latency_ms=300),
        _row("3", top1=False, top5=False),
        _row("4", in_index=False, top1=False, top5=False),
    ]
    summary = summarize(rows, n_holdout=4)
    assert summary["n_evaluated"] == 4
    assert summary["n_missing_images"] == 0
    assert summary["n_covered"] == 3
    assert summary["coverage"] == 0.75
    assert summary["top1"] == 0.25
    assert summary["top5"] == 0.5
    assert summary["covered_top1"] == pytest.approx(1 / 3)
    assert summary["covered_top5"] == pytest.approx(2 / 3)
    assert summary["p50_latency_ms"] == 100
    assert summary["low_confidence_rate"] == 0.0


def test_summarize_excludes_missing_images_from_accuracy():
    rows = [
        _row("1", top1=True, top5=True),
        _row("2", status="missing_image", top1=None, top5=None),
    ]
    summary = summarize(rows, n_holdout=2)
    assert summary["n_evaluated"] == 1
    assert summary["n_missing_images"] == 1
    assert summary["top1"] == 1.0
    assert summary["top5"] == 1.0
    assert summary["coverage"] == 0.5


def test_summarize_with_no_evaluated_rows_returns_none_metrics():
    summary = summarize([_row("1", status="missing_image", top1=None, top5=None)], n_holdout=1)
    assert summary["top1"] is None
    assert summary["covered_top5"] is None
    assert summary["p50_latency_ms"] is None
    assert summary["coverage"] == 0.0


def test_gate_decision_passes_at_threshold():
    summary = {"covered_top5": 0.8, "top5": 0.6, "coverage": 0.75}
    passed, line = gate_decision(0.75, summary)
    assert passed
    assert "PASS" in line and "0.8000" in line and "0.6000" in line


def test_gate_decision_fails_below_threshold_and_prints_real_number():
    summary = {"covered_top5": 0.62, "top5": 0.4, "coverage": 0.75}
    passed, line = gate_decision(0.75, summary)
    assert not passed
    assert "FAIL" in line and "0.6200" in line and "0.4000" in line


def test_gate_decision_zero_threshold_disables_gate():
    passed, _ = gate_decision(0.0, {"covered_top5": 0.0, "top5": 0.0, "coverage": 0.1})
    assert passed


def test_gate_decision_without_evaluated_rows_fails():
    passed, line = gate_decision(0.75, {"covered_top5": None, "top5": None, "coverage": 0.0})
    assert not passed
    assert "FAIL" in line


def test_load_holdout_mapping_reads_manifest_shape(tmp_path):
    path = tmp_path / "holdout.json"
    path.write_text(
        json.dumps(
            {
                "holdout": {
                    "1355868": {"image_path": "1355868/train/a.jpg", "split": "train"},
                    "1355932": {"image_path": "1355932/train/b.jpg", "split": "train"},
                }
            }
        ),
        encoding="utf-8",
    )
    assert load_holdout_mapping(path) == {
        "1355868": "1355868/train/a.jpg",
        "1355932": "1355932/train/b.jpg",
    }


def test_load_holdout_mapping_rejects_missing_holdout(tmp_path):
    path = tmp_path / "holdout.json"
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="holdout"):
        load_holdout_mapping(path)


def test_load_holdout_mapping_rejects_entry_without_path(tmp_path):
    path = tmp_path / "holdout.json"
    path.write_text('{"holdout": {"1355868": {"split": "train"}}}', encoding="utf-8")
    with pytest.raises(ValueError, match="image_path"):
        load_holdout_mapping(path)
