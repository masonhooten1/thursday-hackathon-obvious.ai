"""Fetch the source shards and metadata files.

Shard download is resumable: files already present with the expected size are
skipped, partial downloads continue with an HTTP Range request.
"""

from __future__ import annotations

import json
import shutil
import urllib.request
from pathlib import Path

from . import config

HTTP_TIMEOUT = 60


def _http_get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as response:  # noqa: S310 - fixed scheme
        return response.read()


def shard_inventory(repo: str, revision: str, splits: tuple[str, ...]) -> dict[str, int]:
    """{parquet filename: size in bytes} for the requested splits."""
    url = config.SHARD_LIST_URL.format(repo=repo, revision=revision)
    entries = json.loads(_http_get(url))
    inventory: dict[str, int] = {}
    for entry in entries:
        name = entry["path"].rsplit("/", 1)[-1]
        if name.endswith(".parquet") and name.split("-", 1)[0] in splits:
            inventory[name] = int(entry["size"])
    if not inventory:
        raise RuntimeError(f"no {splits} shards listed at {url}")
    return inventory


def _download_file(url: str, dest: Path, expected_size: int | None = None) -> Path:
    if dest.exists() and (expected_size is None or dest.stat().st_size == expected_size):
        return dest

    part = dest.with_suffix(dest.suffix + ".part")
    resume_from = part.stat().st_size if part.exists() else 0
    request = urllib.request.Request(url, headers={"Range": f"bytes={resume_from}-"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response, open(part, "ab") as out:  # noqa: S310
        shutil.copyfileobj(response, out)

    if expected_size is not None and part.stat().st_size != expected_size:
        raise RuntimeError(f"{part} is {part.stat().st_size} bytes, expected {expected_size}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part.replace(dest)
    return dest


def ensure_shards(
    dest: Path = config.SHARDS_DIR,
    repo: str = config.SOURCE_REPO,
    revision: str = config.SOURCE_REVISION,
    splits: tuple[str, ...] = config.SOURCE_SPLITS,
) -> list[Path]:
    """Download the split shards into dest (skipping complete ones). Returns paths."""
    dest.mkdir(parents=True, exist_ok=True)
    inventory = shard_inventory(repo, revision, splits)
    paths: list[Path] = []
    for name, size in sorted(inventory.items()):
        url = config.SHARD_URL.format(repo=repo, revision=revision, name=name)
        paths.append(_download_file(url, dest / name, expected_size=size))
    return paths


def ensure_species_names(dest: Path = config.SPECIES_NAMES_FILE) -> Path:
    """Download the species_id -> scientific name map from Pl@ntNet's metadata share."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = _http_get(config.SPECIES_NAMES_URL)
    json.loads(payload)  # fail loudly before writing anything
    dest.write_bytes(payload)
    return dest
