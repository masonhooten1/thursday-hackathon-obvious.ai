"""Confidence tiers, consumed verbatim from the calibration file.

The ingest pipeline (pipeline/calibrate.py) measures the distance cut points
from held-out retrieval distances and writes api/config/confidence.json. The
API loads that file and delegates the tier semantics to the pipeline, so a
recalibration run updates the served confidence without an API change - no cut
point is ever hardcoded here.
"""

from __future__ import annotations

from pathlib import Path

from pipeline.calibrate import load_confidence_config, tier_for_distance

# Resolved from this file's location, so the dev server's cwd doesn't matter.
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "confidence.json"


def load_tiers(path: Path = DEFAULT_CONFIG_PATH) -> dict:
    """Load and sanity-check the calibration file the pipeline wrote."""
    return load_confidence_config(path)


def tier_for(distance: float, tiers: dict) -> str:
    """Map a cosine distance onto the calibrated "high"/"medium"/"low" tier."""
    return tier_for_distance(distance, tiers)


def is_low_confidence(distance: float, tiers: dict) -> bool:
    """True past the calibrated low-confidence cut - the UI's "not sure" signal."""
    return distance > tiers["low_confidence_below"]
