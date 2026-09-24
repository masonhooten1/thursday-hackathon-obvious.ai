"""Pure catalog-selection and hold-out logic.

These functions are deterministic and side-effect free so they can be tested
without any dataset or model.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Iterable


def select_catalog(counts: dict[str, int], min_images: int, max_species: int) -> list[str]:
    """Pick the best-covered species.

    A species qualifies with >= min_images; qualifiers are ranked by image count
    (descending, ties broken by species_id ascending) and truncated to
    max_species. Deterministic: identical inputs give an identical catalog.
    """
    eligible = sorted(
        (species for species, count in counts.items() if count >= min_images),
        key=lambda species: (-counts[species], species),
    )
    return eligible[:max_species]


def count_species(rows: Iterable[tuple[str, str]]) -> Counter[str]:
    """Count rows per species_id from (species_id, ...) row tuples."""
    return Counter(species for species, _ in rows)


def pick_holdout(paths_by_species: dict[str, list[str]]) -> dict[str, str]:
    """Choose the one eval image per species that is never indexed.

    Deterministic and uncorrelated with image content ordering: each path is
    ranked by the sha256 of (species_id, path), and the minimum wins.
    """
    holdout: dict[str, str] = {}
    for species, paths in paths_by_species.items():
        if not paths:
            raise ValueError(f"species {species} has no images")
        holdout[species] = min(
            paths, key=lambda p: hashlib.sha256(f"{species}|{p}".encode()).hexdigest()
        )
    return holdout
