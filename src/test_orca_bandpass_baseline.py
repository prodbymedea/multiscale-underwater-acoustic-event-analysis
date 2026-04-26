#!/usr/bin/env python3
"""
Orca-focused DAS band-pass diagnostic (Backend Task 3).

Exploratory DAS-side baseline only:
  - band-limited energy / envelope / smoothed score,
  - optional robust threshold → signal_present_mask,
  - not whale probability, not ML, not a replacement for hydrophone or activity-map pipelines.

Frequency note:
  - `das_preprocessed_preview.npz` is ~500 Hz (10× downsample from 5 kHz). Nyquist ~250 Hz.
  - Supervisor-suggested 2–3 kHz bands require the native DAS rate from the shot HDF5 (5000 Hz;
    Nyquist 2500 Hz). Bands above 2500 Hz are not representable without inventing content.

Usage (repo root):
  python3 src/test_orca_bandpass_baseline.py
  python3 src/test_orca_bandpass_baseline.py --preview-cols 189,12,50
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import h5py
import numpy as np
from scipy.signal import butter, hilbert, sosfiltfilt

from _repo_paths import REPO_ROOT, resolve_shot_h5

_mpl_cfg = REPO_ROOT / ".mplconfig"
_mpl_cfg.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

SHOT_SLUG = "whales_orca"
ORCA_SUBDIR = "2022-01-26--04--Whales"
ORCA_FILE = "2022-01-26--04-47-42--Orca.h5"


def _mad_threshold(x: np.ndarray, k: float) -> float:
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    sig = 1.4826 * mad if mad > 1e-12 else float(np.std(x)) or 1.0
    return med + k * sig


def _robust_norm_01(x: np.ndarray, p_low: float, p_high: float) -> tuple[np.ndarray, dict[str, float]]:
    lo = float(np.percentile(x, p_low))
    hi = float(np.percentile(x, p_high))
    d = hi - lo if hi > lo else 1.0
    y = np.clip((x - lo) / d, 0.0, 1.0).astype(np.float32)
    return y, {"p_low": p_low, "p_high": p_high, "lo": lo, "hi": hi}


def _band_sos(fs_hz: float, f_lo: float, f_hi: float, order: int = 4):
    nyq = 0.5 * fs_hz
    if not (0 < f_lo < f_hi < nyq * 0.99):
        raise ValueError(
            f"Band [{f_lo}, {f_hi}] Hz invalid for fs={fs_hz} (Nyquist={nyq}). "
            "Orca nominal 2–3 kHz cannot be represented above Nyquist."
        )
    return butter(order, [f_lo / nyq, f_hi / nyq], btype="band", output="sos")


def _rolling_rms_1d(x: np.ndarray, win: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    if win < 3 or win > len(x):
        return np.sqrt(np.maximum(x, 0.0))
    w = np.ones(win, dtype=np.float64) / float(win)
    ex2 = np.convolve(x * x, w, mode="same")
    return np.sqrt(np.maximum(ex2, 0.0))


def _load_inspection_channels(shot_dir: Path) -> list[int]:
    p = shot_dir / "channel_inspection_summary.json"
    if not p.is_file():
        return [189, 12, 50]
    with open(p, encoding="utf-8") as f:
        doc = json.load(f)
    ranked = doc.get("ranked_preview_columns") or []
    cols = [int(r["preview_column"]) for r in sorted(ranked, key=lambda r: r.get("rank", 99))[:3]]
    return cols if cols else [189, 12, 50]


def _load_interval_and_indices(shot_dir: Path) -> tuple[int, int, np.ndarray]:
    meta_p = shot_dir / "das_preprocessing_metadata.json"
    z = np.load(shot_dir / "das_preprocessed_preview.npz")
    ch_idx = np.asarray(z["channel_indices"], dtype=np.int64)
    if not meta_p.is_file():
        raise SystemExit(f"Missing {meta_p}")
    with open(meta_p, encoding="utf-8") as f:
        meta = json.load(f)
    sel = meta["selected_interval"]
    return int(sel["start_idx"]), int(sel["end_idx"]), ch_idx


def _event_contrast(
    t: np.ndarray,
    score: np.ndarray,
    events: list[dict[str, Any]],
    margin_s: float = 2.0,
) -> float:
    """Higher = more energy in event windows vs nearby background (heuristic)."""
    mask_ev = np.zeros(len(t), dtype=bool)
    for ev in events:
        t0, t1 = float(ev["start_time_s"]), float(ev["end_time_s"])
        mask_ev |= (t >= t0) & (t <= t1)
    if not np.any(mask_ev):
        return 0.0
    mask_bg = np.ones(len(t), dtype=bool)
    for ev in events:
        t0, t1 = float(ev["start_time_s"]), float(ev["end_time_s"])
        mask_bg &= ~((t >= t0 - margin_s) & (t <= t1 + margin_s))
    if not np.any(mask_bg):
        mask_bg = ~mask_ev
    return float(np.mean(score[mask_ev]) - np.mean(score[mask_bg]))


def _plot_diagnostic(
    *,
    t: np.ndarray,
    raw_decim: np.ndarray,
    envelope: np.ndarray,
    bandpass_support_score: np.ndarray,
    threshold: float,
    hydro_on_grid: np.ndarray,
    events: list[dict[str, Any]],
    preview_col: int,
    raw_ch: int,
    f_lo: float,
    f_hi: float,
    fs_hz: float,
    out_path: Path,
) -> None:
    fig, axs = plt.subplots(3, 1, figsize=(12, 8), sharex=True, constrained_layout=True)
    band_tag = f"{int(f_lo)}_{int(f_hi)}Hz"

    for ev in events:
        for ax in axs:
            ax.axvspan(
                float(ev["start_time_s"]),
                float(ev["end_time_s"]),
                color="tab:red",
                alpha=0.12,
            )

    axs[0].plot(t, raw_decim, color="0.45", lw=0.35, label="DAS (native rate, median-centered, decim. plot)")
    axs[0].set_ylabel("Amplitude (a.u.)")
    axs[0].set_title(
        f"{SHOT_SLUG} preview_col={preview_col} raw_ch={raw_ch} | "
        f"band-pass {f_lo:.0f}–{f_hi:.0f} Hz @ fs={fs_hz:.0f} Hz (not whale probability)"
    )
    axs[0].legend(loc="upper right", fontsize=7)

    axs[1].plot(t, envelope, color="tab:blue", lw=0.4, alpha=0.85, label="|Hilbert(band-pass)|")
    axs[1].plot(t, bandpass_support_score, color="tab:green", lw=0.7, label="smoothed RMS of envelope (score input)")
    axs[1].axhline(threshold, color="k", ls="--", lw=0.8, label="threshold (MAD)")
    axs[1].set_ylabel("Env. / score (a.u.)")
    axs[1].legend(loc="upper right", fontsize=7)

    norm, _ = _robust_norm_01(bandpass_support_score.astype(np.float64), 5.0, 99.0)
    axs[2].plot(t, norm, color="tab:purple", lw=0.8, label="bandpass_support_score [0,1]")
    axs[2].plot(t, hydro_on_grid, color="tab:orange", lw=0.6, alpha=0.85, label="hydrophone support (interp)")
    axs[2].set_ylabel("Normalized")
    axs[2].set_xlabel("Time (s)")
    axs[2].set_ylim(-0.05, 1.05)
    axs[2].legend(loc="upper right", fontsize=7)
    axs[2].set_title("Robust-normalized DAS band score vs hydrophone reference")

    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Orca DAS band-pass baseline diagnostic")
    ap.add_argument("--shot-dir", type=Path, default=None)
    ap.add_argument(
        "--preview-cols",
        type=str,
        default="",
        help="Comma-separated preview column indices (default: top 3 from channel_inspection_summary.json)",
    )
    ap.add_argument(
        "--bands",
        type=str,
        default="2000-2350,2200-2450",
        help="Comma-separated f_lo-f_hi Hz pairs at native DAS rate (must be < Nyquist)",
    )
    ap.add_argument("--mad-k", type=float, default=3.0)
    ap.add_argument("--envelope-rms-ms", type=float, default=40.0, help="Smoothing window for score (ms)")
    ap.add_argument("--plot-decim", type=int, default=10, help="Decimation for raw trace panel only")
    return ap.parse_args()


def _parse_bands(s: str) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        a, b = part.split("-")
        out.append((float(a), float(b)))
    return out


def main() -> None:
    args = parse_args()
    shot_dir = (args.shot_dir or (REPO_ROOT / "output" / "shots" / SHOT_SLUG)).resolve()
    fig_dir = REPO_ROOT / "figures" / "shots" / SHOT_SLUG
    fig_dir.mkdir(parents=True, exist_ok=True)

    if args.preview_cols.strip():
        preview_cols = [int(x.strip()) for x in args.preview_cols.split(",") if x.strip()]
    else:
        preview_cols = _load_inspection_channels(shot_dir)

    bands = _parse_bands(args.bands)
    if not bands:
        raise SystemExit("No bands parsed")

    ev_path = shot_dir / "events.json"
    hydro_npz = shot_dir / "hydrophone_event_score.npz"
    if not ev_path.is_file() or not hydro_npz.is_file():
        raise SystemExit("Need events.json and hydrophone_event_score.npz")

    with open(ev_path, encoding="utf-8") as f:
        ev_doc = json.load(f)
    events = list(ev_doc.get("events") or [])

    hz = np.load(hydro_npz)
    hydro_t = np.asarray(hz["t_s"], dtype=np.float64)
    hydro_norm = np.asarray(hz["normalized_event_score"], dtype=np.float32)

    start_idx, end_idx, channel_indices = _load_interval_and_indices(shot_dir)
    h5_path = resolve_shot_h5(ORCA_SUBDIR, ORCA_FILE)
    if not h5_path.is_file():
        raise SystemExit(f"Missing Orca HDF5: {h5_path}")

    results_matrix: list[dict[str, Any]] = []
    best: dict[str, Any] | None = None
    best_contrast = -1e9

    with h5py.File(h5_path, "r") as f:
        das = f["DAS"]
        attrs = dict(das.attrs)
        fs_hz = float(attrs.get("OutputDataRate", 5000.0))
        amp_scaling = float(attrs.get("AmpScaling", 1.0))
        nyq = 0.5 * fs_hz

        for f_lo, f_hi in bands:
            if f_hi >= nyq * 0.99:
                raise SystemExit(
                    f"Band {f_lo}-{f_hi} Hz exceeds usable Nyquist (~{nyq:.1f} Hz) for this DAS. "
                    "Adjust --bands (e.g. cap high edge below 2450 Hz at 5 kHz)."
                )
            sos = _band_sos(fs_hz, f_lo, f_hi)

            for preview_col in preview_cols:
                if preview_col < 0 or preview_col >= len(channel_indices):
                    continue
                raw_ch = int(channel_indices[preview_col])
                raw = das[start_idx:end_idx, raw_ch].astype(np.float64) * amp_scaling
                raw = raw - np.median(raw)
                filtered = sosfiltfilt(sos, raw)
                envelope = np.abs(hilbert(filtered))
                win = max(3, int(round(args.envelope_rms_ms * 1e-3 * fs_hz)))
                score_raw = _rolling_rms_1d(envelope, win).astype(np.float64)
                thr = _mad_threshold(score_raw, args.mad_k)
                mask = score_raw > thr

                n = len(raw)
                t = start_idx / fs_hz + np.arange(n, dtype=np.float64) / fs_hz
                hydro_on = np.interp(
                    t,
                    hydro_t,
                    hydro_norm.astype(np.float64),
                    left=float(np.median(hydro_norm)),
                    right=float(np.median(hydro_norm)),
                ).astype(np.float32)

                contrast = _event_contrast(t, score_raw.astype(np.float64), events)
                band_slug = f"{int(round(f_lo))}_{int(round(f_hi))}"
                out_png = fig_dir / f"orca_bandpass_col{preview_col}_{band_slug}.png"

                decim = max(1, int(args.plot_decim))
                _plot_diagnostic(
                    t=t[::decim],
                    raw_decim=raw[::decim],
                    envelope=envelope[::decim],
                    bandpass_support_score=score_raw[::decim],
                    threshold=thr,
                    hydro_on_grid=hydro_on[::decim],
                    events=events,
                    preview_col=preview_col,
                    raw_ch=raw_ch,
                    f_lo=f_lo,
                    f_hi=f_hi,
                    fs_hz=fs_hz,
                    out_path=out_png,
                )

                row = {
                    "preview_column": preview_col,
                    "raw_das_channel_index": raw_ch,
                    "band_hz": [f_lo, f_hi],
                    "native_fs_hz": fs_hz,
                    "envelope_rms_window_ms": args.envelope_rms_ms,
                    "threshold_method": f"median + {args.mad_k} * 1.4826 * MAD on smoothed envelope RMS",
                    "threshold_value": float(thr),
                    "signal_present_fraction": float(np.mean(mask)),
                    "event_vs_background_contrast_mean_score": round(contrast, 6),
                    "figure": str(out_png.resolve().relative_to(REPO_ROOT)),
                }
                results_matrix.append(row)
                if contrast > best_contrast:
                    best_contrast = contrast
                    best = row

        summary = {
            "schema_version": "orca_bandpass_baseline_v1",
            "shot_id": SHOT_SLUG,
            "notes": (
                "DAS-side exploratory band-pass envelope score. Not whale probability. "
                "Preview NPZ (~500 Hz) cannot represent 2–3 kHz; this script uses native DAS from HDF5."
            ),
            "nyquist_hz": nyq,
            "supervisor_bands_note": (
                "Requested examples 2000–2500 Hz and 2300–2900 Hz: at fs=5 kHz, Nyquist=2500 Hz, "
                "so 2300–2900 Hz is not fully observable; we use 2000–2350 and 2200–2450 Hz as safe proxies."
            ),
            "preview_rate_limitation_hz": float(0.5 * (fs_hz / 10.0)),
            "channels_tested_preview_columns": preview_cols,
            "bands_tested_hz": [[a, b] for a, b in bands],
            "score_representation": "rolling RMS of |Hilbert(band-pass x)|",
            "normalization_plot_only": "robust percentile [0,1] on score for bottom panel",
            "results": results_matrix,
            "recommended_default_from_contrast_heuristic": best,
        }

        out_json = shot_dir / "orca_bandpass_summary.json"
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

    print(f"Channels (preview cols): {preview_cols}")
    print(f"Bands Hz: {bands}")
    print(f"Wrote summary → {out_json}")
    if best:
        print(
            f"Heuristic pick (event vs background contrast): col {best['preview_column']} "
            f"band {best['band_hz']} contrast={best['event_vs_background_contrast_mean_score']}"
        )


if __name__ == "__main__":
    main()
