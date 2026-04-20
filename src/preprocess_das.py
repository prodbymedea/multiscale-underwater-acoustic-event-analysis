#!/usr/bin/env python3
"""
Whales-subset DAS preprocessing prototype (Sprint 2 backend, Step 1).

Purpose:
  - keep pipeline simple and reproducible for MVP,
  - improve DAS representation before later rolling-RMS activity maps.

Implemented preprocessing chain:
  1) per-channel median removal (time axis),
  2) optional temporal Butterworth high-pass / band-pass,
  3) per-channel robust normalization (MAD-based z-like scaling),
  4) clipping for stable visualization.

Outputs (per shot):
  - output/shots/<shot>/das_preprocessed_preview.npz
  - output/shots/<shot>/das_preprocessing_metadata.json
  - figures/shots/<shot>/das_preprocessed_preview.png
  - figures/shots/<shot>/das_raw_vs_preprocessed.png

Usage:
  python3 src/preprocess_das.py --shot whales_humpback
  python3 src/preprocess_das.py --shot whales_orca --duration-s 60 --channel-step 8
  python3 src/preprocess_das.py --shot whales_humpback --fmin 15 --fmax 1200
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import h5py
import numpy as np
from scipy.signal import butter, sosfiltfilt

from _repo_paths import REPO_ROOT, resolve_shot_h5

# Make matplotlib cache writable in constrained environments.
_mpl_cfg = REPO_ROOT / ".mplconfig"
_mpl_cfg.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm


WHALES_SHOTS = {
    "whales_humpback": {
        "subdir": "2022-01-26--04--Whales",
        "filename": "2022-01-26--04-46-16--Humpback.h5",
    },
    "whales_orca": {
        "subdir": "2022-01-26--04--Whales",
        "filename": "2022-01-26--04-47-42--Orca.h5",
    },
}


def _shot_path_from_slug(slug: str) -> Path:
    if slug not in WHALES_SHOTS:
        raise ValueError(
            f"Unsupported shot slug {slug!r}. Use one of {sorted(WHALES_SHOTS)} "
            "(Sprint 2 scope is Whales subset only)."
        )
    spec = WHALES_SHOTS[slug]
    return resolve_shot_h5(spec["subdir"], spec["filename"])


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


def _design_filter(fs_hz: float, fmin: float | None, fmax: float | None, order: int):
    nyq = fs_hz * 0.5
    if fmin is None and fmax is None:
        return None, "none"

    if fmin is not None and fmax is not None:
        if not (0 < fmin < fmax < nyq):
            raise ValueError(
                f"Invalid band-pass range [{fmin}, {fmax}] for fs={fs_hz} (Nyquist={nyq})."
            )
        sos = butter(order, [fmin, fmax], btype="bandpass", fs=fs_hz, output="sos")
        return sos, "bandpass"

    if fmin is not None:
        if not (0 < fmin < nyq):
            raise ValueError(f"Invalid high-pass fmin={fmin} for fs={fs_hz}.")
        sos = butter(order, fmin, btype="highpass", fs=fs_hz, output="sos")
        return sos, "highpass"

    if not (0 < fmax < nyq):
        raise ValueError(f"Invalid low-pass fmax={fmax} for fs={fs_hz}.")
    sos = butter(order, fmax, btype="lowpass", fs=fs_hz, output="sos")
    return sos, "lowpass"


def _robust_channel_norm(x: np.ndarray, clip_abs: float) -> tuple[np.ndarray, dict[str, float]]:
    # x shape: [n_time, n_chan]
    med = np.median(x, axis=0, keepdims=True)
    mad = np.median(np.abs(x - med), axis=0, keepdims=True)
    robust_sigma = 1.4826 * mad
    fallback = np.std(x, axis=0, keepdims=True)
    scale = np.where(robust_sigma > 1e-12, robust_sigma, np.where(fallback > 1e-12, fallback, 1.0))
    z = (x - med) / scale
    if clip_abs > 0:
        z = np.clip(z, -clip_abs, clip_abs)
    meta = {
        "median_of_channel_medians": float(np.median(med)),
        "median_of_channel_scales": float(np.median(scale)),
        "clip_abs": float(clip_abs),
    }
    return z.astype(np.float32), meta


def _plot_preprocessed_only(
    pre: np.ndarray,
    t_s: np.ndarray,
    dist_m: np.ndarray,
    out_path: Path,
    shot_slug: str,
) -> None:
    z = pre.T
    fig, ax = plt.subplots(figsize=(10, 5))
    im = ax.imshow(
        z,
        aspect="auto",
        origin="lower",
        extent=(float(t_s[0]), float(t_s[-1]), float(dist_m[0]), float(dist_m[-1])),
        cmap="RdBu_r",
        norm=TwoSlopeNorm(vmin=-3, vcenter=0.0, vmax=3),
        interpolation="nearest",
    )
    ax.set_title(f"DAS preprocessed preview ({shot_slug})")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Fiber distance (m)")
    fig.colorbar(im, ax=ax, label="normalized amplitude (robust z-like)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def _plot_raw_vs_pre(
    raw: np.ndarray,
    pre: np.ndarray,
    t_s: np.ndarray,
    dist_m: np.ndarray,
    out_path: Path,
    shot_slug: str,
) -> None:
    raw_lim = max(
        abs(float(np.percentile(raw, 2))),
        abs(float(np.percentile(raw, 98))),
    )
    raw_lim = raw_lim if raw_lim > 1e-9 else float(np.std(raw)) or 1.0

    fig, axs = plt.subplots(2, 1, figsize=(11, 8), sharex=True, constrained_layout=True)
    extent = (float(t_s[0]), float(t_s[-1]), float(dist_m[0]), float(dist_m[-1]))

    im0 = axs[0].imshow(
        raw.T,
        aspect="auto",
        origin="lower",
        extent=extent,
        cmap="RdBu_r",
        norm=TwoSlopeNorm(vmin=-raw_lim, vcenter=0.0, vmax=raw_lim),
        interpolation="nearest",
    )
    axs[0].set_title(f"Raw DAS preview (robust color clip) — {shot_slug}")
    axs[0].set_ylabel("Fiber distance (m)")
    fig.colorbar(im0, ax=axs[0], label="raw scaled DAS")

    im1 = axs[1].imshow(
        pre.T,
        aspect="auto",
        origin="lower",
        extent=extent,
        cmap="RdBu_r",
        norm=TwoSlopeNorm(vmin=-3, vcenter=0.0, vmax=3),
        interpolation="nearest",
    )
    axs[1].set_title("Preprocessed DAS preview (median removed + filter + robust normalization)")
    axs[1].set_xlabel("Time (s)")
    axs[1].set_ylabel("Fiber distance (m)")
    fig.colorbar(im1, ax=axs[1], label="normalized amplitude")

    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Whales-subset DAS preprocessing prototype")
    ap.add_argument("--shot", required=True, choices=sorted(WHALES_SHOTS))
    ap.add_argument("--shot-path", type=Path, default=None, help="Optional explicit path to .h5 shot")
    ap.add_argument("--start-s", type=float, default=0.0)
    ap.add_argument("--duration-s", type=float, default=45.0, help="0 or negative -> until file end")
    ap.add_argument("--max-samples", type=int, default=220000, help="Safety cap for MVP runs")
    ap.add_argument("--channel-step", type=int, default=5)
    ap.add_argument("--max-channels", type=int, default=200)
    ap.add_argument("--preview-downsample", type=int, default=10)
    ap.add_argument("--fmin", type=float, default=15.0, help="None via negative value")
    ap.add_argument("--fmax", type=float, default=1200.0, help="None via negative value")
    ap.add_argument("--filter-order", type=int, default=4)
    ap.add_argument("--clip-abs", type=float, default=8.0)
    ap.add_argument("--out-dir", type=Path, default=None)
    ap.add_argument("--fig-dir", type=Path, default=None)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    shot_slug = args.shot
    shot_path = args.shot_path or _shot_path_from_slug(shot_slug)
    if not shot_path.is_file():
        raise SystemExit(f"Shot not found: {shot_path}")

    out_dir = args.out_dir or (REPO_ROOT / "output" / "shots" / shot_slug)
    fig_dir = args.fig_dir or (REPO_ROOT / "figures" / "shots" / shot_slug)
    out_dir.mkdir(parents=True, exist_ok=True)
    fig_dir.mkdir(parents=True, exist_ok=True)

    fmin = args.fmin if args.fmin > 0 else None
    fmax = args.fmax if args.fmax > 0 else None

    with h5py.File(shot_path, "r") as f:
        if "DAS" not in f:
            raise SystemExit(f"DAS dataset not found in shot: {shot_path}")
        das = f["DAS"]
        n_samples, n_channels = das.shape
        attrs = dict(das.attrs)
        fs_hz = float(attrs.get("OutputDataRate", 5000.0))
        amp_scaling = float(attrs.get("AmpScaling", 1.0))
        start_dist = float(attrs.get("StartDistance", 0.0))
        spatial_res = float(attrs.get("SpatialResolution", 1.0))

        start_idx = max(0, int(round(args.start_s * fs_hz)))
        if args.duration_s and args.duration_s > 0:
            end_idx = min(n_samples, start_idx + int(round(args.duration_s * fs_hz)))
        else:
            end_idx = n_samples
        if args.max_samples > 0 and (end_idx - start_idx) > args.max_samples:
            end_idx = start_idx + args.max_samples
        if end_idx <= start_idx:
            raise SystemExit("Empty selected interval; adjust --start-s / --duration-s.")

        chan_indices = np.arange(0, n_channels, max(1, args.channel_step), dtype=np.int32)
        if args.max_channels > 0:
            chan_indices = chan_indices[: args.max_channels]

        raw = das[start_idx:end_idx, chan_indices].astype(np.float32) * amp_scaling

    # 1) Per-channel median removal (robust detrend)
    centered = raw - np.median(raw, axis=0, keepdims=True)

    # 2) Optional temporal filtering
    sos, filter_kind = _design_filter(fs_hz, fmin, fmax, args.filter_order)
    if sos is not None:
        filtered = sosfiltfilt(sos, centered, axis=0)
    else:
        filtered = centered

    # 3) Robust channel-wise normalization + clipping for display readiness
    preprocessed, norm_meta = _robust_channel_norm(filtered, clip_abs=args.clip_abs)

    ds = max(1, args.preview_downsample)
    raw_preview = raw[::ds, :]
    pre_preview = preprocessed[::ds, :]
    t_s = start_idx / fs_hz + np.arange(raw_preview.shape[0]) * (ds / fs_hz)
    distances_m = start_dist + chan_indices.astype(np.float64) * spatial_res

    npz_path = out_dir / "das_preprocessed_preview.npz"
    np.savez_compressed(
        npz_path,
        raw_preview=raw_preview.astype(np.float32),
        preprocessed_preview=pre_preview.astype(np.float32),
        t_s=t_s.astype(np.float32),
        channel_indices=chan_indices.astype(np.int32),
        distances_m=distances_m.astype(np.float32),
    )

    meta: dict[str, Any] = {
        "schema_version": "das_preprocess_preview_v1",
        "shot_slug": shot_slug,
        "shot_path": str(shot_path.resolve()),
        "das_shape_n_samples_x_n_channels": [int(n_samples), int(n_channels)],
        "sampling_rate_hz": fs_hz,
        "amp_scaling": amp_scaling,
        "selected_interval": {
            "start_idx": int(start_idx),
            "end_idx": int(end_idx),
            "n_samples_selected": int(end_idx - start_idx),
            "start_time_s": float(start_idx / fs_hz),
            "end_time_s": float(end_idx / fs_hz),
        },
        "channel_selection": {
            "channel_step": int(args.channel_step),
            "max_channels": int(args.max_channels),
            "n_channels_selected": int(len(chan_indices)),
            "channel_indices": chan_indices.tolist(),
            "distances_m_min_max": [float(distances_m.min()), float(distances_m.max())],
        },
        "preprocessing": {
            "centering": "per-channel median removal over selected interval",
            "filter_kind": filter_kind,
            "filter_order": int(args.filter_order),
            "fmin_hz": fmin,
            "fmax_hz": fmax,
            "normalization": "per-channel robust z-like scaling using MAD",
            "normalization_meta": norm_meta,
            "preview_downsample_factor": int(ds),
        },
        "stats": {
            "raw_selected": _percentile_stats(raw),
            "preprocessed_selected": _percentile_stats(preprocessed),
            "raw_preview": _percentile_stats(raw_preview),
            "preprocessed_preview": _percentile_stats(pre_preview),
        },
        "outputs": {
            "npz_path": str(npz_path.resolve()),
            "comparison_figure": str((fig_dir / "das_raw_vs_preprocessed.png").resolve()),
            "preprocessed_figure": str((fig_dir / "das_preprocessed_preview.png").resolve()),
        },
    }

    meta_path = out_dir / "das_preprocessing_metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    _plot_preprocessed_only(
        pre_preview,
        t_s=t_s,
        dist_m=distances_m,
        out_path=fig_dir / "das_preprocessed_preview.png",
        shot_slug=shot_slug,
    )
    _plot_raw_vs_pre(
        raw_preview,
        pre_preview,
        t_s=t_s,
        dist_m=distances_m,
        out_path=fig_dir / "das_raw_vs_preprocessed.png",
        shot_slug=shot_slug,
    )

    print(f"Shot: {shot_slug}")
    print(f"Loaded: {shot_path}")
    print(f"Selected interval samples: [{start_idx}, {end_idx}) -> {end_idx - start_idx}")
    print(f"Selected channels: {len(chan_indices)} (step={args.channel_step})")
    print(f"Filter: {filter_kind}, fmin={fmin}, fmax={fmax}, order={args.filter_order}")
    print(f"Saved: {npz_path}")
    print(f"Saved: {meta_path}")
    print(f"Saved: {fig_dir / 'das_preprocessed_preview.png'}")
    print(f"Saved: {fig_dir / 'das_raw_vs_preprocessed.png'}")


if __name__ == "__main__":
    main()
