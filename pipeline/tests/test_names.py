"""GBIF client regression tests: real response shapes, no network.

The production crash (PR #10 follow-up): GBIF's /species/{key}/vernacularNames
returns a paged dict {"results": [...]}, not a bare list. These tests pin the
shapes we must tolerate, including the exact payload that crashed the real run.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline import names


@pytest.fixture
def cache_path(tmp_path: Path) -> Path:
    return tmp_path / "gbif-names.json"


def _stub(monkeypatch: pytest.MonkeyPatch, responses: dict[str, object]) -> list[str]:
    http_calls: list[str] = []

    def fake_http_json(url: str) -> object:
        http_calls.append(url)
        for fragment, payload in responses.items():
            if fragment in url:
                return payload
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(names, "_http_json", fake_http_json)
    return http_calls


SEARCH = {"results": [{"key": 1234, "scientificName": "Acer macrophyllum"}]}


def test_paged_vernacular_shape(monkeypatch, cache_path) -> None:
    """The real GBIF shape: vernacularNames returns {results: [...]}."""
    _stub(
        monkeypatch,
        {
            "species/search": SEARCH,
            "vernacularNames": {
                "results": [
                    {"vernacularName": "bigleaf maple", "language": "eng"},
                    {"vernacularName": "\u00e9rable macrophylle", "language": "fra"},
                ],
                "endOfRecords": True,
            },
        },
    )
    assert names.gbif_common_name("Acer macrophyllum") == "bigleaf maple"


def test_non_dict_entries_skipped(monkeypatch, cache_path) -> None:
    """String or malformed entries must be skipped, never crash (the live-run bug)."""
    _stub(
        monkeypatch,
        {
            "species/search": SEARCH,
            "vernacularNames": {
                "results": ["results", 42, {"vernacularName": "bigleaf maple", "language": "eng"}]
            },
        },
    )
    assert names.gbif_common_name("Acer macrophyllum") == "bigleaf maple"


def test_lookup_failure_degrades_to_none(monkeypatch, caplog) -> None:
    """A network error yields None — a missing common name must not fail ingestion."""

    def boom(url: str) -> object:
        raise OSError("connection reset")

    monkeypatch.setattr(names, "_http_json", boom)
    assert names.gbif_common_name("Acer macrophyllum") is None


def test_common_names_cache_roundtrip(monkeypatch, cache_path) -> None:
    """Second call with the same species hits the cache, not the network."""
    responses = {
        "species/search": SEARCH,
        "vernacularNames": {"results": [{"vernacularName": "bigleaf maple", "language": "eng"}]},
    }
    http_calls = _stub(monkeypatch, responses)

    first = names.common_names({"110000": "Acer macrophyllum"}, cache_path)
    assert first == {"110000": "bigleaf maple"}
    assert json.loads(cache_path.read_text(encoding="utf-8")) == first

    http_calls.clear()
    second = names.common_names({"110000": "Acer macrophyllum"}, cache_path)
    assert second == first
    assert not http_calls  # served from cache
