#!/usr/bin/env python3
"""
Baseline candidate acoustic-event extraction (MVP, no ML).

Definition (practical baseline):
  - Primary signal: hydrophone STFT exported in spectrogram.json.
  - Frame score: mean PSD (dB) in a configurable frequency band
    (default 30–1500 Hz).
  - Threshold: median(score) + k * (1.4826 * MAD).
  - Event intervals: merge neighboring active frames and remove short runs.

This detector is intentionally conservative and should be used as
candidate-guidance for synchronized viewer navigation (not whale classification).

Extra Sprint 2 outputs:
  - hydrophone_event_score.npz
  - hydrophone_event_score_metadata.json
  - hydrophone_event_score.png
  - score_with_events.png
  - viewer_event_guidance.json
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
from matplotlib import pyplot as plt


def _mad_threshold(scores: np.ndarray, k: float) -> float:
    med = float(np.median(scores))
    mad = float(np.median(np.abs(scores - med)))
    sigma = 1.4826 * mad if mad > 1e-12 else float(np.std(scores)) or 1.0
    return med + k * sigma


def _robust_normalize_01(scores: np.ndarray, p_low: float, p_high: float) -> tuple[np.ndarray, dict[str, float]]:
    if not (0 <= p_low < p_high <= 100):
        raise ValueError(f"Invalid normalization percentiles p_low={p_low}, p_high={p_high}")
    lo = float(np.percentile(scores, p_low))
    hi = float(np.percentile(scores, p_high))
    denom = hi - lo if hi > lo else 1.0
    norm = np.clip((scores - lo) / denom, 0.0, 1.0)
    return norm.astype(np.float32), {"p_low": p_low, "p_high": p_high, "lo": lo, "hi": hi}


def _true_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) indices of contiguous True."""
    n = len(mask)
    runs: list[tuple[int, int]] = []
    i = 0
    while i < n:
        if not mask[i]:
            i += 1
            continue
        j = i
        while j < n and mask[j]:
            j += 1
        runs.append((i, j - 1))
        i = j
    return runs


def _merge_runs(
    runs: list[tuple[int, int]], max_gap_frames: int
) -> list[tuple[int, int]]:
    if not runs:
        return []
    out: list[list[int]] = [[runs[0][0], runs[0][1]]]
    for s, e in runs[1:]:
        ps, pe = out[-1]
        if s - pe - 1 <= max_gap_frames:
            out[-1][1] = e
        else:
            out.append([s, e])
    return [(a[0], a[1]) for a in out]


