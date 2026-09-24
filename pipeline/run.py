"""Pipeline orchestration: run every stage, or a subset, from the CLI.

    .venv/bin/python -m pipeline.run                 # full run
    .venv/bin/python -m pipeline.run --stages index  # subset of stages

Stage order is fixed: download -> select -> embed -> index -> calibrate -> thumbs.
The embed stage extracts images and builds the hold-out manifest; every later
stage reads from the embedding cache, so re-runs are cheap and idempotent.
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import numpy as np

from . import calibrate, config, download, embed, extract, holdout, names, select, thumbs
from .embedder import BioCLIP2Embedder, Embedder
from .index_writer import write_index
from .labels import label_names_from_parquet, load_scientific_names

logger = logging.getLogger(__name__)

STAGES = ("download", "select", "embed", "index", "calibrate", "thumbs")


def reference_paths_by_species(
    paths_by_species: dict[str, list[str]], holdout_paths: set[str]
) -> dict[str, list[str]]:
    """Catalog paths minus the hold-out images (pure filter)."""
    return {
        species: [p for p in paths if p not in holdout_paths]
        for species, paths in paths_by_species.items()
    }


class _Layout:
    """Resolved paths for one run; tests point data at a tmp dir."""

    def __init__(
        self,
        data_dir: Path = config.DATA_DIR,
        confidence_path: Path = config.CONFIDENCE_CONFIG,
        thumbs_dir: Path = config.THUMBS_DIR,
    ) -> None:
        self.data_dir = data_dir
        self.shards = data_dir / "raw" / "shards"
        self.images = data_dir / "images"
        self.catalog = data_dir / "catalog.json"
        self.cache = data_dir / "embeddings.parquet"
        self.lancedb = data_dir / "lancedb"
        self.holdout = data_dir / "holdout.json"
        self.names = data_dir / "raw" / "plantnet300K_species_id_2_name.json"
        self.common_names_cache = data_dir / "raw" / "gbif_common_names.json"
        self.confidence = confidence_path
        self.thumbs = thumbs_dir


def run(
    stages: tuple[str, ...] = STAGES,
    layout: _Layout | None = None,
    min_images: int = config.CATALOG_MIN_IMAGES,
    max_species: int = config.CATALOG_MAX_SPECIES,
    splits: tuple[str, ...] = config.SOURCE_SPLITS,
    embedder: Embedder | None = None,
    batch_size: int = 32,
) -> dict:
    """Execute the requested stages in order; returns run stats."""
    layout = layout or _Layout()
    stats: dict = {"stages": list(stages)}
    started = time.time()

    for stage in stages:
        stage_started = time.time()
        if stage == "download":
            stats["shards"] = _stage_download(layout, splits)
        elif stage == "select":
            _stage_select(layout, splits, min_images, max_species, stats)
        elif stage == "embed":
            _stage_embed(layout, splits, stats, embedder=embedder, batch_size=batch_size)
        elif stage == "index":
            stats.update(_stage_index(layout, embedder))
        elif stage == "calibrate":
            stats["calibration_n"] = _stage_calibrate(layout, embedder)
        elif stage == "thumbs":
            stats["thumbnails"] = _stage_thumbs(layout, embedder)
        else:
            raise ValueError(f"unknown stage {stage!r}; expected one of {STAGES}")
        logger.info("stage %s done in %.1fs", stage, time.time() - stage_started)

    stats["total_seconds"] = round(time.time() - started, 1)
    return stats


def _stage_download(layout: _Layout, splits: tuple[str, ...]) -> int:
    shard_paths = download.ensure_shards(dest=layout.shards, splits=splits)
    download.ensure_species_names(dest=layout.names)
    return len(shard_paths)


def write_catalog(
    catalog_species: list[str],
    counts: dict[str, int],
    names_path: Path,
    common_cache_path: Path,
    dest: Path,
) -> None:
    """Write catalog.json: scientific/common names + reference counts per species."""
    scientific = load_scientific_names(names_path)
    missing = [species for species in catalog_species if species not in scientific]
    if missing:
        raise KeyError(f"no scientific names for {len(missing)} species, e.g. {missing[:3]}")
    common = names.common_names(
        {species: scientific[species] for species in catalog_species},
        cache_path=common_cache_path,
    )
    dest.write_text(
        json.dumps(
            {
                species: {
                    "scientific_name": scientific[species],
                    "common_name": common.get(species),
                    "reference_images": counts[species],
                }
                for species in catalog_species
            },
            indent=1,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def _stage_select(
    layout: _Layout,
    splits: tuple[str, ...],
    min_images: int,
    max_species: int,
    stats: dict,
) -> None:
    shard_paths = sorted(layout.shards.glob("*.parquet"))
    label_names = label_names_from_parquet(shard_paths[0])
    counts = select.count_species(
        (species_id, shard.name)
        for shard in shard_paths
        for species_id in _shard_species_counts(shard, label_names, splits)
    )
    catalog = select.select_catalog(counts, min_images=min_images, max_species=max_species)
    stats["species_eligible"] = len(counts)
    stats["catalog_species"] = len(catalog)

    write_catalog(catalog, counts, layout.names, layout.common_names_cache, layout.catalog)


def _stage_embed(
    layout: _Layout,
    splits: tuple[str, ...],
    stats: dict,
    embedder: Embedder | None,
    batch_size: int,
) -> None:
    embedder = embedder or BioCLIP2Embedder(batch_size=batch_size)
    shard_paths = sorted(layout.shards.glob("*.parquet"))
    label_names = label_names_from_parquet(shard_paths[0])
    catalog = json.loads(layout.catalog.read_text(encoding="utf-8"))

    paths_by_species = extract.extract_images(
        shard_paths, layout.images, label_names, splits, keep_species=set(catalog)
    )
    stats["extracted_images"] = sum(len(p) for p in paths_by_species.values())

    holdout.build_holdout_manifest(paths_by_species, layout.holdout)
    reference = reference_paths_by_species(
        paths_by_species, holdout.load_holdout_paths(layout.holdout)
    )
    stats["reference_images"] = sum(len(p) for p in reference.values())
    embed.build_embedding_cache(reference, layout.images, embedder, layout.cache)


def _stage_index(layout: _Layout, embedder: Embedder) -> dict[str, int]:
    embedder = embedder or BioCLIP2Embedder()
    catalog = json.loads(layout.catalog.read_text(encoding="utf-8"))
    excluded = _holdout_exclusions(layout)
    rows = [
        (
            species_id,
            catalog[species_id]["scientific_name"],
            catalog[species_id]["common_name"] or "",
            thumbs.thumb_relpath(image_path),
            vector,
        )
        for image_path, species_id, vector in embed.cache_rows(layout.cache, embedder.model_version)
        if image_path not in excluded  # calibration caches hold-out vectors too
    ]
    return write_index(rows, layout.lancedb, config.INDEX_TABLE)


def _holdout_exclusions(layout: _Layout) -> set[str]:
    """Paths that must never be indexed, per the manifest."""
    if not layout.holdout.exists():
        return set()
    return holdout.load_holdout_paths(layout.holdout)


def _stage_calibrate(layout: _Layout, embedder: Embedder) -> int:
    """Query each held-out image against the index; write the tier config.

    Hold-out embeddings go through the same cache as references, so re-running
    calibration costs no model time (idempotency covers every stage).
    """
    import lancedb

    embedder = embedder or BioCLIP2Embedder()
    table = lancedb.connect(layout.lancedb).open_table(config.INDEX_TABLE)

    manifest = json.loads(layout.holdout.read_text(encoding="utf-8"))
    holdout_by_species = {
        species: [entry["image_path"]] for species, entry in manifest["holdout"].items()
    }
    embed.build_embedding_cache(holdout_by_species, layout.images, embedder, layout.cache)
    cache = embed.load_cache(layout.cache)

    best = np.zeros(len(holdout_by_species), dtype=np.float64)
    for position, species in enumerate(sorted(holdout_by_species)):
        relative = holdout_by_species[species][0]
        absolute = layout.images / relative
        key = (relative, absolute.stat().st_size, embedder.model_version)
        vector = np.asarray(cache[key][1], dtype=np.float32)
        hit = table.search(vector).metric("cosine").limit(1).to_list()[0]
        best[position] = float(hit["_distance"])

    calibrate.write_confidence_config(
        best,
        layout.confidence,
        model_version=embedder.model_version,
        holdout_manifest=layout.holdout,
    )
    return int(best.size)


def _stage_thumbs(layout: _Layout, embedder: Embedder) -> int:
    embedder = embedder or BioCLIP2Embedder()
    excluded = _holdout_exclusions(layout)
    indexed = [
        image_path
        for image_path, _, _ in embed.cache_rows(layout.cache, embedder.model_version)
        if image_path not in excluded
    ]
    return thumbs.generate_thumbnails(indexed, layout.images, layout.thumbs)


def _shard_species_counts(
    shard: Path, label_names: dict[int, str], splits: tuple[str, ...]
) -> list[str]:
    """Species id per row, reading only the (tiny) label column."""
    import pyarrow.parquet as pq

    split = shard.name.split("-", 1)[0]
    if split not in splits:
        return []
    parquet = pq.ParquetFile(shard)
    counts: list[str] = []
    for batch in parquet.iter_batches(columns=["label"], batch_size=4096):
        counts.extend(label_names[int(label)] for label in batch.column("label").to_pylist())
    return counts


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stages", default=",".join(STAGES), help="comma-separated subset of " + ",".join(STAGES)
    )
    parser.add_argument("--data-dir", type=Path, default=config.DATA_DIR)
    parser.add_argument("--min-images", type=int, default=config.CATALOG_MIN_IMAGES)
    parser.add_argument("--max-species", type=int, default=config.CATALOG_MAX_SPECIES)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args(argv)

    stats = run(
        stages=tuple(stage for stage in args.stages.split(",") if stage),
        layout=_Layout(data_dir=args.data_dir),
        min_images=args.min_images,
        max_species=args.max_species,
        embedder=BioCLIP2Embedder(batch_size=args.batch_size),
        batch_size=args.batch_size,
    )
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
