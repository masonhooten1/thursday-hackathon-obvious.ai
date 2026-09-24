"""Central configuration for the ingestion pipeline.

Every path and tuning constant lives here so the real run is reproducible from
one place and tests can pass explicit values instead of touching globals.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# --- Catalog selection (Pl@ntNet-300K filtering) ---
# Blueprint E2: per-class accuracy climbs with reference count (0.79 mean-bin
# accuracy for species with 500+ images). Requiring >=100 reference images in the
# downloaded splits keeps the catalog inside the well-covered bands; the cap
# bounds demo size and embed time.
CATALOG_MIN_IMAGES = 100
CATALOG_MAX_SPECIES = 200

# --- Source dataset ---
# Pl@ntNet-300K (306k images / 1081 species, BSD-2-Clause code) is distributed as
# a single 31.7 GB Zenodo zip. The mikehemberger/plantnet300K HF mirror carries
# the same archive as per-split parquet shards. Only the train split (~282k
# images, 51 shards) is dense enough for the >=100-images-per-species filter:
# validation+test hold ~16k images total (~15 per species max). The streaming
# driver (pipeline/stream_ingest.py) downloads train shards one at a time and
# deletes each after extraction, so the full archive never lands on disk.
SOURCE_REPO = "mikehemberger/plantnet300K"
SOURCE_REVISION = "main"
SOURCE_SPLITS = ("train",)
# Per-species cap while streaming: every catalog species keeps at least
# CATALOG_MIN_IMAGES references; the cap bounds embed time on CPU-only serving.
REFERENCE_CAP_PER_SPECIES = 110
SHARD_LIST_URL = "https://huggingface.co/api/datasets/{repo}/tree/{revision}/data"
SHARD_URL = "https://huggingface.co/datasets/{repo}/resolve/{revision}/data/{name}"

# species_id -> scientific name, hosted by the Pl@ntNet team next to the dataset.
SPECIES_NAMES_URL = (
    "https://seafile.plantnet.org/d/bed81bc15e8944969cf6/files/"
    "?p=%2Fplantnet300K_species_id_2_name.json&dl=1"
)

# --- Embedder ---
# NOTE: the blueprint says "BioCLIP 2 ViT-B/16", but imageomics/bioclip-2 is
# actually a ViT-L/14 (the ViT-B/16 label belongs to BioCLIP v1). The locked
# decision names the repo id, so we ship that and record the true architecture.
EMBEDDING_MODEL = "hf-hub:imageomics/bioclip-2"
MODEL_VERSION = "bioclip2-vit-l14"

# --- Layout (repo-relative) ---
DATA_DIR = REPO_ROOT / "data"
SHARDS_DIR = DATA_DIR / "raw" / "shards"
SPECIES_NAMES_FILE = DATA_DIR / "raw" / "plantnet300K_species_id_2_name.json"
COMMON_NAMES_CACHE = DATA_DIR / "raw" / "gbif_common_names.json"
IMAGES_DIR = DATA_DIR / "images"
EMBEDDING_CACHE = DATA_DIR / "embeddings.parquet"
LANCEDB_DIR = DATA_DIR / "lancedb"
HOLDOUT_MANIFEST = DATA_DIR / "holdout.json"
CONFIDENCE_CONFIG = REPO_ROOT / "api" / "config" / "confidence.json"
THUMBS_DIR = REPO_ROOT / "api" / "static" / "thumbs"

INDEX_TABLE = "references"

# --- Thumbnails ---
# image_path stored in the index points at the servable thumbnail, not the
# original dataset file - the API returns it verbatim as Match.reference_image.
THUMB_MAX_SIDE = 128
THUMB_QUALITY = 70
