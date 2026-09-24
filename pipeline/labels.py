"""Label <-> species-id <-> name mappings.

The HF mirror stores the original Pl@ntNet-300K class ids as the parquet
`label` column's class_label names, embedded in the parquet schema metadata.
Scientific names come from the Pl@ntNet metadata file.
"""

from __future__ import annotations

import json
from pathlib import Path


def label_names_from_parquet(shard: Path) -> dict[int, str]:
    """Read {label: species_id} from the HF class_label metadata in a shard.

    Works regardless of whether the metadata is stored as a features list
    (older datasets) or a mapping (newer), by searching for the first
    class_label node.
    """
    import pyarrow.parquet as pq

    schema = pq.read_schema(shard)
    hf_meta = (schema.metadata or {}).get(b"huggingface")
    if not hf_meta:
        raise ValueError(f"no huggingface metadata in {shard.name}; use label_names_from_readme")

    def find_class_label(node: object) -> dict | None:
        if isinstance(node, dict):
            if node.get("dtype") == "class_label" or node.get("_type") == "ClassLabel":
                return node
            for value in node.values():
                found = find_class_label(value)
                if found:
                    return found
        elif isinstance(node, list):
            for value in node:
                found = find_class_label(value)
                if found:
                    return found
        return None

    info = json.loads(hf_meta)
    label_node = find_class_label(info.get("info", {}).get("features", {}))
    if not label_node or "names" not in label_node:
        raise ValueError(f"no class_label names in {shard.name}")
    return {int(label): name for label, name in enumerate(label_node["names"])}


def label_names_from_readme_text(readme_text: str) -> dict[int, str]:
    """Fallback: parse the class_label names block out of the mirror's README."""
    names: list[str] = []
    in_block = False
    for line in readme_text.splitlines():
        stripped = line.strip()
        if stripped == "class_label:":
            in_block = True
            continue
        if in_block:
            if stripped.startswith("'") and "': '" in stripped:
                names.append(stripped.split("': '", 1)[1].rstrip("',"))
            elif names or (stripped and not stripped.startswith("'")):
                break
    if not names:
        raise ValueError("README contains no class_label names block")
    return {label: name for label, name in enumerate(names)}


def load_scientific_names(names_json: Path) -> dict[str, str]:
    """species_id -> scientific name (authorship included), as shipped by Pl@ntNet."""
    with open(names_json, encoding="utf-8") as f:
        return json.load(f)
