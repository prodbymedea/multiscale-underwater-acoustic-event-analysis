#!/usr/bin/env python3
"""
Quick-look matplotlib plots for DASLakeZurich ingest JSON exports.

Reads JSON from output/ (or path you pass) and saves PNGs under figures/:
  - figures/das_preview.png            — DAS heatmap (default linear scale; often poor if outliers)
  - figures/das_preview_robust.png     — DAS with percentile-based symmetric norm around 0
  - figures/das_preview_normalized.png — DAS per-channel z-score (time axis)
  - figures/waveform.png               — hydrophone pressure vs time (one recorder/channel)
  - figures/spectrogram.png   — STFT dB (time × frequency)
  - figures/situation.png     — bathymetry + fiber (+ optional boat tracks)

Dependencies: matplotlib, numpy  (see requirements below in docstring or README note)

Usage (from repository root):
  python3 src/visualize_export.py
  python3 src/visualize_export.py /path/to/output
  python3 src/visualize_export.py /path/to/output /path/to/figures
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from _repo_paths import REPO_ROOT

# Writable config dir (helps CI/sandboxes where ~/.matplotlib is not writable)
_mpl_cfg = REPO_ROOT / ".mplconfig"
_mpl_cfg.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm

import numpy as np


# --- optional: stdlib-only size hint without loading full file ---
def _json_file_size_mb(path: Path) -> float:
    return path.stat().st_size / (1024 * 1024)


def load_json(path: Path) -> dict:
    print(f"  Loading {path.name} ({_json_file_size_mb(path):.1f} MB) …")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def brief_inspect(name: str, data: object, max_depth: int = 2, _d: int = 0) -> None:
    """Print a short structural summary (types, keys, list lengths)."""
    indent = "  " * _d
    if _d > max_depth:
        print(f"{indent}…")
        return
    if isinstance(data, dict):
        print(f"{indent}{name}: dict, keys={list(data.keys())[:12]}{'…' if len(data) > 12 else ''}")
        for k in list(data.keys())[:8]:
            brief_inspect(str(k), data[k], max_depth, _d + 1)
        if len(data) > 8:
            print(f"{indent}  … ({len(data) - 8} more keys)")
    elif isinstance(data, list):
        print(f"{indent}{name}: list, len={len(data)}")
        if data and _d < max_depth:
            brief_inspect("[0]", data[0], max_depth, _d + 1)
    else:
        print(f"{indent}{name}: {type(data).__name__}")


def _das_arrays(das: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return data (n_time, n_chan), z (n_chan, n_time) for imshow, t, dist."""
    data = np.asarray(das["data"], dtype=np.float64)
    t = np.asarray(das["t_s"], dtype=np.float64)
    dist = np.asarray(das["distances_m"], dtype=np.float64)
    z = data.T
    return data, z, t, dist


def plot_das_preview_basic_stats(das: dict) -> dict:
    """
    Compute distribution stats for DAS preview `data`; print summary; return dict.
    """
    if "error" in das:
        print(f"  [DAS stats skipped] {das['error']}")
        return {}
    data, _, _, _ = _das_arrays(das)
    flat = data.ravel()
    qs = (1, 2, 5, 50, 95, 98, 99)
    pct = {f"p{q:02d}": float(np.percentile(flat, q)) for q in qs}
    stats: dict = {
        "shape": list(data.shape),
        "min": float(flat.min()),
        "max": float(flat.max()),
        "mean": float(flat.mean()),
        "std": float(flat.std()),
        "median": float(np.median(flat)),
        **pct,
    }
    n = flat.size
    n_lt_p01 = int((flat < stats["p01"]).sum())
    n_gt_p99 = int((flat > stats["p99"]).sum())
    print("\n── DAS preview data statistics ──")
    print(f"  shape (n_time × n_chan): {stats['shape']}")
    print(f"  min / max:               {stats['min']:.6g} / {stats['max']:.6g}")
    print(f"  mean / std:              {stats['mean']:.6g} / {stats['std']:.6g}")
    print(f"  median:                  {stats['median']:.6g}")
    print("  percentiles:")
    for q in qs:
        print(f"    p{q:02d}: {stats[f'p{q:02d}']:.6g}")
    print(f"  tail beyond p01/p99:     {n_lt_p01} / {n_gt_p99} samples ({100 * (n_lt_p01 + n_gt_p99) / n:.4f}% of pixels)")
    return stats


