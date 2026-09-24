"""Reference thumbnails for the UI and API responses.

Convention (shared with the index): the thumbnail of an extracted image
``<species_id>/<split>/<filename>`` lives at
``<thumbs_dir>/<species_id>/<filename>``; the index stores the repo-relative
thumbnail path as ``image_path`` so the API can serve it directly.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from . import config


def thumb_relpath(image_path: str) -> str:
    """Repo-relative index ``image_path`` for an extracted image (pure convention).

    input:  "<species_id>/<split>/<filename>"  (relative to data/images)
    output: "api/static/thumbs/<species_id>/<filename>"
    """
    species_id, _, filename = image_path.rpartition("/")
    repo_relative = config.THUMBS_DIR.relative_to(config.REPO_ROOT)
    return f"{repo_relative}/{species_id}/{filename}"


def generate_thumbnails(image_paths: list[str], images_dir: Path, thumbs_dir: Path) -> int:
    """Write a small JPEG per image; returns how many were newly written.

    Existing thumbnails are skipped, so regeneration over an unchanged run is a
    no-op (idempotent like the rest of the pipeline).
    """
    written = 0
    for relative in image_paths:
        species_id, _, filename = relative.rpartition("/")
        dest = thumbs_dir / species_id / filename
        if dest.exists() and dest.stat().st_size > 0:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(images_dir / relative) as image:
            image.thumbnail((config.THUMB_MAX_SIDE, config.THUMB_MAX_SIDE))
            image.convert("RGB").save(dest, "JPEG", quality=config.THUMB_QUALITY)
        written += 1
    return written
