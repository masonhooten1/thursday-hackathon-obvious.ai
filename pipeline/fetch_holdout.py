"""Materialize the hold-out eval images from the source dataset shards.

The ingestion stream deletes shards after extraction to stay inside the disk
budget, so a fresh sandbox holds no dataset images. Evaluation needs exactly
the one hold-out image per species named in data/holdout.json; this driver
streams shards one at a time, keeps only manifest-matching rows, and deletes
each shard. Progress checkpoints to data/holdout-fetch-state.json, so a re-run
neither re-downloads nor re-scans processed shards.

    .venv/bin/python -m pipeline.fetch_holdout
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from . import config, download
from .extract import ShardRow, write_row
from .holdout import load_holdout_mapping

logger = logging.getLogger(__name__)

STATE_VERSION = 1


def row_relpath(species_id: str, split: str, filename: str) -> str:
    """Path a shard row lands at under images_dir - extract.write_row's layout."""
    return f"{species_id}/{split}/{filename}"


def scan_shard(shard: Path, images_dir: Path, wanted: set[str]) -> set[str]:
    """Write every manifest-matching row of one shard; returns rel paths found.

    Mirrors extract.iter_rows' batched reading so memory stays flat, but
    filters on the exact manifest path instead of species, keeping only the
    ~n_holdout files of a shard's ~5.5k rows on disk.
    """
    import pyarrow.parquet as pq

    from .labels import label_names_from_parquet

    label_names = label_names_from_parquet(shard)
    split = shard.name.split("-", 1)[0]
    found: set[str] = set()
    parquet = pq.ParquetFile(shard)
    for batch in parquet.iter_batches(columns=["image", "label"], batch_size=256):
        images = batch.column("image")
        labels = batch.column("label").to_pylist()
        for image_struct, label in zip(images.to_pylist(), labels, strict=True):
            species_id = label_names[int(label)]
            filename = image_struct["path"] or ""
            relative = row_relpath(species_id, split, filename)
            if relative not in wanted:
                continue
            write_row(
                images_dir,
                ShardRow(
                    species_id=species_id,
                    split=split,
                    filename=filename,
                    data=image_struct["bytes"],
                ),
            )
            found.add(relative)
    return found


def _load_state(path: Path) -> tuple[set[str], set[str]]:
    """(processed shard names, found rel paths) from the checkpoint file."""
    if not path.exists():
        return set(), set()
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != STATE_VERSION:
        return set(), set()
    return set(data.get("processed", [])), set(data.get("found", []))


def _save_state(path: Path, processed: set[str], found: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"version": STATE_VERSION, "processed": sorted(processed), "found": sorted(found)},
            indent=1,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Fetch hold-out eval images from source shards.")
    parser.add_argument("--manifest", type=Path, default=config.HOLDOUT_MANIFEST)
    parser.add_argument("--images-dir", type=Path, default=config.IMAGES_DIR)
    parser.add_argument("--shards-dir", type=Path, default=config.SHARDS_DIR)
    parser.add_argument("--state", type=Path, default=config.DATA_DIR / "holdout-fetch-state.json")
    parser.add_argument("--keep-shards", action="store_true", help="keep scanned shards on disk")
    args = parser.parse_args(argv)

    mapping = load_holdout_mapping(args.manifest)
    wanted = set(mapping.values())
    on_disk = {relative for relative in wanted if (args.images_dir / relative).is_file()}
    missing = wanted - on_disk
    logger.info(
        "holdout images on disk: %d/%d (missing %d)", len(on_disk), len(wanted), len(missing)
    )
    if not missing:
        return 0

    processed, found = _load_state(args.state)
    args.shards_dir.mkdir(parents=True, exist_ok=True)  # _download_file expects the dir
    inventory = download.shard_inventory(
        config.SOURCE_REPO, config.SOURCE_REVISION, config.SOURCE_SPLITS
    )
    for name in sorted(inventory):
        if not missing:
            break
        if name in processed:
            continue
        url = config.SHARD_URL.format(
            repo=config.SOURCE_REPO, revision=config.SOURCE_REVISION, name=name
        )
        shard = download._download_file(url, args.shards_dir / name, expected_size=inventory[name])
        try:
            found |= scan_shard(shard, args.images_dir, missing)
        finally:
            if not args.keep_shards:
                shard.unlink(missing_ok=True)
        processed.add(name)
        missing = wanted - on_disk - found
        _save_state(args.state, processed, found)
        logger.info("%s: scan done, %d holdout images still missing", name, len(missing))

    if missing:
        for relative in sorted(missing):
            logger.error("holdout image not found in any shard: %s", relative)
        return 1
    logger.info("all %d holdout images on disk", len(wanted))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