def plot_das_preview(das: dict, out_path: Path) -> None:
    """Original style: linear normalization from full min→max (often dominated by outliers)."""
    if "error" in das:
        print(f"  [skip DAS] {das['error']}")
        return
    _, z, t, dist = _das_arrays(das)
    fig, ax = plt.subplots(figsize=(10, 5))
    im = ax.imshow(
        z,
        aspect="auto",
        origin="lower",
        extent=(t[0], t[-1], dist[0], dist[-1]),
        cmap="seismic",
        interpolation="nearest",
    )
    ax.set_title("DAS preview — linear scale (full min/max)")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Fiber distance (m)")
    fig.colorbar(im, ax=ax, label=das.get("unit", "amplitude"))
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"  → {out_path}")


def plot_das_preview_robust(
    das: dict,
    out_path: Path,
    p_low: float = 2.0,
    p_high: float = 98.0,
    cmap: str = "RdBu_r",
) -> None:
    """
    Symmetric diverging scale around 0: limit = max(|p_low|, |p_high|) on raw values.
    Values outside [-limit, limit] saturate at the colormap extremes (outliers clipped visually).
    """
    if "error" in das:
        print(f"  [skip DAS robust] {das['error']}")
        return
    data, z, t, dist = _das_arrays(das)
    flat = data.ravel()
    lo = float(np.percentile(flat, p_low))
    hi = float(np.percentile(flat, p_high))
    lim = max(abs(lo), abs(hi))
    if lim < 1e-30:
        lim = float(np.std(flat)) or 1.0

    norm = TwoSlopeNorm(vmin=-lim, vcenter=0.0, vmax=lim)
    fig, ax = plt.subplots(figsize=(10, 5))
    im = ax.imshow(
        z,
        aspect="auto",
        origin="lower",
        extent=(t[0], t[-1], dist[0], dist[-1]),
        cmap=cmap,
        norm=norm,
        interpolation="nearest",
    )
    unit = das.get("unit", "amplitude")
    ax.set_title(
        f"DAS preview — robust ({p_low:.0f}–{p_high:.0f} %ile symmetric clip, ±{lim:.4g} {unit})"
    )
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Fiber distance (m)")
    fig.colorbar(im, ax=ax, label=unit)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"  → {out_path}")


def plot_das_preview_normalized(
    das: dict,
    out_path: Path,
    clip_sigma: float = 3.0,
    cmap: str = "RdBu_r",
) -> None:
    """
    Per-channel z-score along time: (x - mean_t) / std_t for each channel.
    Display with symmetric limits ±clip_sigma (clip for color scale).
    """
    if "error" in das:
        print(f"  [skip DAS normalized] {das['error']}")
        return
    data, _, t, dist = _das_arrays(das)
    mu = data.mean(axis=0, keepdims=True)
    sig = data.std(axis=0, keepdims=True)
    sig = np.where(sig < 1e-12, 1.0, sig)
    zn = (data - mu) / sig
    z = zn.T

    norm = TwoSlopeNorm(vmin=-clip_sigma, vcenter=0.0, vmax=clip_sigma)
    fig, ax = plt.subplots(figsize=(10, 5))
    im = ax.imshow(
        z,
        aspect="auto",
        origin="lower",
        extent=(t[0], t[-1], dist[0], dist[-1]),
        cmap=cmap,
        norm=norm,
        interpolation="nearest",
    )
    ax.set_title(f"DAS preview — per-channel z-score (time), display ±{clip_sigma:.0f} σ")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Fiber distance (m)")
    fig.colorbar(im, ax=ax, label="z-score (per channel)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"  → {out_path}")


def plot_waveform(wf: dict, out_path: Path, recorder: str | None = None, channel: str = "Tetra-Top") -> None:
    if not wf:
        print("  [skip waveform] empty")
        return
    rec = recorder or sorted(wf.keys())[0]
    block = wf[rec]
    chans = block.get("channels") or {}
    if channel not in chans:
        channel = sorted(chans.keys())[0]
    ch = chans[channel]
    t = np.asarray(ch["t_s"], dtype=np.float64)
    y = np.asarray(ch["signal_pa"], dtype=np.float64)
    fig, ax = plt.subplots(figsize=(10, 3.5))
    ax.plot(t, y, lw=0.3, color="C0")
    ax.set_title(f"Hydrophone waveform — {rec} / {channel}")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel(block.get("unit", "Pa"))
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"  → {out_path}")


