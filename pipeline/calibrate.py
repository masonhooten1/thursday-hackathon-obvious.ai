"""Confidence calibration from held-out distance distributions.

The identify API consumes the emitted JSON verbatim, so the tier boundaries the
demo shows are measured from the pipeline's own retrieval distances, not picked
by hand.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

# Tier semantics, in cosine-distance terms (lower = nearer):
#   distance <= high_below    -> "high"
#   distance <= medium_below  -> "medium"
#   distance >  medium_below  -> "low" (low_confidence = true)
# p50/p95 of the hold-out best-match distances: half of known-species queries
# score "high", 95% stay at "medium" or better, and anything beyond the 95th
# percentile is treated as probably-not-in-catalog.
HIGH_PERCENTILE = 50
MEDIUM_PERCENTILE = 95

CONFIDENCE_VERSION = 1


def distance_tiers(best_distances: np.ndarray) -> dict[str, float]:
    """Cosine-distance cut points from the hold-out best-match distribution."""
    return {
        "high_below": float(np.percentile(best_distances, HIGH_PERCENTILE)),
        "medium_below": float(np.percentile(best_distances, MEDIUM_PERCENTILE)),
    }


def write_confidence_config(
    best_distances: np.ndarray,
    out_path: Path,
    model_version: str,
    holdout_manifest: Path,
    metric: str = "cosine_distance",
) -> Path:
    """Persist the calibrated tiers + provenance for the identify API."""
    if best_distances.size == 0:
        raise ValueError("no hold-out distances to calibrate from")
    tiers = distance_tiers(best_distances)
    if tiers["high_below"] >= tiers["medium_below"]:
        raise ValueError(
            "non-monotonic tiers: p50 "
            f"{tiers['high_below']:.4f} >= p95 {tiers['medium_below']:.4f}"
        )
    payload = {
        "version": CONFIDENCE_VERSION,
        "metric": metric,
        "model_version": model_version,
        "high_below": round(tiers["high_below"], 6),
        "medium_below": round(tiers["medium_below"], 6),
        "low_confidence_below": round(tiers["medium_below"], 6),
        "calibration": {
            "source": str(holdout_manifest),
            "n_holdout": int(best_distances.size),
            "high_percentile": HIGH_PERCENTILE,
            "medium_percentile": MEDIUM_PERCENTILE,
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return out_path


def load_confidence_config(path: Path) -> dict:
    """Read and sanity-check the emitted confidence config."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("metric") != "cosine_distance":
        raise ValueError(f"unsupported metric {payload.get('metric')!r} in {path}")
    if payload["high_below"] >= payload["medium_below"]:
        raise ValueError(f"non-monotonic tiers in {path}")
    return payload


def tier_for_distance(distance: float, config: dict) -> str:
    """Map a cosine distance onto the calibrated tier ("low" => low_confidence)."""
    if distance <= config["high_below"]:
        return "high"
    if distance <= config["medium_below"]:
        return "medium"
    return "low"
