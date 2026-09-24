"""Selection tests: catalog filtering boundaries and deterministic hold-out."""

from __future__ import annotations

import pytest

from pipeline import select


def test_catalog_filters_below_min_images() -> None:
    counts = {"a": 100, "b": 99, "c": 250}

    catalog = select.select_catalog(counts, min_images=100, max_species=300)

    assert catalog == ["c", "a"]  # order: count desc


def test_catalog_caps_at_best_covered_species() -> None:
    counts = {"a": 500, "b": 400, "c": 300, "d": 200}

    catalog = select.select_catalog(counts, min_images=100, max_species=2)

    assert catalog == ["a", "b"]  # top-2 by count


def test_catalog_ties_break_deterministically() -> None:
    counts = {"zebra": 300, "alpha": 300, "mid": 300}

    catalog = select.select_catalog(counts, min_images=100, max_species=2)

    assert sorted(catalog) == ["alpha", "mid"]  # species id order, not dict luck


def test_pick_holdout_is_deterministic() -> None:
    paths = {"s1": [f"s1/img{i}.jpg" for i in range(4)], "s2": ["s2/only.jpg"]}

    first = select.pick_holdout(paths)
    second = select.pick_holdout(paths)

    assert first == second
    assert set(first) == {"s1", "s2"}
    assert first["s1"] in paths["s1"]
    assert first["s2"] == "s2/only.jpg"  # smallest pool still yields one


def test_pick_holdout_rejects_empty_species() -> None:
    with pytest.raises(ValueError, match="no images"):
        select.pick_holdout({"empty": []})
