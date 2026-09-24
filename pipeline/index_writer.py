"""Write the LanceDB reference index.

The table is rebuilt from the embedding cache on every run - the cache is the
source of truth, so a rebuild is cheap and row counts are identical across
runs (idempotency).
"""

from __future__ import annotations

from pathlib import Path

import pyarrow as pa

INDEX_COLUMNS = ["species_id", "scientific_name", "common_name", "image_path", "embedding"]


def write_index(
    rows: list[tuple[str, str, str, str, list[float]]],
    lancedb_dir: Path,
    table_name: str,
) -> dict[str, int]:
    """Create/replace the reference table.

    Each row is (species_id, scientific_name, common_name, image_path, embedding)
    - exactly the five columns the identify contract names.
    """
    import lancedb

    if not rows:
        raise ValueError("refusing to write an empty index")

    dim = len(rows[0][4])
    flat_embeddings = pa.array(
        [value for row in rows for value in row[4]], type=pa.float32()
    )
    table = pa.Table.from_arrays(
        [
            pa.array([row[0] for row in rows], type=pa.string()),
            pa.array([row[1] for row in rows], type=pa.string()),
            pa.array([row[2] for row in rows], type=pa.string()),
            pa.array([row[3] for row in rows], type=pa.string()),
            pa.array(
                pa.FixedSizeListArray.from_arrays(flat_embeddings, dim),
                type=pa.list_(pa.float32(), dim),
            ),
        ],
        schema=pa.schema(
            [
                ("species_id", pa.string()),
                ("scientific_name", pa.string()),
                ("common_name", pa.string()),
                ("image_path", pa.string()),
                ("embedding", pa.list_(pa.float32(), dim)),
            ]
        ),
    )

    db = lancedb.connect(lancedb_dir)
    db.create_table(table_name, data=table, mode="overwrite")
    return {"rows": table.num_rows, "dim": dim}
