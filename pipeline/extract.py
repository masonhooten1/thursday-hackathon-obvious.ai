"""Extract catalog images out of the parquet shards onto disk.

Rows for the selected catalog species are written as
``<images_dir>/<species_id>/<split>/<original filename>`` so paths are stable
across runs (the key idempotency relies on).
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .labels import label_names_from_parquet


@dataclass(frozen=True)
class ShardRow:
    species_id: str
    split: str
    filename: str
    data: bytes


def shard_label_names(shard: Path) -> dict[int, str]:
    return label_names_from_parquet(shard)


def iter_rows(
    shards: list[Path],
    label_names: dict[int, str],
    splits: tuple[str, ...],
    keep_species: set[str] | None = None,
) -> Iterator[ShardRow]:
    """Yield rows from the shards, optionally restricted to catalog species.

    Reads in row-group batches so the full image bytes of a shard never sit in
    memory at once.
    """
    import pyarrow.parquet as pq

    seen_files: set[str] = set()
    for shard in sorted(shards):
        parquet = pq.ParquetFile(shard)
        split = shard.name.split("-", 1)[0]
        if split not in splits:
            raise ValueError(f"shard {shard.name} does not match a requested split {splits}")
        for batch in parquet.iter_batches(columns=["image", "label"], batch_size=256):
            images = batch.column("image")
            labels = batch.column("label").to_pylist()
            for image_struct, label in zip(images.to_pylist(), labels, strict=True):
                species_id = label_names[int(label)]
                if keep_species is not None and species_id not in keep_species:
                    continue
                filename = image_struct["path"] or f"row-{len(seen_files)}.jpg"
                # Filenames are unique within a class in Pl@ntNet-300K; the split
                # prefix keeps them unique across splits of the same species.
                key = f"{split}/{filename}"
                if key in seen_files:
                    raise ValueError(f"duplicate image path {key}")
                seen_files.add(key)
                yield ShardRow(
                    species_id=species_id,
                    split=split,
                    filename=filename,
                    data=image_struct["bytes"],
                )


def write_row(images_dir: Path, row: ShardRow) -> Path:
    dest = images_dir / row.species_id / row.split / row.filename
    if dest.exists() and dest.stat().st_size == len(row.data):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(row.data)
    tmp.replace(dest)
    return dest


def extract_images(
    shards: list[Path],
    images_dir: Path,
    label_names: dict[int, str],
    splits: tuple[str, ...],
    keep_species: set[str],
) -> dict[str, list[str]]:
    """Write every catalog image under images_dir; prune stale files.

    Returns {species_id: [relative paths]} for exactly the files on disk after
    pruning, so a re-run over an unchanged source yields the same manifest.
    """
    written: dict[str, list[str]] = {species: [] for species in keep_species}
    for row in iter_rows(shards, label_names, splits, keep_species=keep_species):
        dest = write_row(images_dir, row)
        written[row.species_id].append(str(dest.relative_to(images_dir)))

    _prune_stray_files(images_dir, {path for paths in written.values() for path in paths})
    return {species: sorted(paths) for species, paths in written.items()}


def _prune_stray_files(images_dir: Path, keep: set[str]) -> None:
    """Remove extracted files no longer part of the catalog (stale re-runs)."""
    for path in sorted(images_dir.rglob("*")):
        if path.is_file() and not path.name.endswith(".part"):
            relative = str(path.relative_to(images_dir))
            if relative not in keep:
                path.unlink()
