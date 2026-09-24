"""Disk-frugal full ingestion: stream train shards one at a time.

The full train split is ~24 GB across 51 parquet shards - far larger than the
sandbox disk. This driver downloads one shard at a time, counts species and
extracts images (capped per species), then deletes the shard. After the stream
it selects the catalog, prunes non-catalog images, and reuses the shared
holdout -> embed -> index -> calibrate -> thumbs stages from pipeline.run.

    .venv/bin/python -m pipeline.stream_ingest --max-shards 20
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
from pathlib import Path

from . import config, download, embed, extract, holdout, select
from . import run as run_module
from .embedder import BioCLIP2Embedder, Embedder
from .labels import label_names_from_parquet

logger = logging.getLogger(__name__)


def _load_state(path: Path) -> tuple[list[str], dict[str, int]]:
    """(processed shard names, species counts) from the checkpoint file."""
    if not path.exists():
        return [], {}
    data = json.loads(path.read_text())
    if isinstance(data, dict) and "counts" in data and "processed" in data:
        return list(data["processed"]), dict(data["counts"])
    return [], dict(data)  # legacy flat species map, predates resume tracking


def _save_state(path: Path, processed: list[str], counts: dict[str, int]) -> None:
    path.write_text(
        json.dumps({"processed": processed, "counts": counts}, indent=1, sort_keys=True),
        encoding="utf-8",
    )


def stream_extract(
    shard_names: list[str],
    shards_dir: Path,
    images_dir: Path,
    state_path: Path,
    cap: int = config.REFERENCE_CAP_PER_SPECIES,
) -> dict[str, int]:
    """Download each shard, count species, extract up to cap images, delete shard.

    Checkpoints (processed shards, counts) to state_path after every shard; on
    restart, shards recorded as processed are skipped so counts neither lose
    nor double count, and nothing re-downloads.
    """
    processed, counts = _load_state(state_path)
    done = set(processed)
    inventory = download.shard_inventory(
        config.SOURCE_REPO, config.SOURCE_REVISION, config.SOURCE_SPLITS
    )
    for position, name in enumerate(shard_names):
        if name in done:
            continue
        url = config.SHARD_URL.format(
            repo=config.SOURCE_REPO, revision=config.SOURCE_REVISION, name=name
        )
        shard = download._download_file(url, shards_dir / name, expected_size=inventory[name])
        logger.info("shard %d/%d %s", position + 1, len(shard_names), name)

        label_names = label_names_from_parquet(shard)
        for row in extract.iter_rows([shard], label_names, config.SOURCE_SPLITS):
            counts[row.species_id] = counts.get(row.species_id, 0) + 1
            if counts[row.species_id] <= cap:
                extract.write_row(images_dir, row)

        done.add(name)
        _save_state(state_path, sorted(done), counts)
        shard.unlink()  # free the disk immediately

    return counts


def paths_by_species_from_disk(images_dir: Path) -> dict[str, list[str]]:
    """{species_id: [relative image paths]} for everything extracted so far."""
    paths: dict[str, list[str]] = {}
    for species_dir in sorted(p for p in images_dir.iterdir() if p.is_dir()):
        species = species_dir.name
        paths[species] = sorted(
            str(path.relative_to(images_dir))
            for path in species_dir.rglob("*")
            if path.is_file() and not path.name.endswith(".part")
        )
    return {species: found for species, found in paths.items() if found}


def prune_to_catalog(images_dir: Path, catalog: list[str]) -> int:
    """Delete extracted species outside the catalog; returns species removed."""
    keep = set(catalog)
    removed = 0
    for species_dir in sorted(images_dir.iterdir()):
        if species_dir.is_dir() and species_dir.name not in keep:
            shutil.rmtree(species_dir)
            removed += 1
    return removed


def run_stream(
    max_shards: int | None = None,
    min_images: int = config.CATALOG_MIN_IMAGES,
    max_species: int = config.CATALOG_MAX_SPECIES,
    batch_size: int = 16,
    embedder: Embedder | None = None,
) -> dict:
    """Full streaming run; returns the stats dict also printed by pipeline.run."""
    state_path = config.DATA_DIR / "stream_counts.json"

    inventory = download.shard_inventory(
        config.SOURCE_REPO, config.SOURCE_REVISION, config.SOURCE_SPLITS
    )
    shard_names = sorted(inventory)[:max_shards] if max_shards else sorted(inventory)

    counts = stream_extract(shard_names, config.SHARDS_DIR, config.IMAGES_DIR, state_path)

    catalog = select.select_catalog(counts, min_images=min_images, max_species=max_species)
    if not catalog:
        raise RuntimeError(
            f"no species reached {min_images} images after "
            f"{len(shard_names)} shards - widen the stream"
        )
    pruned = prune_to_catalog(config.IMAGES_DIR, catalog)

    run_module.download.ensure_species_names(dest=config.SPECIES_NAMES_FILE)
    run_module.write_catalog(
        catalog,
        counts,
        config.SPECIES_NAMES_FILE,
        config.COMMON_NAMES_CACHE,
        config.DATA_DIR / "catalog.json",
    )

    paths_by_species = paths_by_species_from_disk(config.IMAGES_DIR)
    holdout.build_holdout_manifest(paths_by_species, config.HOLDOUT_MANIFEST)
    reference = run_module.reference_paths_by_species(
        paths_by_species, holdout.load_holdout_paths(config.HOLDOUT_MANIFEST)
    )

    embedder = embedder or BioCLIP2Embedder(batch_size=batch_size)
    embed.build_embedding_cache(reference, config.IMAGES_DIR, embedder, config.EMBEDDING_CACHE)

    stats: dict = {
        "shards_streamed": len(shard_names),
        "species_eligible": sum(1 for c in counts.values() if c >= min_images),
        "catalog_species": len(catalog),
        "species_pruned": pruned,
        "reference_images": sum(len(p) for p in reference.values()),
        "model_version": embedder.model_version,
    }
    layout = run_module._Layout()
    stats.update(run_module._stage_index(layout, embedder))
    stats["calibration_n"] = run_module._stage_calibrate(layout, embedder)
    stats["thumbnails"] = run_module._stage_thumbs(layout, embedder)
    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-shards", type=int, default=None, help="stream only the first N shards"
    )
    parser.add_argument("--min-images", type=int, default=config.CATALOG_MIN_IMAGES)
    parser.add_argument("--max-species", type=int, default=config.CATALOG_MAX_SPECIES)
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args(argv)

    stats = run_stream(
        max_shards=args.max_shards,
        min_images=args.min_images,
        max_species=args.max_species,
        batch_size=args.batch_size,
    )
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
