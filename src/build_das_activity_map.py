#!/usr/bin/env python3
"""
Build DAS activity representation from Step-1 preprocessed previews.

Sprint 2 backend, Step 2:
  - input: das_preprocessed_preview.npz from src/preprocess_das.py
  - method: rolling RMS over time per channel
  - output: normalized DAS activity map for visualization (not whale probability)

Default scope is Whales subset only:
  - whales_humpback
  - whales_orca

Usage:
  python3 src/build_das_activity_map.py --shot whales_humpback
  python3 src/build_das_activity_map.py --shot whales_orca
  python3 src/build_das_activity_map.py --shot whales_humpback --window-s 0.5 --hop-s 0.1 --normalize per-channel
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import numpy as np

from _repo_paths import REPO_ROOT

# Make matplotlib cache writable in constrained environments.
_mpl_cfg = REPO_ROOT / ".mplconfig"
_mpl_cfg.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


WHALES_SHOTS = ("whales_humpback", "whales_orca")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Build normalized rolling RMS DAS activity map")
    ap.add_argument("--shot", required=True, choices=WHALES_SHOTS)
    ap.add_argument("--input-npz", type=Path, default=None, help="Override Step-1 npz input path")
    ap.add_argument(
        "--input-meta",
        type=Path,
        default=None,
        help="Override Step-1 preprocessing metadata json path",
    )
    ap.add_argument("--window-s", type=float, default=0.5, help="Rolling RMS window length in seconds")
    ap.add_argument("--hop-s", type=float, default=0.1, help="Rolling RMS hop in seconds")
    ap.add_argument(
        "--normalize",
        choices=("per-channel", "global", "none"),
        default="per-channel",
        help="Normalization strategy for activity map",
    )
    ap.add_argument(
        "--p-low",
        type=float,
        default=5.0,
        help="Lower percentile for normalization (activity floor)",
    )
    ap.add_argument(
        "--clip-percentile",
        type=float,
        default=99.0,
        help="Upper percentile for normalization (activity ceiling)",
    )
    ap.add_argument(
        "--save-raw-rms",
        action="store_true",
        help="Also save raw rolling RMS map in npz (larger output)",
    )
    ap.add_argument("--out-dir", type=Path, default=None, help="Output directory for NPZ/JSON")
    ap.add_argument("--fig-dir", type=Path, default=None, help="Figure output directory")
    ap.add_argument("--no-figures", action="store_true", help="Do not write diagnostic PNG figures.")
    return ap.parse_args()


def _percentile_stats(arr: np.ndarray) -> dict[str, float]:
    flat = arr.ravel()
    q = np.percentile(flat, [1, 2, 5, 50, 95, 98, 99])
    return {
        "min": float(flat.min()),
        "max": float(flat.max()),
        "mean": float(flat.mean()),
        "std": float(flat.std()),
        "p01": float(q[0]),
        "p02": float(q[1]),
        "p05": float(q[2]),
        "p50": float(q[3]),
        "p95": float(q[4]),
        "p98": float(q[5]),
        "p99": float(q[6]),
    }


def _rolling_rms(
    x: np.ndarray,
    win_samples: int,
    hop_samples: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Efficient rolling RMS via cumulative sum over squared data.

    Returns:
      rms_map [n_windows, n_channels]
      starts [n_windows]
      centers [n_windows]
    """
    if x.ndim != 2:
        raise ValueError(f"Expected 2D array [n_time, n_channels], got {x.shape}")
    n_time = x.shape[0]
    if n_time < win_samples:
        raise ValueError(
            f"Input too short for requested window: n_time={n_time}, win_samples={win_samples}"
        )
    starts = np.arange(0, n_time - win_samples + 1, hop_samples, dtype=np.int32)
    centers = starts + (win_samples // 2)

    sq = x.astype(np.float64) ** 2
    csum = np.vstack([np.zeros((1, sq.shape[1]), dtype=np.float64), np.cumsum(sq, axis=0)])
    win_energy = csum[starts + win_samples] - csum[starts]
    rms = np.sqrt(np.maximum(win_energy / float(win_samples), 0.0))
    return rms.astype(np.float32), starts, centers


def _normalize_activity(
    rms: np.ndarray,
    mode: str,
    p_low: float,
    p_high: float,
) -> tuple[np.ndarray, dict[str, Any]]:
    if mode == "none":
        return rms.astype(np.float32), {"mode": "none"}

    if not (0 <= p_low < p_high <= 100):
        raise ValueError(f"Invalid percentiles p_low={p_low}, p_high={p_high}")

    if mode == "global":
        lo = float(np.percentile(rms, p_low))
        hi = float(np.percentile(rms, p_high))
        denom = hi - lo if hi > lo else 1.0
        act = np.clip((rms - lo) / denom, 0.0, 1.0)
        meta = {
            "mode": "global",
            "p_low": float(p_low),
            "p_high": float(p_high),
            "lo": lo,
            "hi": hi,
        }
        return act.astype(np.float32), meta

    # per-channel normalization
    lo = np.percentile(rms, p_low, axis=0, keepdims=True)
    hi = np.percentile(rms, p_high, axis=0, keepdims=True)
    denom = np.where(hi > lo, hi - lo, 1.0)
    act = np.clip((rms - lo) / denom, 0.0, 1.0)
    meta = {
        "mode": "per-channel",
        "p_low": float(p_low),
        "p_high": float(p_high),
        "median_lo": float(np.median(lo)),
        "median_hi": float(np.median(hi)),
    }
    return act.astype(np.float32), meta


def _plot_activity_map(
    activity: np.ndarray,
    t_windows_s: np.ndarray,
    distances_m: np.ndarray,
    shot: str,
    out_path: Path,
) -> None:
    fig, ax = plt.subplots(figsize=(10, 5))
    im = ax.imshow(
        activity.T,
        aspect="auto",
        origin="lower",
        extent=(float(t_windows_s[0]), float(t_windows_s[-1]), float(distances_m[0]), float(distances_m[-1])),
        cmap="inferno",
        vmin=0.0,
        vmax=1.0,
        interpolation="nearest",
    )
    ax.set_title(f"DAS activity map (normalized rolling RMS) — {shot}")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Fiber distance (m)")
    fig.colorbar(im, ax=ax, label="normalized DAS activity [0, 1]")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def _plot_rms_vs_activity(
    rms: np.ndarray,
    activity: np.ndarray,
    t_windows_s: np.ndarray,
    distances_m: np.ndarray,
    shot: str,
    out_path: Path,
) -> None:
    fig, axs = plt.subplots(2, 1, figsize=(11, 8), sharex=True, constrained_layout=True)
    extent = (
        float(t_windows_s[0]),
        float(t_windows_s[-1]),
        float(distances_m[0]),
        float(distances_m[-1]),
    )

    vmin = float(np.percentile(rms, 5))
    vmax = float(np.percentile(rms, 99))
    if vmax <= vmin:
        vmax = vmin + 1e-6

    im0 = axs[0].imshow(
        rms.T,
        aspect="auto",
        origin="lower",
        extent=extent,
        cmap="magma",
        vmin=vmin,
        vmax=vmax,
        interpolation="nearest",
    )
    axs[0].set_title(f"Rolling RMS (raw scale) — {shot}")
    axs[0].set_ylabel("Fiber distance (m)")
    fig.colorbar(im0, ax=axs[0], label="RMS")

    im1 = axs[1].imshow(
        activity.T,
        aspect="auto",
        origin="lower",
        extent=extent,
        cmap="inferno",
        vmin=0.0,
        vmax=1.0,
        interpolation="nearest",
    )
    axs[1].set_title("Normalized DAS activity")
    axs[1].set_xlabel("Time (s)")
    axs[1].set_ylabel("Fiber distance (m)")
    fig.colorbar(im1, ax=axs[1], label="Activity [0, 1]")

    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def main() -> None:
    args = parse_args()
    shot = args.shot

    out_dir = args.out_dir or (REPO_ROOT / "output" / "shots" / shot)
    fig_dir = args.fig_dir or (REPO_ROOT / "figures" / "shots" / shot)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not args.no_figures:
        fig_dir.mkdir(parents=True, exist_ok=True)

    input_npz = args.input_npz or (out_dir / "das_preprocessed_preview.npz")
    input_meta = args.input_meta or (out_dir / "das_preprocessing_metadata.json")
    if not input_npz.is_file():
        raise SystemExit(f"Missing preprocessed input npz: {input_npz}")

    z = np.load(input_npz)
    required = ("preprocessed_preview", "t_s", "channel_indices", "distances_m")
    missing = [k for k in required if k not in z]
    if missing:
        raise SystemExit(f"Input npz missing keys: {missing}. Found keys: {list(z.keys())}")

    pre = np.asarray(z["preprocessed_preview"], dtype=np.float32)
    t_s = np.asarray(z["t_s"], dtype=np.float64)
    channel_indices = np.asarray(z["channel_indices"], dtype=np.int32)
    distances_m = np.asarray(z["distances_m"], dtype=np.float64)

    if pre.ndim != 2:
        raise SystemExit(f"Expected preprocessed_preview to be 2D [n_time, n_channels], got {pre.shape}")
    if len(t_s) != pre.shape[0]:
        raise SystemExit(f"t_s length {len(t_s)} does not match n_time {pre.shape[0]}")

    dt = float(np.median(np.diff(t_s))) if len(t_s) > 1 else 0.002
    preview_fs_hz = 1.0 / dt if dt > 0 else 500.0

    win_samples = max(2, int(round(args.window_s * preview_fs_hz)))
    hop_samples = max(1, int(round(args.hop_s * preview_fs_hz)))

    rms_map, starts, centers = _rolling_rms(pre, win_samples=win_samples, hop_samples=hop_samples)
    t_windows_s = t_s[centers]

    activity_map, norm_meta = _normalize_activity(
        rms_map,
        mode=args.normalize,
        p_low=args.p_low,
        p_high=args.clip_percentile,
    )

    out_npz = out_dir / "das_activity_map.npz"
    npz_kwargs: dict[str, Any] = {
        "activity_map": activity_map.astype(np.float32),  # [n_windows, n_channels]
        "t_windows_s": t_windows_s.astype(np.float32),
        "window_start_indices": starts.astype(np.int32),
        "channel_indices": channel_indices.astype(np.int32),
        "distances_m": distances_m.astype(np.float32),
    }
    if args.save_raw_rms:
        npz_kwargs["rolling_rms"] = rms_map.astype(np.float32)
    np.savez_compressed(out_npz, **npz_kwargs)

    preprocess_meta: dict[str, Any] | None = None
    if input_meta.is_file():
        with open(input_meta, "r", encoding="utf-8") as f:
            preprocess_meta = json.load(f)

    out_meta = {
        "schema_version": "das_activity_map_v1",
        "shot_slug": shot,
        "input_files": {
            "preprocessed_npz": str(input_npz.resolve()),
            "preprocessing_metadata": str(input_meta.resolve()) if input_meta.is_file() else None,
        },
        "detected_input_structure": {
            "npz_keys": list(z.keys()),
            "preprocessed_shape_n_time_x_n_channels": [int(pre.shape[0]), int(pre.shape[1])],
            "t_s_shape": [int(len(t_s))],
            "channel_indices_shape": [int(len(channel_indices))],
            "distances_m_shape": [int(len(distances_m))],
            "preview_dt_s": dt,
            "preview_fs_hz": preview_fs_hz,
        },
        "rolling_rms_parameters": {
            "window_s": float(args.window_s),
            "hop_s": float(args.hop_s),
            "window_samples": int(win_samples),
            "hop_samples": int(hop_samples),
            "n_windows": int(activity_map.shape[0]),
        },
        "normalization": norm_meta,
        "output_arrays": {
            "activity_map_shape_n_windows_x_n_channels": [
                int(activity_map.shape[0]),
                int(activity_map.shape[1]),
            ],
            "activity_value_range": [float(activity_map.min()), float(activity_map.max())],
            "rolling_rms_saved": bool(args.save_raw_rms),
        },
        "stats": {
            "rolling_rms": _percentile_stats(rms_map),
            "activity_map": _percentile_stats(activity_map),
        },
        "source_preprocessing_summary": preprocess_meta.get("preprocessing") if preprocess_meta else None,
        "notes": (
            "This map represents normalized rolling RMS DAS activity for visualization. "
            "It is not a calibrated whale probability and not a classifier output."
        ),
    }

    out_meta_path = out_dir / "das_activity_map_metadata.json"
    with open(out_meta_path, "w", encoding="utf-8") as f:
        json.dump(out_meta, f, indent=2, ensure_ascii=False)

    fig_activity = None
    fig_compare = None
    if not args.no_figures:
        fig_activity = fig_dir / "das_activity_map.png"
        fig_compare = fig_dir / "das_rms_vs_activity.png"
        _plot_activity_map(activity_map, t_windows_s, distances_m, shot=shot, out_path=fig_activity)
        _plot_rms_vs_activity(rms_map, activity_map, t_windows_s, distances_m, shot=shot, out_path=fig_compare)

    print(f"Shot: {shot}")
    print(f"Input npz keys: {list(z.keys())}")
    print(f"Input preprocessed shape: {pre.shape}, dt={dt:.6f}s, fs~{preview_fs_hz:.2f} Hz")
    print(
        f"Rolling RMS: window={args.window_s}s ({win_samples} samples), "
        f"hop={args.hop_s}s ({hop_samples} samples), n_windows={activity_map.shape[0]}"
    )
    print(f"Normalization: {norm_meta}")
    print(f"Saved: {out_npz}")
    print(f"Saved: {out_meta_path}")
    if fig_activity and fig_compare:
        print(f"Saved: {fig_activity}")
        print(f"Saved: {fig_compare}")
    else:
        print("Skipped diagnostic figures (--no-figures)")


if __name__ == "__main__":
    main()
