"""Eval harness: run the full identify path over every held-out image.

The blueprint's eval gate (art_t8aXEd4u, Verification): the served API's own
IdentifyService - real BioCLIP 2 embedder, real LanceDB reference index,
calibrated tiers - scores every hold-out image from data/holdout.json, and the
result lands in eval.json (top1, top5, p50 latency) with a per-species
breakdown.

Coverage rides beside accuracy because a partial index misses hold-out species
with no reference rows by construction: raw top-k is structurally bounded by
the fraction of hold-out species present in the index. The gate therefore
reads top-5 over *covered* species - retrieval quality itself - while raw
top-5 is printed and reported next to it; at full coverage the two coincide
and the gate is exactly the blueprint's raw top-5 >= 0.75.

    make eval    # PYTHONPATH=api wires in the served retrieval path
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from . import config
from .holdout import load_holdout_mapping

logger = logging.getLogger(__name__)

REPORT_VERSION = 1


@dataclass(frozen=True)
class SpeciesEval:
    """One hold-out species' full-identify-path outcome."""

    species_id: str
    image_path: str
    status: str  # "ok" | "missing_image"
    in_index: bool = False
    scientific_name: str | None = None
    n_reference: int | None = None
    top1: bool | None = None
    top5: bool | None = None
    best_distance: float | None = None
    latency_ms: int | None = None
    low_confidence: bool | None = None
    matched_species: list[str] = field(default_factory=list)


def hit_at_k(matched_species: list[str], expected: str, k: int) -> bool:
    """True when the expected species appears in the first k matches."""
    return expected in matched_species[:k]


def summarize(rows: list[SpeciesEval], n_holdout: int) -> dict:
    """Headline metrics: accuracy over evaluated images, coverage over all hold-out."""
    evaluated = [row for row in rows if row.status == "ok"]
    covered = [row for row in evaluated if row.in_index]

    def share(selected: list[SpeciesEval], attribute: str) -> float | None:
        if not selected:
            return None
        values = [getattr(row, attribute) for row in selected]
        return sum(1 for value in values if value) / len(values)

    latencies = [row.latency_ms for row in evaluated if row.latency_ms is not None]
    return {
        "n_holdout": n_holdout,
        "n_evaluated": len(evaluated),
        "n_missing_images": len(rows) - len(evaluated),
        "n_covered": len(covered),
        "coverage": len({row.species_id for row in covered}) / n_holdout if n_holdout else None,
        "top1": share(evaluated, "top1"),
        "top5": share(evaluated, "top5"),
        "covered_top1": share(covered, "top1"),
        "covered_top5": share(covered, "top5"),
        "p50_latency_ms": float(np.percentile(latencies, 50)) if latencies else None,
        "low_confidence_rate": share(evaluated, "low_confidence"),
    }


def gate_decision(gate_top5: float, summary: dict) -> tuple[bool, str]:
    """(passed, human-readable line) - the gate reads covered top-5; raw is beside it."""
    covered = summary["covered_top5"]
    if covered is None:
        return False, "eval gate: no hold-out images evaluated - FAIL"
    passed = covered >= gate_top5
    verdict = "PASS" if passed else "FAIL"
    line = (
        f"eval gate: top5 covered={covered:.4f} raw={summary['top5']:.4f} "
        f"coverage={summary['coverage']:.4f} threshold={gate_top5:.4f} -> {verdict}"
    )
    return passed, line


