"""fetch_holdout: extraction layout and shard scanning against the synthetic fixture."""

import json

from pipeline.fetch_holdout import main, row_relpath, scan_shard

WANTED = {"110000/validation/110000_validation_0.jpg", "110001/test/110001_test_0.jpg"}


def test_row_relpath_matches_extraction_layout():
    assert row_relpath("1355868", "train", "abc.jpg") == "1355868/train/abc.jpg"


def test_scan_shard_extracts_only_manifest_rows(tmp_path, tiny_dataset):
    shards = sorted((tmp_path / "raw" / "shards").glob("*.parquet"))
    assert len(shards) == 2  # one validation shard, one test shard
    images_dir = tmp_path / "images"
    validation_shard = next(shard for shard in shards if shard.name.startswith("validation-"))
    test_shard = next(shard for shard in shards if shard.name.startswith("test-"))

    found = scan_shard(validation_shard, images_dir, WANTED)
    assert found == {"110000/validation/110000_validation_0.jpg"}
    assert (images_dir / "110000" / "validation" / "110000_validation_0.jpg").is_file()
    # Same-species rows absent from the manifest stay off disk.
    assert not (images_dir / "110000" / "validation" / "110000_validation_1.jpg").exists()

    found_test = scan_shard(test_shard, images_dir, WANTED)
    assert found_test == {"110001/test/110001_test_0.jpg"}
    assert (images_dir / "110001" / "test" / "110001_test_0.jpg").is_file()


def test_main_short_circuits_when_all_images_on_disk(tmp_path):
    """No shard download, no state file: everything on disk means zero network."""
    images_dir = tmp_path / "images"
    for relative in sorted(WANTED):
        destination = images_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"jpeg-bytes")
    manifest = tmp_path / "holdout.json"
    manifest.write_text(
        json.dumps(
            {
                "holdout": {
                    species: {"image_path": relative, "split": "train"}
                    for species, relative in [
                        ("110000", "110000/validation/110000_validation_0.jpg"),
                        ("110001", "110001/test/110001_test_0.jpg"),
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    state = tmp_path / "state.json"

    exit_code = main(
        [
            "--manifest",
            str(manifest),
            "--images-dir",
            str(images_dir),
            "--state",
            str(state),
        ]
    )

    assert exit_code == 0
    assert not state.exists()
