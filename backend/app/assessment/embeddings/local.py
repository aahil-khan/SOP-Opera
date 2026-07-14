"""Deterministic hash-based pseudo-embeddings (no network / ML deps)."""

from __future__ import annotations

import hashlib
import math
import struct


def embed_local(text: str, *, dim: int = 1536) -> list[float]:
    """
    Produce a stable unit-length float vector from text via SHA-256 expansion.
    Same text → same vector across runs/processes (demo + CI friendly).
    """
    if dim <= 0:
        raise ValueError("dim must be positive")

    raw = text.encode("utf-8")
    buf = bytearray()
    counter = 0
    while len(buf) < dim * 4:
        h = hashlib.sha256(raw + counter.to_bytes(4, "big")).digest()
        buf.extend(h)
        counter += 1

    values: list[float] = []
    for i in range(dim):
        (u,) = struct.unpack_from(">I", buf, i * 4)
        # map uint32 → [-1, 1)
        values.append((u / 0xFFFFFFFF) * 2.0 - 1.0)

    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]
