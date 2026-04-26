#!/usr/bin/env python3
"""
Diagnostic inspection: whales_orca single-channel DAS vs aggregated activity map.

Backend Task 1 (Sprint 2) — analysis/export only:
  - does not change preprocessing or activity-map code paths
  - reads existing output/shots/whales_orca artifacts

Outputs:
  - figures/shots/whales_orca/channel_<preview_col>_diagnostic.png
  - output/shots/whales_orca/channel_inspection_summary.json

Usage (from repository root):
  python3 src/inspect_orca_channels.py
  python3 src/inspect_orca_channels.py --shot-dir output/shots/whales_orca
  # Include a specific preview column (e.g. legacy channel_50 figure) after the activity peak shifts:
  python3 src/inspect_orca_channels.py --extra-preview-cols 50
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
from scipy.signal import butter, spectrogram, sosfiltfilt

from _repo_paths import REPO_ROOT

_mpl_cfg = REPO_ROOT / ".mplconfig"
_mpl_cfg.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator


def _preview_fs_hz(t_s: np.ndarray) -> float:
    if len(t_s) < 2:
        return 500.0
    dt = float(np.median(np.diff(t_s)))
    return 1.0 / dt if dt > 0 else 500.0


def _map_das_preview_channel_index(raw_ch: int, channel_indices: np.ndarray) -> int:
    """Map ingest/das_preview channel index to column in preprocessed preview."""
    ci = np.asarray(channel_indices, dtype=np.int64)
    hits = np.where(ci == raw_ch)[0]
    if hits.size:
        return int(hits[0])
    return int(np.argmin(np.abs(ci - raw_ch)))


def _band_energy_trace(
    x: np.ndarray,
    fs_hz: float,
    fmin: float,
    fmax: float,
    order: int = 4,
) -> np.ndarray:
    nyq = 0.5 * fs_hz
    lo = max(fmin, 1.0)
    hi = min(fmax, nyq * 0.99)
    if hi <= lo:
        return np.abs(x).astype(np.float32)
    sos = butter(order, [lo / nyq, hi / nyq], btype="band", output="sos")
    y = sosfiltfilt(sos, x.astype(np.float64))
    return (y.astype(np.float32)) ** 2


def _interp_hydro_on_das_grid(
    t_hydro: np.ndarray, y_hydro: np.ndarray, t_das: np.ndarray
) -> np.ndarray:
    th = np.asarray(t_hydro, dtype=np.float64)
    yh = np.asarray(y_hydro, dtype=np.float64)
    m = np.isfinite(th) & np.isfinite(yh)
    if not np.any(m):
        return np.zeros_like(t_das, dtype=np.float32)
    return np.interp(
        np.asarray(t_das, dtype=np.float64),
        th[m],
        yh[m],
        left=float(np.nanmedian(yh[m])),
        right=float(np.nanmedian(yh[m])),
    ).astype(np.float32)


def _event_mask(t_das: np.ndarray, events: list[dict[str, Any]]) -> np.ndarray:
    m = np.zeros(len(t_das), dtype=bool)
    for ev in events:
        t0 = float(ev["start_time_s"])
        t1 = float(ev["end_time_s"])
        m |= (t_das >= t0) & (t_das <= t1)
    return m


def _rank_channels(
    pre: np.ndarray,
    t_das: np.ndarray,
    activity_map: np.ndarray,
    hydro_on_das: np.ndarray,
    event_mask_das: np.ndarray,
    preview_cols: list[int],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    n_t = pre.shape[0]
    win = min(501, n_t | 1)
    if win % 2 == 0:
        win -= 1
    win = max(31, win | 1)

    # activity per preview column: mean over windows (nearest time alignment not needed)
    mean_act = np.mean(activity_map, axis=0)
    w = np.ones(win, dtype=np.float64) / float(win)

    for j in preview_cols:
        x = np.asarray(pre[:, j], dtype=np.float64)
        ax = np.abs(x)
        sm = np.convolve(ax, w, mode="same")

        hydro = np.asarray(hydro_on_das, dtype=np.float64)
        mask = np.isfinite(sm) & np.isfinite(hydro)
        if np.sum(mask) > 8:
            c = np.corrcoef(sm[mask], hydro[mask])[0, 1]
            corr = float(c) if np.isfinite(c) else 0.0
        else:
            corr = 0.0

        ev = event_mask_das
        e_energy = float(np.sum(x[ev] ** 2)) if np.any(ev) else 0.0
        tot_energy = float(np.sum(x**2)) + 1e-12
        event_frac = e_energy / tot_energy

        # peakiness / contrast
        contrast = float(np.std(x) / (np.median(np.abs(x)) + 1e-9))

        rows.append(
            {
                "preview_column": int(j),
                "mean_normalized_activity": float(mean_act[j]),
                "hydro_score_correlation_smoothed_abs": corr,
                "event_interval_energy_fraction": event_frac,
                "waveform_contrast_std_over_median_abs": contrast,
            }
        )

    # composite score (heuristic ranking for frontend candidates)
    def composite(r: dict[str, Any]) -> float:
        return (
            0.45 * r["mean_normalized_activity"]
            + 0.25 * max(0.0, r["hydro_score_correlation_smoothed_abs"])
            + 0.2 * min(1.0, 5.0 * r["event_interval_energy_fraction"])
            + 0.1 * min(1.0, r["waveform_contrast_std_over_median_abs"] / 5.0)
        )

    for r in rows:
        r["rank_score"] = round(composite(r), 4)

    rows.sort(key=lambda r: r["rank_score"], reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


def _plot_channel_diagnostic(
    *,
    shot: str,
    preview_col: int,
    raw_ch_index: int,
    distance_m: float,
    t_das: np.ndarray,
    raw_preview: np.ndarray | None,
    pre: np.ndarray,
    activity_map: np.ndarray,
    t_windows: np.ndarray,
    distances_m: np.ndarray,
    hydro_t: np.ndarray,
    hydro_norm: np.ndarray,
    events: list[dict[str, Any]],
    fs_hz: float,
    out_path: Path,
) -> None:
    xpre = np.asarray(pre[:, preview_col], dtype=np.float64)
    fig = plt.figure(figsize=(12, 10))
    gs = fig.add_gridspec(4, 1, height_ratios=[1.0, 1.0, 1.2, 1.0], hspace=0.35)

    ax0 = fig.add_subplot(gs[0])
    if raw_preview is not None:
        xr = np.asarray(raw_preview[:, preview_col], dtype=np.float64)
        ax0.plot(t_das, xr, color="0.5", lw=0.6, alpha=0.85, label="raw preview")
    ax0.plot(t_das, xpre, color="C0", lw=0.7, label="preprocessed preview")
    ax0.set_ylabel("Amplitude (a.u.)")
    t_lo, t_hi = float(t_das[0]), float(t_das[-1])
    ax0.set_title(
        f"{shot} — channel preview col {preview_col} "
        f"(raw DAS ch {raw_ch_index}, ~{distance_m:.1f} m)\n"
        f"DAS preview grid: {t_lo:.2f}–{t_hi:.2f} s"
    )
    ax0.legend(loc="upper right", fontsize=8)
    for ev in events:
        ax0.axvspan(
            float(ev["start_time_s"]),
            float(ev["end_time_s"]),
            color="C3",
            alpha=0.15,
        )

    ax1 = fig.add_subplot(gs[1], sharex=ax0)
    band_e = _band_energy_trace(xpre, fs_hz, 15.0, min(180.0, 0.45 * fs_hz))
    ax1.plot(t_das, band_e, color="C2", lw=0.7)
    ax1.set_ylabel("Band energy (a.u.)")
    ax1.set_title("Band-limited energy (Butterworth band on preprocessed trace)")

    nperseg = int(min(512, max(64, len(xpre) // 8)))
    noverlap = nperseg * 3 // 4
    f, tt, Sxx = spectrogram(
        xpre,
        fs=fs_hz,
        window="hann",
        nperseg=nperseg,
        noverlap=noverlap,
        scaling="density",
        mode="psd",
    )
    ax2 = fig.add_subplot(gs[2], sharex=ax0)
    db = 10.0 * np.log10(np.maximum(Sxx, 1e-20))
    vmax = float(np.percentile(db, 99))
    vmin = vmax - 50.0
    im = ax2.pcolormesh(
        tt,
        f,
        db,
        shading="auto",
        cmap="magma",
        vmin=vmin,
        vmax=vmax,
    )
    ax2.set_ylabel("Frequency (Hz)")
    ax2.set_title("DAS channel spectrogram (preview rate)")
    fig.colorbar(im, ax=ax2, label="PSD (dB)")

    ax3 = fig.add_subplot(gs[3], sharex=ax0)
    h_on = _interp_hydro_on_das_grid(hydro_t, hydro_norm, t_das)
    ax3.plot(t_das, h_on, color="C1", lw=0.9, label="hydrophone support score (interp)")
    ax3.set_xlabel("Time (s)")
    ax3.set_ylabel("Norm. score")
    ax3.set_ylim(-0.05, 1.05)
    ax3.legend(loc="upper right", fontsize=8)
    ax3.set_title("Hydrophone normalized score on DAS time grid (alignment check)")

    # Activity map strip for this channel
    ax_act = ax2.twinx()
    j = preview_col
    act_j = activity_map[:, j]
    ax_act.plot(t_windows, act_j, color="cyan", lw=1.0, alpha=0.75, label="activity (this ch)")
    ax_act.set_ylabel("Norm. activity", color="cyan")
    ax_act.tick_params(axis="y", labelcolor="cyan")
    ax_act.set_ylim(-0.05, 1.05)

    # Full activity map thumbnail
    ax_thumb = fig.add_axes([0.72, 0.02, 0.26, 0.2])
    extent = (
        float(t_windows[0]),
        float(t_windows[-1]),
        float(distances_m[0]),
        float(distances_m[-1]),
    )
    ax_thumb.imshow(
        activity_map.T,
        aspect="auto",
        origin="lower",
        extent=extent,
        cmap="inferno",
        vmin=0,
        vmax=1,
        interpolation="nearest",
    )
    ax_thumb.axhline(distance_m, color="w", lw=0.8, alpha=0.9)
    ax_thumb.set_title("Activity map + fiber dist.", fontsize=8)
    ax_thumb.set_xlabel("t (s)", fontsize=7)
    ax_thumb.set_ylabel("m", fontsize=7)

    # Pin x-axis to DAS preview span (avoids misleading margins / twin-axis autoscale).
    ax0.set_xlim(t_lo, t_hi)
    ax0.margins(x=0)
    ax3.xaxis.set_major_locator(MaxNLocator(nbins=12))

    fig.savefig(out_path, dpi=120, bbox_inches="tight")
    plt.close(fig)


def _parse_extra_preview_cols(s: str) -> list[int]:
    out: list[int] = []
    for part in s.replace(" ", "").split(","):
        if not part:
            continue
        out.append(int(part))
    return out


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Inspect whales_orca DAS channels vs activity map")
    ap.add_argument(
        "--shot-dir",
        type=Path,
        default=None,
        help="Directory with whales_orca pipeline outputs",
    )
    ap.add_argument(
        "--fig-dir",
        type=Path,
        default=None,
        help="Figure output directory (default figures/shots/whales_orca)",
    )
    ap.add_argument(
        "--extra-preview-cols",
        type=str,
        default="",
        help="Extra preview column indices to include (comma-separated), e.g. 50 when rerunning a legacy figure.",
    )
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    shot_dir = args.shot_dir or (REPO_ROOT / "output" / "shots" / "whales_orca")
    fig_dir = args.fig_dir or (REPO_ROOT / "figures" / "shots" / "whales_orca")
    shot_dir = shot_dir.resolve()
    fig_dir.mkdir(parents=True, exist_ok=True)

    pre_npz = shot_dir / "das_preprocessed_preview.npz"
    pre_meta = shot_dir / "das_preprocessing_metadata.json"
    act_npz = shot_dir / "das_activity_map.npz"
    ev_path = shot_dir / "events.json"
    hydro_npz = shot_dir / "hydrophone_event_score.npz"

    for p in (pre_npz, act_npz, ev_path, hydro_npz):
        if not p.is_file():
            raise SystemExit(f"Missing required file: {p}")

    z = np.load(pre_npz)
    keys = list(z.keys())
    pre = np.asarray(z["preprocessed_preview"], dtype=np.float32)
    t_das = np.asarray(z["t_s"], dtype=np.float64)
    ch_idx = np.asarray(z["channel_indices"], dtype=np.int64)
    dist_m = np.asarray(z["distances_m"], dtype=np.float64)
    raw_preview = None
    if "raw_preview" in z:
        raw_preview = np.asarray(z["raw_preview"], dtype=np.float32)

    az = np.load(act_npz)
    activity = np.asarray(az["activity_map"], dtype=np.float32)
    t_win = np.asarray(az["t_windows_s"], dtype=np.float64)

    with open(ev_path, encoding="utf-8") as f:
        ev_doc = json.load(f)
    events = list(ev_doc.get("events") or [])

    hz = np.load(hydro_npz)
    hydro_t = np.asarray(hz["t_s"], dtype=np.float64)
    hydro_norm = np.asarray(hz["normalized_event_score"], dtype=np.float32)

    preprocess_meta: dict[str, Any] | None = None
    if pre_meta.is_file():
        with open(pre_meta, encoding="utf-8") as f:
            preprocess_meta = json.load(f)

    n_ch = pre.shape[1]
    fs_hz = _preview_fs_hz(t_das)

    # Candidate preview columns
    spatial = [0, n_ch // 2, n_ch - 1]
    peak_act = int(np.argmax(np.mean(activity, axis=0)))

    event_hint_cols: list[int] = []
    for ev in events:
        ds = ev.get("das_support") or {}
        if "peak_std_channel_index" in ds:
            raw_j = int(ds["peak_std_channel_index"])
            event_hint_cols.append(_map_das_preview_channel_index(raw_j, ch_idx))

    cand: list[int] = []
    for j in spatial + [peak_act] + event_hint_cols:
        if 0 <= j < n_ch and j not in cand:
            cand.append(j)

    for j in _parse_extra_preview_cols(args.extra_preview_cols):
        if 0 <= j < n_ch and j not in cand:
            cand.append(j)

    hydro_on_das = _interp_hydro_on_das_grid(hydro_t, hydro_norm, t_das)
    ev_mask = _event_mask(t_das, events)

    ranked = _rank_channels(
        pre,
        t_das,
        activity,
        hydro_on_das,
        ev_mask,
        cand,
    )
    for r in ranked:
        j = int(r["preview_column"])
        r["raw_das_channel_index"] = int(ch_idx[j])
        r["distance_m"] = float(dist_m[j])

    t_h0, t_h1 = float(hydro_t[0]), float(hydro_t[-1])
    t_d0, t_d1 = float(t_das[0]), float(t_das[-1])
    t_w0, t_w1 = float(t_win[0]), float(t_win[-1])

    events_outside_das = [
        {
            "event_id": ev.get("event_id"),
            "start_time_s": float(ev["start_time_s"]),
            "end_time_s": float(ev["end_time_s"]),
            "outside_das_preview_window": bool(
                float(ev["start_time_s"]) > t_d1 or float(ev["end_time_s"]) < t_d0
            ),
        }
        for ev in events
    ]

    summary: dict[str, Any] = {
        "schema_version": "orca_channel_inspection_v1",
        "shot_id": "whales_orca",
        "input_npz_keys": keys,
        "preprocessed_shape_n_time_x_n_channels": [int(pre.shape[0]), int(pre.shape[1])],
        "preview_time_range_s": [t_d0, t_d1],
        "preview_fs_hz_estimate": round(fs_hz, 4),
        "activity_time_range_s": [t_w0, t_w1],
        "hydrophone_score_time_range_s": [t_h0, t_h1],
        "time_alignment_notes": (
            "Candidate hydrophone events are defined on the full hydrophone timeline. "
            "The DAS preprocessed preview window may be shorter; check "
            "`events_outside_das_preview_window` before interpreting event shading on DAS plots."
        ),
        "events_outside_das_preview": events_outside_das,
        "channel_selection": {
            "preview_columns_inspected": cand,
            "extra_preview_cols_from_cli": _parse_extra_preview_cols(args.extra_preview_cols),
            "rationale": [
                "Spatial spread: near start, middle, and end of subsampled fiber.",
                "Activity-based: preview column with highest mean normalized rolling-RMS activity.",
                "Event hints: map das_support.peak_std_channel_index from events.json onto preview columns via channel_indices.",
                "Optional: --extra-preview-cols adds columns (e.g. 50) for comparison when the activity peak index changes after reprocessing.",
            ],
        },
        "ranked_preview_columns": ranked,
        "recommended_default_preview_column": ranked[0]["preview_column"] if ranked else None,
        "preprocessing_metadata_file": str(pre_meta) if pre_meta.is_file() else None,
        "source_preprocessing_interval": preprocess_meta.get("selected_interval") if preprocess_meta else None,
    }

    for j in cand:
        raw_ch = int(ch_idx[j])
        dm = float(dist_m[j])
        _plot_channel_diagnostic(
            shot="whales_orca",
            preview_col=j,
            raw_ch_index=raw_ch,
            distance_m=dm,
            t_das=t_das,
            raw_preview=raw_preview,
            pre=pre,
            activity_map=activity,
            t_windows=t_win,
            distances_m=dist_m,
            hydro_t=hydro_t,
            hydro_norm=hydro_norm,
            events=events,
            fs_hz=fs_hz,
            out_path=fig_dir / f"channel_{j}_diagnostic.png",
        )

    out_json = shot_dir / "channel_inspection_summary.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print("whales_orca channel inspection")
    print(f"  DAS preview: {t_d0:.3f}–{t_d1:.3f} s, fs≈{fs_hz:.2f} Hz, n_ch={n_ch}")
    print(f"  Inspected preview columns: {cand}")
    print(f"  Recommended default preview column: {summary['recommended_default_preview_column']}")
    print(f"  Wrote: {out_json}")
    print(f"  Figures: {fig_dir}/channel_<j>_diagnostic.png")


if __name__ == "__main__":
    main()