def plot_spectrogram(spec: dict, out_path: Path, recorder: str | None = None) -> None:
    if not spec:
        print("  [skip spectrogram] empty")
        return
    rec = recorder or sorted(spec.keys())[0]
    block = spec[rec]
    f_hz = np.asarray(block["freqs_hz"], dtype=np.float64)
    t = np.asarray(block["t_s"], dtype=np.float64)
    sxx = np.asarray(block["Sxx_db"], dtype=np.float64)
    fig, ax = plt.subplots(figsize=(10, 5))
    im = ax.imshow(
        sxx,
        aspect="auto",
        origin="lower",
        extent=(t[0], t[-1], f_hz[0], f_hz[-1]),
        cmap="magma",
        interpolation="nearest",
    )
    ax.set_title(f"Spectrogram — {rec} / {block.get('preview_channel', '')}")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Frequency (Hz)")
    fig.colorbar(im, ax=ax, label=block.get("unit", "dB"))
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"  → {out_path}")


def _bathy_extent(bathy: dict) -> tuple[float, float, float, float] | None:
    """Return (xmin, xmax, ymin, ymax) for imshow extent, or None."""
    attrs = bathy.get("attrs") or {}
    try:
        xmin = float(attrs["X min"])
        xmax = float(attrs["X max"])
        ymin = float(attrs["Y min"])
        ymax = float(attrs["Y max"])
        return xmin, xmax, ymin, ymax
    except (KeyError, TypeError, ValueError):
        pass
    xc = bathy.get("x_coords") or []
    yc = bathy.get("y_coords") or []
    if len(xc) >= 2 and len(yc) >= 2:
        return float(xc[0]), float(xc[-1]), float(yc[0]), float(yc[-1])
    return None


def _fiber_xy(segments: dict) -> tuple[list[float], list[float]]:
    xs: list[float] = []
    ys: list[float] = []
    for _name, pts in segments.items():
        if not isinstance(pts, list):
            continue
        for p in pts:
            if not isinstance(p, dict):
                continue
            if "x" in p and "y" in p:
                xs.append(float(p["x"]))
                ys.append(float(p["y"]))
    return xs, ys


def _boat_tracks_xy(tracks: dict) -> list[tuple[str, list[float], list[float]]]:
    out: list[tuple[str, list[float], list[float]]] = []
    if not isinstance(tracks, dict):
        return out
    for name, item in tracks.items():
        if isinstance(item, list):
            xs = [float(p["x"]) for p in item if isinstance(p, dict) and "x" in p]
            ys = [float(p["y"]) for p in item if isinstance(p, dict) and "y" in p]
            if xs:
                out.append((name, xs, ys))
        # nested dict of lists (shots sub-groups) — one line per sub-track
        elif isinstance(item, dict):
            for sub, lst in item.items():
                if not isinstance(lst, list):
                    continue
                xs = [float(p["x"]) for p in lst if isinstance(p, dict) and "x" in p]
                ys = [float(p["y"]) for p in lst if isinstance(p, dict) and "y" in p]
                if xs:
                    out.append((f"{name}/{sub}", xs, ys))
    return out


def plot_situation(sit: dict, out_path: Path, draw_boats: bool = True) -> None:
    if "error" in sit:
        print(f"  [skip situation] {sit['error']}")
        return
    bathy = sit.get("bathymetry") or {}
    grid = np.asarray(bathy.get("depth_grid") or [], dtype=np.float64)
    if grid.size == 0:
        print("  [skip situation] no depth_grid")
        return

    extent = _bathy_extent(bathy)
    fig, ax = plt.subplots(figsize=(8, 7))
    if extent:
        xmin, xmax, ymin, ymax = extent
        # imshow: rows ~ Y, cols ~ X; origin upper → row0 at top = ymax
        ax.imshow(
            grid,
            extent=[xmin, xmax, ymin, ymax],
            origin="upper",
            cmap="Blues_r",
            aspect="equal",
            interpolation="nearest",
        )
        ax.set_xlabel("Easting (m, CH1903+ / LV95)")
        ax.set_ylabel("Northing (m)")
    else:
        ax.imshow(grid, origin="upper", cmap="Blues_r", aspect="equal", interpolation="nearest")
        ax.set_xlabel("Grid column index")
        ax.set_ylabel("Grid row index")

    ax.set_title("Bathymetry + fiber track" + (" + boat tracks" if draw_boats else ""))

    ft = sit.get("fiber_track") or {}
    segs = ft.get("segments") or {}
    fx, fy = _fiber_xy(segs)
    if fx:
        ax.plot(fx, fy, color="orangered", lw=1.2, label="Fiber", zorder=5)

    if draw_boats:
        bt = (sit.get("boat_tracks") or {}).get("tracks") or {}
        boat_lines = _boat_tracks_xy(bt)
        for i, (label, bx, by) in enumerate(boat_lines):
            ax.plot(bx, by, lw=0.8, alpha=0.65, label=label if i < 6 else None, zorder=4)
        if len(boat_lines) > 6:
            ax.plot([], [], label="… more tracks", color="none")

    ax.legend(loc="upper right", fontsize=7)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"  → {out_path}")


