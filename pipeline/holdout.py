"""Hold-out manifest: one eval image per species, never indexed."""

from __future__ import annotations

import json
from pathlib import Path

from .select import pick_holdout

MANIFEST_VERSION = 1


def build_holdout_manifest(
    paths_by_species: dict[str, list[str]], manifest_path: Path
) -> dict[str, str]:
    """Pick and persist the hold-out image for every species.

    The manifest maps species_id -> {image_path, split}; the pipeline filters
    these paths out before embedding, so they never enter the index.
    """
    holdout = pick_holdout(paths_by_species)
    payload = {
        "version": MANIFEST_VERSION,
        "holdout": {
            species: {"image_path": path, "split": path.split("/")[0]}
            for species, path in sorted(holdout.items())
        },
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return holdout


def load_holdout_paths(manifest_path: Path) -> set[str]:
    """Paths excluded from the index, as written by build_holdout_manifest."""
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    return {entry["image_path"] for entry in payload["holdout"].values()}


def load_holdout_mapping(manifest_path: Path) -> dict[str, str]:
    """{species_id: image_path} from the manifest, validated.

    fetch_holdout resolves these files onto disk and eval embeds them; both
    fail loudly here rather than silently evaluating an empty or malformed set.
    """
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    holdout = payload.get("holdout")
    if not isinstance(holdout, dict) or not holdout:
        raise ValueError(f"{manifest_path}: missing or empty 'holdout' mapping")
    mapping: dict[str, str] = {}
    for species, entry in holdout.items():
        image_path = entry.get("image_path") if isinstance(entry, dict) else entry
        if not isinstance(image_path, str) or not image_path:
            raise ValueError(f"{manifest_path}: holdout entry for {species!r} has no image_path")
        mapping[species] = image_path
    return mapping