def band_limited_scores(spec_block: dict, fmin: float, fmax: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    S = np.asarray(spec_block["Sxx_db"], dtype=np.float64)
    freqs = np.asarray(spec_block["freqs_hz"], dtype=np.float64)
    t = np.asarray(spec_block["t_s"], dtype=np.float64)
    m = (freqs >= fmin) & (freqs <= fmax)
    if not np.any(m):
        raise ValueError(f"No frequency bins in [{fmin}, {fmax}] Hz")
    scores = S[m].mean(axis=0)
    return t, scores, freqs[m]


def das_support_for_interval(
    das: dict, t0: float, t1: float
) -> dict[str, Any] | None:
    if "error" in das or "data" not in das:
        return None
    t = np.asarray(das["t_s"], dtype=np.float64)
    dist = np.asarray(das["distances_m"], dtype=np.float64)
    data = np.asarray(das["data"], dtype=np.float64)
    idx = np.where((t >= t0) & (t <= t1))[0]
    if idx.size == 0:
        return None
    sl = data[idx, :]
    if sl.shape[0] >= 2:
        ch_std = sl.std(axis=0)
    else:
        ch_std = np.abs(sl[0])
    j = int(np.argmax(ch_std))
    return {
        "peak_std_channel_index": j,
        "peak_std_distance_m": float(dist[j]),
        "peak_std_value": float(ch_std[j]),
    }


def extract_events(
    t: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    max_gap_frames: int,
    min_duration_s: float,
) -> list[dict[str, Any]]:
    active = scores > threshold
    raw_runs = _true_runs(active)
    merged = _merge_runs(raw_runs, max_gap_frames)
    dt = float(np.median(np.diff(t))) if len(t) > 1 else 0.1

    events: list[dict[str, Any]] = []
    for s, e in merged:
        start_t = float(t[s])
        end_t = float(t[e])
        duration = end_t - start_t + dt
        if duration < min_duration_s:
            continue
        seg = scores[s : e + 1]
        events.append(
            {
                "start_idx": s,
                "end_idx": e,
                "start_time_s": start_t,
                "end_time_s": end_t,
                "duration_s": float(duration),
                "score": float(np.mean(seg)),
                "score_peak_db": float(np.max(seg)),
                "score_excess_db": float(np.mean(seg - threshold)),
            }
        )
    return events


def _plot_hydro_score(
    t: np.ndarray,
    raw_score: np.ndarray,
    norm_score: np.ndarray,
    threshold: float,
    events: list[dict[str, Any]],
    shot_id: str,
    out_png_1: Path,
    out_png_2: Path,
) -> None:
    # Figure 1: compact normalized support score + event intervals
    fig1, ax1 = plt.subplots(figsize=(10, 3.8))
    ax1.plot(t, norm_score, lw=1.2, color="tab:blue", label="Normalized hydrophone support score")
    for ev in events:
        ax1.axvspan(ev["start_time_s"], ev["end_time_s"], color="tab:red", alpha=0.18)
    ax1.set_title(f"Hydrophone support score over time — {shot_id}")
    ax1.set_xlabel("Time (s)")
    ax1.set_ylabel("Normalized score [0, 1]")
    ax1.set_ylim(-0.02, 1.02)
    ax1.grid(alpha=0.25)
    ax1.legend(loc="upper right", fontsize=8)
    fig1.tight_layout()
    fig1.savefig(out_png_1, dpi=120)
    plt.close(fig1)

    # Figure 2: raw score with threshold + normalized score
    fig2, axs = plt.subplots(2, 1, figsize=(10.5, 6.5), sharex=True, constrained_layout=True)
    axs[0].plot(t, raw_score, lw=1.0, color="tab:purple", label="Raw hydrophone score (mean dB in band)")
    axs[0].axhline(threshold, color="tab:red", linestyle="--", lw=1.2, label=f"Threshold ({threshold:.2f} dB)")
    for ev in events:
        axs[0].axvspan(ev["start_time_s"], ev["end_time_s"], color="tab:red", alpha=0.15)
    axs[0].set_ylabel("Score (dB)")
    axs[0].set_title(f"Hydrophone score + detected candidate intervals — {shot_id}")
    axs[0].grid(alpha=0.25)
    axs[0].legend(loc="upper right", fontsize=8)

    axs[1].plot(t, norm_score, lw=1.0, color="tab:blue")
    for ev in events:
        axs[1].axvspan(ev["start_time_s"], ev["end_time_s"], color="tab:red", alpha=0.15)
    axs[1].set_xlabel("Time (s)")
    axs[1].set_ylabel("Normalized [0, 1]")
    axs[1].set_ylim(-0.02, 1.02)
    axs[1].grid(alpha=0.25)
    axs[1].set_title("Normalized hydrophone support score")
    fig2.savefig(out_png_2, dpi=120)
    plt.close(fig2)


def _load_das_activity_alignment(shot_dir: Path, t_hydro: np.ndarray) -> dict[str, Any]:
    p = shot_dir / "das_activity_map.npz"
    if not p.is_file():
        return {
            "das_activity_found": False,
            "hydro_time_range_s": [float(t_hydro[0]), float(t_hydro[-1])],
            "notes": "das_activity_map.npz not found; alignment metadata unavailable",
        }
    z = np.load(p)
    if "t_windows_s" not in z:
        return {
            "das_activity_found": True,
            "hydro_time_range_s": [float(t_hydro[0]), float(t_hydro[-1])],
            "notes": "das_activity_map.npz has no t_windows_s",
        }
    t_das = np.asarray(z["t_windows_s"], dtype=np.float64)
    h0, h1 = float(t_hydro[0]), float(t_hydro[-1])
    d0, d1 = float(t_das[0]), float(t_das[-1])
    ov0, ov1 = max(h0, d0), min(h1, d1)
    overlap = ov1 >= ov0
    hydro_dt = float(np.median(np.diff(t_hydro))) if len(t_hydro) > 1 else None
    das_dt = float(np.median(np.diff(t_das))) if len(t_das) > 1 else None
    nearest_sec = None
    if overlap and hydro_dt and das_dt:
        # simple mapping ratio hint; exact reindexing is deferred.
        nearest_sec = float(max(hydro_dt, das_dt))
    return {
        "das_activity_found": True,
        "hydro_time_range_s": [h0, h1],
        "das_activity_time_range_s": [d0, d1],
        "time_overlap": bool(overlap),
        "overlap_time_range_s": [ov0, ov1] if overlap else None,
        "hydro_dt_s": hydro_dt,
        "das_activity_dt_s": das_dt,
        "nearest_mapping_time_tolerance_s": nearest_sec,
        "notes": (
            "Hydrophone support score indicates when to inspect; "
            "DAS activity map indicates where/how along cable."
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Baseline hydrophone spectrogram event candidates")
    ap.add_argument(
        "--shot-dir",
        type=Path,
        default=REPO_ROOT / "output" / "shots" / "whales_humpback",
        help="Directory with spectrogram.json (and optional das_preview.json)",
    )
    ap.add_argument("--shot-id", type=str, default="", help="Override shot_id (default: folder name)")
    ap.add_argument("--mad-k", type=float, default=3.0, help="Threshold = median + k * robust sigma")
    ap.add_argument("--fmin", type=float, default=30.0)
    ap.add_argument("--fmax", type=float, default=1500.0)
    ap.add_argument("--max-gap-frames", type=int, default=2, help="Merge active runs if gap ≤ this")
    ap.add_argument("--min-duration-s", type=float, default=0.25)
    ap.add_argument("--out", type=Path, default=None, help="events.json path (default: shot-dir/events.json)")
    ap.add_argument("--score-p-low", type=float, default=5.0, help="Lower percentile for score normalization")
    ap.add_argument("--score-p-high", type=float, default=99.0, help="Upper percentile for score normalization")
    ap.add_argument("--no-figures", action="store_true", help="Do not write diagnostic PNG figures.")
    args = ap.parse_args()

    shot_dir: Path = args.shot_dir
    spec_path = shot_dir / "spectrogram.json"
    meta_path = shot_dir / "shot_metadata.json"
    das_path = shot_dir / "das_preview.json"

    if not spec_path.is_file():
        raise SystemExit(f"Missing {spec_path}")

    with open(spec_path, encoding="utf-8") as f:
        spec_all = json.load(f)
    recorder = sorted(spec_all.keys())[0]
    spec_block = spec_all[recorder]

    t, scores, _band_freqs = band_limited_scores(spec_block, args.fmin, args.fmax)
    threshold = _mad_threshold(scores, args.mad_k)
    score_norm, score_norm_meta = _robust_normalize_01(scores, args.score_p_low, args.score_p_high)
    active_mask = scores > threshold
    raw_events = extract_events(
        t,
        scores,
        threshold,
        max_gap_frames=args.max_gap_frames,
        min_duration_s=args.min_duration_s,
    )

    shot_id = args.shot_id or shot_dir.name
    h5_name = None
    if meta_path.is_file():
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        h5_name = meta.get("file")

    das_preview: dict | None = None
    if das_path.is_file():
        with open(das_path, encoding="utf-8") as f:
            das_preview = json.load(f)

    out_events: list[dict[str, Any]] = []
    score_file_rel = "hydrophone_event_score.npz"
    for i, ev in enumerate(raw_events, start=1):
        t0, t1 = ev["start_time_s"], ev["end_time_s"]
        idx = np.where((t >= t0) & (t <= t1))[0]
        if idx.size == 0:
            idx = np.array([int(ev["start_idx"])], dtype=np.int32)
        local_scores = scores[idx]
        local_norm = score_norm[idx]
        peak_local = int(np.argmax(local_scores))
        peak_idx = int(idx[peak_local])
        row: dict[str, Any] = {
            "event_id": f"{shot_id}_{i:03d}",
            "shot_id": shot_id,
            "start_time_s": t0,
            "end_time_s": t1,
            "duration_s": round(ev["duration_s"], 4),
            "score": round(ev["score"], 3),
            "mean_score": round(float(np.mean(local_scores)), 3),
            "peak_time_s": float(t[peak_idx]),
            "peak_score": float(np.max(local_scores)),
            "max_normalized_score": float(np.max(local_norm)),
            "threshold": float(threshold),
            "frequency_band_hz": [float(args.fmin), float(args.fmax)],
            "source_score_file": score_file_rel,
            "detection_basis": (
                f"hydrophone STFT mean dB ({args.fmin:.0f}-{args.fmax:.0f} Hz), "
                f"{recorder}/{spec_block.get('preview_channel', '?')}; "
                f"threshold median+MAD*k (k={args.mad_k})"
            ),
            "notes": (
                f"score_peak_db={ev['score_peak_db']:.2f}, "
                f"mean_excess_over_threshold_db={ev['score_excess_db']:.2f}"
            ),
        }
        if h5_name:
            row["source_h5"] = h5_name
        if das_preview is not None:
            hint = das_support_for_interval(das_preview, t0, t1)
            if hint:
                row["das_support"] = hint
        out_events.append(row)

    payload: dict[str, Any] = {
        "schema_version": "baseline_hydrophone_stft_v1",
        "shot_id": shot_id,
        "source_h5": h5_name,
        "source_files": {
            "spectrogram": str(spec_path.resolve()),
            "shot_metadata": str(meta_path.resolve()) if meta_path.is_file() else None,
            "das_preview": str(das_path.resolve()) if das_path.is_file() else None,
        },
        "parameters": {
            "recorder": recorder,
            "preview_channel": spec_block.get("preview_channel"),
            "band_hz": [args.fmin, args.fmax],
            "mad_k": args.mad_k,
            "threshold_db": round(threshold, 4),
            "score_definition": "mean Sxx_db over frequency bins in band, per STFT frame",
            "score_normalization": {
                "method": "robust percentile normalization to [0,1]",
                **score_norm_meta,
            },
            "max_gap_frames": args.max_gap_frames,
            "min_duration_s": args.min_duration_s,
        },
        "n_events": len(out_events),
        "events": out_events,
    }

    out_path = args.out or (shot_dir / "events.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    # Score export (compact NPZ + metadata)
    score_npz_path = shot_dir / score_file_rel
    np.savez_compressed(
        score_npz_path,
        t_s=t.astype(np.float32),
        raw_score=scores.astype(np.float32),
        normalized_event_score=score_norm.astype(np.float32),
        active_mask=active_mask.astype(np.uint8),
    )
    alignment = _load_das_activity_alignment(shot_dir, t_hydro=t)
    score_meta = {
        "schema_version": "hydrophone_event_score_v1",
        "shot_id": shot_id,
        "source_h5": h5_name,
        "support_layer_note": (
            "Hydrophone event score is a support/timing layer for synchronized interpretation. "
            "It is not whale probability and not species classification."
        ),
        "source_files": {
            "spectrogram": str(spec_path.resolve()),
            "events_json": str(out_path.resolve()),
            "das_activity_map_npz": str((shot_dir / "das_activity_map.npz").resolve())
            if (shot_dir / "das_activity_map.npz").is_file()
            else None,
        },
        "detector": {
            "recorder": recorder,
            "preview_channel": spec_block.get("preview_channel"),
            "frequency_band_hz": [float(args.fmin), float(args.fmax)],
            "threshold_method": "median + k * (1.4826 * MAD)",
            "mad_k": float(args.mad_k),
            "threshold_db": float(threshold),
            "max_gap_frames": int(args.max_gap_frames),
            "min_duration_s": float(args.min_duration_s),
        },
        "score_arrays": {
            "t_s_len": int(len(t)),
            "raw_score": "mean Sxx_db over selected frequency bins",
            "normalized_event_score": "robust percentile normalized score in [0,1]",
            "normalization": score_norm_meta,
            "active_mask_definition": "raw_score > threshold_db",
        },
        "time_alignment_with_das_activity": alignment,
        "n_candidate_events": int(len(out_events)),
    }
    score_meta_path = shot_dir / "hydrophone_event_score_metadata.json"
    with open(score_meta_path, "w", encoding="utf-8") as f:
        json.dump(score_meta, f, indent=2, ensure_ascii=False)

    # Compact viewer guidance bundle
    guidance = {
        "schema_version": "viewer_event_guidance_v1",
        "shot_id": shot_id,
        "n_events": len(out_events),
        "events_json": str(out_path.resolve()),
        "score_file_npz": str(score_npz_path.resolve()),
        "score_metadata_json": str(score_meta_path.resolve()),
        "das_activity_map_npz": str((shot_dir / "das_activity_map.npz").resolve())
        if (shot_dir / "das_activity_map.npz").is_file()
        else None,
        "time_alignment_with_das_activity": alignment,
        "recommended_default_interval_s": None,
    }
    if out_events:
        first = out_events[0]
        center = 0.5 * (first["start_time_s"] + first["end_time_s"])
        guidance["recommended_default_interval_s"] = [max(0.0, center - 2.0), center + 2.0]
    guidance_path = shot_dir / "viewer_event_guidance.json"
    with open(guidance_path, "w", encoding="utf-8") as f:
        json.dump(guidance, f, indent=2, ensure_ascii=False)

    fig1 = None
    fig2 = None
    if not args.no_figures:
        fig_dir = REPO_ROOT / "figures" / "shots" / shot_id
        fig_dir.mkdir(parents=True, exist_ok=True)
        fig1 = fig_dir / "hydrophone_event_score.png"
        fig2 = fig_dir / "score_with_events.png"
        _plot_hydro_score(
            t=t,
            raw_score=scores,
            norm_score=score_norm,
            threshold=threshold,
            events=out_events,
            shot_id=shot_id,
            out_png_1=fig1,
            out_png_2=fig2,
        )

    print(f"Threshold (dB): {threshold:.3f}")
    print(f"Wrote {len(out_events)} events → {out_path}")
    print(f"Wrote score npz → {score_npz_path}")
    print(f"Wrote score metadata → {score_meta_path}")
    print(f"Wrote viewer guidance → {guidance_path}")
    if fig1 and fig2:
        print(f"Wrote figure → {fig1}")
        print(f"Wrote figure → {fig2}")
    else:
        print("Skipped diagnostic figures (--no-figures)")


if __name__ == "__main__":
    main()