def print_text_summary(shot: dict, rec_sum: dict) -> None:
    print("\n── shot_metadata (summary) ──")
    print(f"  file: {shot.get('file')}")
    print(f"  groups: {shot.get('groups_present')}")
    print(f"  recorders: {shot.get('recorders_available')}")
    if shot.get("das"):
        d = shot["das"]
        print(f"  DAS: {d.get('n_samples')} × {d.get('n_channels')} @ {d.get('fs_hz')} Hz")
    if shot.get("source"):
        s = shot["source"]
        print(f"  Source: {s.get('duration_s')} s @ {s.get('fs_hz')} Hz")

    print("\n── recorders_summary ──")
    for rname, rd in rec_sum.items():
        rms = rd.get("rms_pa") or {}
        print(f"  {rname}: RMS Pa = {rms}")


def run_all_plots(out_dir: Path, fig_dir: Path, *, verbose_inspect: bool = True) -> None:
    """
    Load JSON from out_dir, write all figures under fig_dir.
    Used by visualize_export.py CLI and screen_shots.py batch driver.
    """
    fig_dir.mkdir(parents=True, exist_ok=True)

    print(f"JSON directory: {out_dir}")
    print(f"Figures output: {fig_dir}\n")

    paths = {
        "shot_metadata": out_dir / "shot_metadata.json",
        "recorders_summary": out_dir / "recorders_summary.json",
        "das_preview": out_dir / "das_preview.json",
        "spectrogram": out_dir / "spectrogram.json",
        "waveform": out_dir / "waveform.json",
        "situation": out_dir / "situation.json",
    }

    for _label, p in paths.items():
        if not p.is_file():
            print(f"Missing: {p}")
            sys.exit(1)

    if verbose_inspect:
        print("── Brief structure inspect ──")
    shot = load_json(paths["shot_metadata"])
    if verbose_inspect:
        brief_inspect("shot_metadata", shot, max_depth=1)

    rec_sum = load_json(paths["recorders_summary"])
    if verbose_inspect:
        brief_inspect("recorders_summary", rec_sum, max_depth=1)

    das = load_json(paths["das_preview"])
    if verbose_inspect:
        brief_inspect("das_preview", {k: das[k] for k in ("description", "n_time", "n_channels") if k in das})

    spec = load_json(paths["spectrogram"])
    if verbose_inspect:
        brief_inspect(
            "spectrogram",
            {"recorders": list(spec.keys())} if isinstance(spec, dict) else spec,
        )

    wf = load_json(paths["waveform"])
    if verbose_inspect:
        brief_inspect(
            "waveform",
            {"recorders": list(wf.keys())} if isinstance(wf, dict) else wf,
        )

    sit = load_json(paths["situation"])
    if verbose_inspect:
        brief_inspect(
            "situation",
            {
                "meta_keys": list((sit.get("meta") or {}).keys())[:6],
                "bathymetry_shape": (sit.get("bathymetry") or {}).get("shape"),
                "fiber_segments": list(((sit.get("fiber_track") or {}).get("segments") or {}).keys()),
                "boat_track_names": list(((sit.get("boat_tracks") or {}).get("tracks") or {}).keys())[:8],
            },
        )

    print_text_summary(shot, rec_sum)

    first_rec = None
    if isinstance(rec_sum, dict) and rec_sum:
        first_rec = sorted(rec_sum.keys())[0]

    print("\n── Plotting ──")
    plot_das_preview_basic_stats(das)
    plot_das_preview(das, fig_dir / "das_preview.png")
    plot_das_preview_robust(das, fig_dir / "das_preview_robust.png", p_low=2, p_high=98)
    plot_das_preview_normalized(das, fig_dir / "das_preview_normalized.png", clip_sigma=3.0)
    plot_waveform(wf, fig_dir / "waveform.png", recorder=first_rec)
    plot_spectrogram(spec, fig_dir / "spectrogram.png", recorder=first_rec)
    plot_situation(sit, fig_dir / "situation.png", draw_boats=True)

    print("\nDone.")


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "output"
    fig_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else REPO_ROOT / "figures"
    run_all_plots(out_dir, fig_dir, verbose_inspect=True)


if __name__ == "__main__":
    main()
