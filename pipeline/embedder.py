"""Embedder abstraction.

`Embedder` is the seam that keeps the pipeline testable: production uses
BioCLIP 2 (heavy torch/open_clip imports deferred to construction), tests use a
deterministic hash embedder with no heavy dependencies.
"""

from __future__ import annotations

import hashlib
import os
from contextlib import nullcontext
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image

from . import config


class Embedder(Protocol):
    model_version: str
    dim: int

    def embed_paths(self, paths: list[Path]) -> np.ndarray:
        """Embed images (any order); returns (n, dim) float32, L2-normalized."""
        ...


class HashingEmbedder:
    """Deterministic embedder for tests: sha256 of the bytes seeds a unit vector.

    Same image -> same vector; no network, no torch, so CI stays lightweight.
    """

    def __init__(self, dim: int = 32) -> None:
        self.model_version = "hash-test"
        self.dim = dim

    def embed_paths(self, paths: list[Path]) -> np.ndarray:
        vectors = np.zeros((len(paths), self.dim), dtype=np.float32)
        for index, path in enumerate(paths):
            digest = hashlib.sha256(Path(path).read_bytes()).digest()
            rng = np.random.default_rng(int.from_bytes(digest[:8], "big"))
            vector = rng.standard_normal(self.dim).astype(np.float32)
            vectors[index] = vector / np.linalg.norm(vector)
        return vectors


class CountingEmbedder:
    """Wraps an Embedder and counts embedded images (used to assert cache reuse)."""

    def __init__(self, inner: Embedder) -> None:
        self._inner = inner
        self.embedded = 0
        self.model_version = inner.model_version
        self.dim = inner.dim

    def embed_paths(self, paths: list[Path]) -> np.ndarray:
        self.embedded += len(paths)
        return self._inner.embed_paths(paths)


class BioCLIP2Embedder:
    """BioCLIP 2 (imageomics/bioclip-2, ViT-L/14, MIT) image embedder.

    Heavy imports happen here on purpose: importing this module must stay cheap
    for tests and CI.
    """

    def __init__(
        self,
        model_name: str = config.EMBEDDING_MODEL,
        batch_size: int = 32,
        num_threads: int | None = None,
    ) -> None:
        import open_clip
        import torch

        torch.set_num_threads(num_threads or os.cpu_count() or 1)
        self._torch = torch
        self._batch_size = batch_size

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model, _, self._preprocess = open_clip.create_model_and_transforms(model_name)
        self._model = self._model.to(self.device).eval()
        # embed_dim is not exposed uniformly across open_clip versions/models -
        # derive it from a one-shot dummy forward instead of an attribute read.
        probe = self._preprocess(Image.new("RGB", (32, 32))).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            self.dim = int(self._model.encode_image(probe).shape[-1])
        self.model_version = config.MODEL_VERSION

    def _autocast(self):  # noqa: ANN202 - context manager type differs by torch version
        torch = self._torch
        if self.device == "cuda":
            # fp16 where it is exact-enough AND fast; CPU stays fp32 so cached
            # reference vectors and API query vectors share one numeric recipe.
            return torch.autocast("cuda", dtype=torch.float16)
        return nullcontext()

    def embed_paths(self, paths: list[Path]) -> np.ndarray:
        import torch

        vectors = np.zeros((len(paths), self.dim), dtype=np.float32)
        with torch.inference_mode(), self._autocast():
            for start in range(0, len(paths), self._batch_size):
                chunk = paths[start : start + self._batch_size]
                pixels = [self._preprocess(Image.open(path).convert("RGB")) for path in chunk]
                batch = torch.stack(pixels).to(self.device)
                features = self._model.encode_image(batch).float().cpu().numpy()
                vectors[start : start + len(chunk)] = features
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / norms
