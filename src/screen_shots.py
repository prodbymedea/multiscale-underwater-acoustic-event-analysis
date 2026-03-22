#!/usr/bin/env python3
"""
Batch ingest + visualization for comparing several shots (MVP screening).

Writes:
  output/shots/<slug>/*.json     — ingest export per shot
  figures/shots/<slug>/*.png     — plots (incl. DAS robust / normalized)

Note: Zenodo 2022-01-27--2m.zip / 4m.zip failed unzip in this workspace (corrupt
central directory). This script uses 2022-01-26--03--Morning as the non-Whales
subset stand-in.

Usage (from repository root):
  python3 src/screen_shots.py              # run all configured shots
  python3 src/screen_shots.py whales_orca    # single slug only
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

from _repo_paths import REPO_ROOT, resolve_shot_h5, resolve_situation_h5, resolve_zip

# MPL config before any matplotlib import via visualize_export
os.environ.setdefault(
    "MPLCONFIGDIR", str(REPO_ROOT / ".mplconfig")
)

from visualize_export import run_all_plots  # noqa: E402


VENV_PY = REPO_ROOT / ".venv" / "bin" / "python"
INGEST = Path(__file__).resolve().parent / "ingest_prototype.py"

# slug -> { "subdir": str, "filename": str, "subset": str, "note": str }
_SHOT_SPECS: dict[str, dict] = {
    "whales_humpback": {
        "subdir": "2022-01-26--04--Whales",
        "filename": "2022-01-26--04-46-16--Humpback.h5",
        "subset": "2022-01-26--04--Whales",
        "note": "Humpback playback / response (existing extract)",
    },
    "whales_orca": {
        "subdir": "2022-01-26--04--Whales",
        "filename": "2022-01-26--04-47-42--Orca.h5",
        "subset": "2022-01-26--04--Whales",
        "note": "Orca playback / response",
    },
    "morning_00": {
        "subdir": "2022-01-26--03--Morning",
        "filename": "2022-01-26--03-57-10--00.h5",
        "subset": "2022-01-26--03--Morning",
        "note": "Morning run shot 00 (ambient / non-Whales subset proxy)",
    },
}


def _shot_paths(slug: str) -> dict:
    spec = _SHOT_SPECS[slug]
    h5 = resolve_shot_h5(spec["subdir"], spec["filename"])
    return {"h5": h5, "subset": spec["subset"], "note": spec["note"]}


SHOTS = {slug: _shot_paths(slug) for slug in _SHOT_SPECS}


def _ensure_extracted() -> None:
    """Extract Orca and Morning shot from zips if missing (into repo root layout)."""
    orca = SHOTS["whales_orca"]["h5"]
    if not orca.is_file():
        z = resolve_zip("2022-01-26--04--Whales.zip")
        if not z.is_file():
            raise FileNotFoundError(f"Need {z} to extract Orca")
        orca.parent.mkdir(parents=True, exist_ok=True)
        inner = f"2022-01-26--04--Whales/{orca.name}"
        print(f"Extracting {inner} …")
        subprocess.run(
            ["unzip", "-o", str(z), inner, "-d", str(REPO_ROOT)],
            check=True,
        )

    morning = SHOTS["morning_00"]["h5"]
    if not morning.is_file():
        z = resolve_zip("2022-01-26--03--Morning.zip")
        if not z.is_file():
            raise FileNotFoundError(f"Need {z} to extract Morning shot")
        morning.parent.mkdir(parents=True, exist_ok=True)
        inner = f"2022-01-26--03--Morning/{morning.name}"
        print(f"Extracting {inner} …")
        subprocess.run(
            ["unzip", "-o", str(z), inner, "-d", str(REPO_ROOT)],
            check=True,
        )


def _python() -> str:
    if VENV_PY.is_file():
        return str(VENV_PY)
    return sys.executable


def run_ingest(h5: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    situation = resolve_situation_h5()
    if not situation.is_file():
        raise FileNotFoundError(f"Missing Situation.h5 (try data/raw/Situation.h5): {situation}")
    cmd = [
        _python(),
        str(INGEST),
        str(h5),
        str(out_dir),
        "--situation",
        str(situation),
    ]
    print(" ", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=str(REPO_ROOT))


def screening_metrics(out_dir: Path) -> dict:
    """Light numeric hints for comparison (not a detector)."""
    m: dict = {}
    das_path = out_dir / "das_preview.json"
    if das_path.is_file():
        with open(das_path, encoding="utf-8") as f:
            das = json.load(f)
        if "error" not in das and "data" in das:
            arr = np.asarray(das["data"], dtype=np.float64)
            flat = arr.ravel()
            lo, hi = np.percentile(flat, [2, 98])
            lim = max(abs(lo), abs(hi)) or 1.0
            clipped = np.clip(arr, -lim, lim)
            m["das_std_clipped"] = float(clipped.std())
            m["das_outlier_ratio"] = float(
                np.mean((flat < np.percentile(flat, 1)) | (flat > np.percentile(flat, 99)))
            )

    spec_path = out_dir / "spectrogram.json"
    if spec_path.is_file():
        with open(spec_path, encoding="utf-8") as f:
            spec = json.load(f)
        if spec:
            name = sorted(spec.keys())[0]
            sxx = np.asarray(spec[name]["Sxx_db"], dtype=np.float64)
            m["spec_recorder"] = name
            m["spec_p95_minus_p5_db"] = float(
                np.percentile(sxx, 95) - np.percentile(sxx, 5)
            )

    meta_path = out_dir / "shot_metadata.json"
    if meta_path.is_file():
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        m["file"] = meta.get("file")
        m["recorders"] = meta.get("recorders_available", [])
        if meta.get("source"):
            m["duration_s"] = meta["source"].get("duration_s")

    return m


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    slugs = [only] if only else list(SHOTS.keys())
    for s in slugs:
        if s not in SHOTS:
            print(f"Unknown slug {s!r}. Choose from: {list(SHOTS.keys())}")
            sys.exit(1)

    _ensure_extracted()

    report_lines = [
        "MVP shot screening (automated notes)",
        "2m/4m zips: unzip reported corrupt central directory — used Morning subset instead.",
        "",
    ]
    all_metrics: dict[str, dict] = {}

    for slug in slugs:
        info = SHOTS[slug]
        h5: Path = info["h5"]
        if not h5.is_file():
            print(f"Missing H5 for {slug}: {h5}")
            sys.exit(1)

        out_dir = REPO_ROOT / "output" / "shots" / slug
        fig_dir = REPO_ROOT / "figures" / "shots" / slug

        print(f"\n{'='*60}\n  {slug}: {h5.name}\n{'='*60}")
        run_ingest(h5, out_dir)
        run_all_plots(out_dir, fig_dir, verbose_inspect=False)
        all_metrics[slug] = screening_metrics(out_dir)
        report_lines.append(f"--- {slug} ---")
        report_lines.append(f"subset: {info['subset']}")
        report_lines.append(f"note: {info['note']}")
        for k, v in sorted(all_metrics[slug].items()):
            report_lines.append(f"  {k}: {v}")
        report_lines.append("")

    rep_path = REPO_ROOT / "output" / "shots" / "SCREENING_METRICS.txt"
    rep_path.parent.mkdir(parents=True, exist_ok=True)
    rep_path.write_text("\n".join(report_lines), encoding="utf-8")
    print(f"\nWrote {rep_path}")


if __name__ == "__main__":
    main()