def _index_stats(index_dir: Path) -> tuple[int, Counter[str], dict[str, str]]:
    """(row count, rows per species, species -> scientific name) from the table."""
    import lancedb

    table = lancedb.connect(index_dir).open_table(config.INDEX_TABLE)
    arrow = table.to_arrow()
    species_column = arrow.column("species_id").to_pylist()
    names: dict[str, str] = {}
    for species_id, name in zip(
        species_column, arrow.column("scientific_name").to_pylist(), strict=True
    ):
        names.setdefault(species_id, name)
    return len(species_column), Counter(species_column), names


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the identify eval harness.")
    parser.add_argument("--manifest", type=Path, default=config.HOLDOUT_MANIFEST)
    parser.add_argument("--images-dir", type=Path, default=config.IMAGES_DIR)
    parser.add_argument("--index-dir", type=Path, default=config.LANCEDB_DIR)
    parser.add_argument("--confidence", type=Path, default=config.CONFIDENCE_CONFIG)
    parser.add_argument("--output", type=Path, default=config.REPO_ROOT / "eval.json")
    parser.add_argument(
        "--gate-top5", type=float, default=0.75, help="covered top-5 gate; 0 disables"
    )
    parser.add_argument("--index-label", default="", help="index provenance label for the report")
    parser.add_argument(
        "--limit", type=int, default=0, help="debug: evaluate only the first N species"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args(argv)

    # The served identify path lives in the api package; make eval sets PYTHONPATH=api.
    try:
        from app.confidence import load_tiers
        from app.retrieval import IdentifyService, LanceDBReferenceIndex
    except ImportError as error:
        raise SystemExit(
            f"cannot import the API retrieval path ({error}); run via `make eval` "
            "(which sets PYTHONPATH=api)"
        ) from error

    from pipeline.embedder import BioCLIP2Embedder  # heavy: torch + open_clip

    mapping = load_holdout_mapping(args.manifest)
    if args.limit:
        mapping = dict(sorted(mapping.items())[: args.limit])

    index_rows, species_counts, species_names = _index_stats(args.index_dir)
    service = IdentifyService(
        embedder=BioCLIP2Embedder(),
        index=LanceDBReferenceIndex(args.index_dir),
        tiers=load_tiers(args.confidence),
    )

    rows: list[SpeciesEval] = []
    warmed_up = False
    for species in sorted(mapping):
        image_path = mapping[species]
        image_file = args.images_dir / image_path
        if not image_file.is_file():
            logger.error("holdout image missing on disk: %s", image_path)
            rows.append(
                SpeciesEval(species_id=species, image_path=image_path, status="missing_image")
            )
            continue
        image_bytes = image_file.read_bytes()
        if not warmed_up:
            # The first call pays model/thread warm-up; exclude it from latency
            # so p50 describes steady-state serving, where the model loads once.
            service.identify(image_bytes)
            warmed_up = True
        started = time.perf_counter()
        outcome = service.identify(image_bytes)
        latency_ms = round((time.perf_counter() - started) * 1000)
        matched = [match.species_id for match in outcome.matches]
        row = SpeciesEval(
            species_id=species,
            image_path=image_path,
            status="ok",
            in_index=species in species_counts,
            scientific_name=species_names.get(species),
            n_reference=species_counts.get(species),
            top1=hit_at_k(matched, species, 1),
            top5=hit_at_k(matched, species, len(matched)),
            best_distance=outcome.matches[0].distance if outcome.matches else None,
            latency_ms=latency_ms,
            low_confidence=outcome.low_confidence,
            matched_species=matched,
        )
        rows.append(row)
        logger.info(
            "%s: %s (d=%.4f, %d ms)%s",
            species,
            "top5 hit" if row.top5 else "top5 miss",
            row.best_distance,
            latency_ms,
            "" if row.in_index else " [species not in index - misses by construction]",
        )

    summary = summarize(rows, len(mapping))
    report = {
        "version": REPORT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "model_version": service.model_version,
        "index": {
            "dir": str(args.index_dir),
            "label": args.index_label,
            "rows": index_rows,
            "species": len(species_counts),
        },
        "gate_top5": args.gate_top5,
        **summary,
        "per_species": [asdict(row) for row in rows],
    }
    args.output.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    logger.info("wrote %s", args.output)

    passed, line = gate_decision(args.gate_top5, summary)
    print(line)
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
