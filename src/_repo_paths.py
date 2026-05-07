"""Repository root and shared path helpers (scripts live in src/)."""

from __future__ import annotations

from pathlib import Path
import os

REPO_ROOT = Path(__file__).resolve().parent.parent


def _raw_roots() -> list[Path]:
    roots: list[Path] = []
    env_raw = os.environ.get("RAW_DATA_DIR", "").strip()
    if env_raw:
        p = Path(env_raw)
        roots.append(p if p.is_absolute() else REPO_ROOT / p)
    roots.extend(
        [
            REPO_ROOT / "data" / "raw",
            REPO_ROOT / "raw",
            REPO_ROOT,
        ]
    )
    out: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        r = root.resolve()
        if r not in seen:
            out.append(root)
            seen.add(r)
    return out


def resolve_situation_h5() -> Path:
    candidates = [root / "Situation.h5" for root in _raw_roots()]
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]


def resolve_shot_h5(subdir: str, filename: str) -> Path:
    """Resolve shot HDF5 from RAW_DATA_DIR, data/raw, raw, or legacy repo-root layout."""
    candidates: list[Path] = []
    for root in _raw_roots():
        candidates.append(root / subdir / filename)
        candidates.append(root / filename)
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]


def resolve_zip(name: str) -> Path:
    for base in _raw_roots():
        z = base / name
        if z.is_file():
            return z
    return REPO_ROOT / name
