#!/usr/bin/env python3
"""Seed the web UI's demo species metadata from a reference index.

Reads the LanceDB reference table and writes web/lib/api/demo-species.json -
the catalog snapshot the mock client presents (real species ids, names, and
common names from the shipped index). Regenerate after a new index build:

    make demo-seed
"""

from __future__ import annotations

import argparse
import json
from collections import OrderedDict
from pathlib import Path

import lancedb
from pipeline import config


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index-dir", type=Path, default=config.LANCEDB_DIR)
    parser.add_argument("--output", type=Path, default=Path("web/lib/api/demo-species.json"))
    args = parser.parse_args()

    table = lancedb.connect(args.index_dir).open_table(config.INDEX_TABLE)
    arrow = table.to_arrow()
    species: OrderedDict[str, dict[str, str | None]] = OrderedDict()
    for species_id, name, common in zip(
        arrow.column("species_id").to_pylist(),
        arrow.column("scientific_name").to_pylist(),
        arrow.column("common_name").to_pylist(),
        strict=True,
    ):
        species.setdefault(
            species_id,
            {"species_id": species_id, "scientific_name": name, "common_name": common or None},
        )

    payload = {
        "model_version": config.MODEL_VERSION,
        "species": list(species.values()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(species)} species to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
