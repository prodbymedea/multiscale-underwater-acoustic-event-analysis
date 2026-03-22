"""Repository root and shared path helpers (scripts live in src/)."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def resolve_situation_h5() -> Path:
    for p in (
        REPO_ROOT / "data" / "raw" / "Situation.h5",
        REPO_ROOT / "Situation.h5",
    ):
        if p.is_file():
            return p
    return REPO_ROOT / "data" / "raw" / "Situation.h5"


def resolve_shot_h5(subdir: str, filename: str) -> Path:
    """Prefer data/raw/<subdir>/<file>, then legacy repo-root layout."""
    candidates = [
        REPO_ROOT / "data" / "raw" / subdir / filename,
        REPO_ROOT / subdir / filename,
    ]
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]


def resolve_zip(name: str) -> Path:
    for base in (REPO_ROOT / "data" / "raw", REPO_ROOT):
        z = base / name
        if z.is_file():
            return z
    return REPO_ROOT / name
