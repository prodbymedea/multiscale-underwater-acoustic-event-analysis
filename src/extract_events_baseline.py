#!/usr/bin/env python3
"""
Baseline candidate event extraction (MVP, no ML).

Definition (practical baseline):
  - Primary signal: hydrophone STFT already exported in spectrogram.json
    (ingest uses Recorder-C, preview channel Tetra-Top).
  - Activity score: mean PSD (dB) per time frame, restricted to a fixed
    bioacoustic band (default 30–1500 Hz) to reduce broadband noise influence.
  - Threshold: median(score) + k * (1.4826 * MAD) — robust to heavy-tailed noise.
  - Events: merge STFT frames above threshold; allow small gaps (frames);
    drop segments shorter than min_duration_s.

DAS is optional supporting context only: for each event, report the fiber
distance bin with largest sample std in das_preview over the event time
(no detection on DAS).

Output: events.json next to ingest JSON (or --out path).

Usage (from repository root; requires spectrogram.json from ingest):
  python3 src/extract_events_baseline.py
  python3 src/extract_events_baseline.py --shot-dir output/shots/whales_humpback
  python3 src/extract_events_baseline.py --mad-k 3.0 --fmin 30 --fmax 1500
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from _repo_paths import REPO_ROOT


def _mad_threshold(scores: np.ndarray, k: float) -> float:
    med = float(np.median(scores))
    mad = float(np.median(np.abs(scores - med)))
    sigma = 1.4826 * mad if mad > 1e-12 else float(np.std(scores)) or 1.0
    return med + k * sigma


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
    for i, ev in enumerate(raw_events, start=1):
        t0, t1 = ev["start_time_s"], ev["end_time_s"]
        row: dict[str, Any] = {
            "event_id": f"{shot_id}_{i:03d}",
            "shot_id": shot_id,
            "start_time_s": t0,
            "end_time_s": t1,
            "duration_s": round(ev["duration_s"], 4),
            "score": round(ev["score"], 3),
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

    print(f"Threshold (dB): {threshold:.3f}")
    print(f"Wrote {len(out_events)} events → {out_path}")


if __name__ == "__main__":
    main()
