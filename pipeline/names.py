"""Common-name enrichment via the GBIF backbone API.

Scientific names come with the dataset; common (vernacular) names do not, so we
look up the English vernacular per species and cache results on disk. Any
lookup failure degrades to None (the schema keeps common_name nullable) - a
missing common name must not fail ingestion.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.parse
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

GBIF_SEARCH = "https://api.gbif.org/v1/species/search?q={query}&rank=SPECIES&limit=1"
GBIF_VERNACULAR = "https://api.gbif.org/v1/species/{key}/vernacularNames?limit=50"
REQUEST_TIMEOUT = 30
REQUEST_PAUSE = 0.05


def _http_json(url: str) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": "plant-id-demo-ingest"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def gbif_common_name(scientific_name: str) -> str | None:
    """English vernacular name for a scientific name, or None."""
    try:
        query = urllib.parse.quote(f'"{scientific_name}"')
        matches = _http_json(GBIF_SEARCH.format(query=query))
        results = matches.get("results", []) if isinstance(matches, dict) else []
        if not results:
            return None
        usage_key = results[0].get("key")
        entries = _http_json(GBIF_VERNACULAR.format(key=usage_key)) or []
        english = [e.get("vernacularName") for e in entries if e.get("language") == "eng"]
        return english[0] if english else None
    except (OSError, ValueError, KeyError) as error:
        logger.warning("GBIF lookup failed for %r: %s", scientific_name, error)
        return None


def common_names(
    scientific_names: dict[str, str],
    cache_path: Path,
    pause: float = REQUEST_PAUSE,
) -> dict[str, str | None]:
    """{species_id: common_name-or-None}, using and updating the on-disk cache."""
    cache: dict[str, str | None] = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))

    for species_id, name in sorted(scientific_names.items()):
        if species_id in cache:
            continue
        cache[species_id] = gbif_common_name(name)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache, indent=1, sort_keys=True), encoding="utf-8")
        time.sleep(pause)

    return cache
