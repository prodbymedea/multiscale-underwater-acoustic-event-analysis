#!/usr/bin/env python3
"""Build minimal frontend-compatible JSON exports from backend NPZ artifacts.

Purpose:
  - keep Step 6 frontend contract unchanged,
  - provide compatibility JSON for shots that only have NPZ backend outputs.

Outputs (if source files exist):
  - output/shots/<shot>/viewer/das_activity.json
  - output/shots/<shot>/hydrophone_activity.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from _repo_paths import REPO_ROOT


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def _to_list(a: np.ndarray) -> list[Any]:
    return a.tolist()


def _robust_minmax_01(arr: np.ndarray, p_low: float = 2.0, p_high: float = 98.0) -> tuple[np.ndarray, dict[str, float]]:
    """Robustly map array values to [0, 1] by percentile clipping."""
    finite = np.asarray(arr, dtype=np.float32)
    low = float(np.percentile(finite, p_low))
    high = float(np.percentile(finite, p_high))
    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        scaled = np.zeros_like(finite, dtype=np.float32)
        return scaled, {
            "p_low": float(p_low),
            "p_high": float(p_high),
            "clip_low": float(low) if np.isfinite(low) else 0.0,
            "clip_high": float(high) if np.isfinite(high) else 1.0,
        }

    clipped = np.clip(finite, low, high)
    scaled = (clipped - low) / (high - low)
    return scaled.astype(np.float32), {
        "p_low": float(p_low),
        "p_high": float(p_high),
        "clip_low": low,
        "clip_high": high,
    }


def build_das_compat(shot_dir: Path) -> Path | None:
    npz_path = shot_dir / "das_activity_map.npz"
    meta_path = shot_dir / "das_activity_map_metadata.json"
    out_path = shot_dir / "viewer" / "das_activity.json"

    source_note = ""
    method = None

    if npz_path.is_file():
        z = np.load(npz_path)
        if "activity_map" not in z or "t_windows_s" not in z or "distances_m" not in z:
            raise SystemExit(f"Missing expected DAS keys in {npz_path}")

        activity_raw = np.asarray(z["activity_map"], dtype=np.float32)
        t_s = np.asarray(z["t_windows_s"], dtype=np.float32)
        distances = np.asarray(z["distances_m"], dtype=np.float32)
        channel_indices = (
            np.asarray(z["channel_indices"], dtype=np.int32)
            if "channel_indices" in z
            else np.arange(activity_raw.shape[1], dtype=np.int32)
        )

        meta = _read_json(meta_path) or {}
        norm = (meta.get("normalization") or {}) if isinstance(meta, dict) else {}
        method = norm.get("mode") if isinstance(norm, dict) else None
        source_note = "from das_activity_map.npz"
    else:
        existing = _read_json(out_path)
        if not isinstance(existing, dict):
            return None
        axes = existing.get("axes") or {}
        activity_existing = np.asarray(existing.get("activity_01") or [], dtype=np.float32)
        t_s = np.asarray(axes.get("t_s") or [], dtype=np.float32)
        distances = np.asarray(axes.get("distances_m") or [], dtype=np.float32)
        channel_indices = np.asarray(
            axes.get("channel_indices") or np.arange(activity_existing.shape[1], dtype=np.int32),
            dtype=np.int32,
        )

        if activity_existing.ndim != 2 or t_s.size == 0 or distances.size == 0:
            return None

        activity_raw = activity_existing
        source_note = "from existing viewer/das_activity.json"

    activity_01, robust_stats = _robust_minmax_01(activity_raw, p_low=2.0, p_high=98.0)

    payload = {
        "schema_version": "das_activity_v1",
        "representation": "normalized rolling RMS DAS activity map (compat export)",
        "source": {
            "npz": str(npz_path.relative_to(REPO_ROOT)) if npz_path.is_file() else None,
            "metadata": str(meta_path.relative_to(REPO_ROOT)) if meta_path.is_file() else None,
            "compat_source": source_note,
        },
        "axes": {
            "time_unit": "s",
            "distance_unit": "m",
            "n_time": int(activity_01.shape[0]),
            "n_channels": int(activity_01.shape[1]) if activity_01.ndim == 2 else 0,
            "t_s": _to_list(t_s),
            "channel_indices": _to_list(channel_indices),
            "distances_m": _to_list(distances),
        },
        "preprocessing": {
            "normalization": {
                "method": "robust percentile clip + minmax to [0,1]",
                "source_method": method or source_note,
                **robust_stats,
            }
        },
        "activity_01": _to_list(activity_01),
    }

    _write_json(out_path, payload)
    return out_path


def _candidate_intervals(events_json: dict[str, Any] | None) -> list[dict[str, Any]]:
    intervals: list[dict[str, Any]] = []
    if not isinstance(events_json, dict):
        return intervals
    for ev in events_json.get("events") or []:
        if not isinstance(ev, dict):
            continue
        s = ev.get("start_time_s")
        e = ev.get("end_time_s")
        if isinstance(s, (int, float)) and isinstance(e, (int, float)):
            intervals.append(
                {
                    "start_time_s": float(s),
                    "end_time_s": float(e),
                    "label": ev.get("event_id") or "candidate_event",
                }
            )
    return intervals


def build_hydro_compat(shot_dir: Path) -> Path | None:
    npz_path = shot_dir / "hydrophone_event_score.npz"
    meta_path = shot_dir / "hydrophone_event_score_metadata.json"
    events_path = shot_dir / "events.json"
    out_path = shot_dir / "hydrophone_activity.json"

    if not npz_path.is_file():
        return None

    z = np.load(npz_path)
    if "t_s" not in z:
        raise SystemExit(f"Missing expected hydro key t_s in {npz_path}")

    t_s = np.asarray(z["t_s"], dtype=np.float32)
    raw = np.asarray(z["raw_score"], dtype=np.float32) if "raw_score" in z else np.zeros_like(t_s)
    score_01 = np.asarray(z["normalized_event_score"], dtype=np.float32) if "normalized_event_score" in z else None
    active = np.asarray(z["active_mask"], dtype=np.uint8) if "active_mask" in z else None

    meta = _read_json(meta_path) or {}
    detector = (meta.get("detector") or {}) if isinstance(meta, dict) else {}
    threshold_db = detector.get("threshold_db") if isinstance(detector, dict) else None
    threshold_z = detector.get("threshold_robust_z") if isinstance(detector, dict) else None

    events_json = _read_json(events_path)

    payload = {
        "schema_version": "hydrophone_activity_v1",
        "shot_id": shot_dir.name,
        "representation": "Hydrophone support score over time (compat export)",
        "source": {
            "npz": str(npz_path.relative_to(REPO_ROOT)),
            "metadata": str(meta_path.relative_to(REPO_ROOT)) if meta_path.is_file() else None,
        },
        "time_axis_unit": "s",
        "score_unit": "dB",
        "normalization": {
            "method": "from hydrophone_event_score npz/meta",
            "threshold_db": float(threshold_db) if isinstance(threshold_db, (int, float)) else None,
            "threshold_robust_z": float(threshold_z) if isinstance(threshold_z, (int, float)) else None,
        },
        "n_time": int(t_s.shape[0]),
        "t_s": _to_list(t_s),
        "score_db": _to_list(raw),
        "score_01": _to_list(score_01) if score_01 is not None else None,
        "is_active": _to_list(active.astype(bool)) if active is not None else None,
        "candidate_intervals": _candidate_intervals(events_json),
    }

    _write_json(out_path, payload)
    return out_path


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Build frontend compatibility JSON exports")
    ap.add_argument("--shot", required=True, help="Shot slug, e.g. whales_orca")
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    shot_dir = REPO_ROOT / "output" / "shots" / args.shot
    if not shot_dir.is_dir():
        raise SystemExit(f"Shot output directory not found: {shot_dir}")

    das_out = build_das_compat(shot_dir)
    hydro_out = build_hydro_compat(shot_dir)

    print(f"shot={args.shot}")
    print(f"  das_compat: {das_out.relative_to(REPO_ROOT) if das_out else 'skipped (source npz missing)'}")
    print(f"  hydro_compat: {hydro_out.relative_to(REPO_ROOT) if hydro_out else 'skipped (source npz missing)'}")


if __name__ == "__main__":
    main()
