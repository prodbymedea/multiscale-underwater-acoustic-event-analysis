#!/usr/bin/env python3
"""
Build viewer-oriented manifests for Whales shots (Sprint 2 backend, Step 4).

This script does not generate heavy arrays. It only assembles compact JSON
metadata and file references for the future synchronized viewer.

Outputs:
  - output/shots/<slug>/viewer_manifest.json
  - output/viewer_index.json

Usage:
  python3 src/build_viewer_bundle.py
  python3 src/build_viewer_bundle.py --shot whales_humpback
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from _repo_paths import REPO_ROOT

PROJECT_TITLE = "Multiscale data visualization and event analysis for a distributed underwater acoustic monitoring system"
SUBSET_SCOPE = "Whales subset only"
SHOTS = ("whales_humpback", "whales_orca")

REQUIRED = [
    "shot_metadata.json",
    "recorders_summary.json",
    "situation.json",
    "events.json",
    "das_activity_map.npz",
    "das_activity_map_metadata.json",
    "hydrophone_event_score.npz",
    "hydrophone_event_score_metadata.json",
]


def _safe_read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT.resolve()))
    except Exception:
        return str(path)


def _shot_rel(shot_dir: Path, path: Path) -> str:
    """Return path relative to the shot directory for frontend file loading."""
    try:
        return str(path.resolve().relative_to(shot_dir.resolve()))
    except Exception:
        return path.name


def _time_range_from_npz(npz_path: Path, key: str) -> list[float] | None:
    if not npz_path.is_file():
        return None
    try:
        z = np.load(npz_path)
        if key not in z:
            return None
        t = np.asarray(z[key], dtype=np.float64)
        if t.size == 0:
            return None
        return [float(t[0]), float(t[-1])]
    except Exception:
        return None


def _compute_overlap(a: list[float] | None, b: list[float] | None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "hydro_time_range_s": a,
        "das_activity_time_range_s": b,
        "time_overlap": None,
        "overlap_time_range_s": None,
    }
    if not (isinstance(a, list) and isinstance(b, list)):
        return out
    s0, s1 = max(a[0], b[0]), min(a[1], b[1])
    ok = s1 >= s0
    out["time_overlap"] = bool(ok)
    out["overlap_time_range_s"] = [float(s0), float(s1)] if ok else None
    return out


def _required_status(shot_dir: Path) -> tuple[bool, list[str]]:
    missing = []
    for name in REQUIRED:
        p = shot_dir / name
        if not p.is_file():
            missing.append(_rel(p))
    return len(missing) == 0, missing


def _figure_refs(shot: str) -> dict[str, str]:
    fig_dir = REPO_ROOT / "figures" / "shots" / shot
    refs = {
        "das_activity_map": fig_dir / "das_activity_map.png",
        "das_rms_vs_activity": fig_dir / "das_rms_vs_activity.png",
        "hydrophone_event_score": fig_dir / "hydrophone_event_score.png",
        "score_with_events": fig_dir / "score_with_events.png",
    }
    return {k: _rel(v) for k, v in refs.items() if v.is_file()}


def _spatial_summary(situation: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(situation, dict):
        return {
            "available": False,
            "bathymetry_available": False,
            "fiber_track_available": False,
            "boat_tracks_available": False,
        }

    bathy = situation.get("bathymetry") or {}
    fiber = situation.get("fiber_track") or {}
    boats = situation.get("boat_tracks") or {}
    segs = (fiber.get("segments") or {}) if isinstance(fiber, dict) else {}
    tracks = (boats.get("tracks") or {}) if isinstance(boats, dict) else {}
    n_fiber_pts = 0
    if isinstance(segs, dict):
        for v in segs.values():
            if isinstance(v, list):
                n_fiber_pts += len(v)
    return {
        "available": True,
        "coordinate_system": (situation.get("meta") or {}).get("Coordinate System"),
        "bathymetry_available": isinstance(bathy, dict) and bool(bathy),
        "bathymetry_shape": bathy.get("shape") if isinstance(bathy, dict) else None,
        "fiber_track_available": isinstance(segs, dict) and bool(segs),
        "fiber_track_segments": list(segs.keys()) if isinstance(segs, dict) else [],
        "fiber_track_points_estimate": int(n_fiber_pts),
        "boat_tracks_available": isinstance(tracks, dict) and bool(tracks),
        "boat_track_count": len(tracks) if isinstance(tracks, dict) else 0,
        "source_file_note": "Large map arrays remain in situation.json and are referenced, not duplicated.",
    }


def _source_ground_truth(shot_meta: dict[str, Any] | None, spatial_summary: dict[str, Any]) -> dict[str, Any]:
    src = (shot_meta or {}).get("source") or {}
    x = src.get("pos_x_m")
    y = src.get("pos_y_m")
    d = src.get("depth_m")
    available = x is not None and y is not None
    return {
        "available": bool(available),
        "x": float(x) if x is not None else None,
        "y": float(y) if y is not None else None,
        "depth_m": float(d) if d is not None else None,
        "coordinate_system": spatial_summary.get("coordinate_system"),
    }


def _recommended_interval(events: dict[str, Any] | None, overlap: dict[str, Any]) -> list[float] | None:
    evs = (events or {}).get("events") or []
    if not evs:
        return overlap.get("overlap_time_range_s")
    e0 = evs[0]
    s = float(e0.get("start_time_s", 0.0))
    e = float(e0.get("end_time_s", s))
    c = 0.5 * (s + e)
    out = [max(0.0, c - 2.0), c + 2.0]
    ov = overlap.get("overlap_time_range_s")
    if isinstance(ov, list):
        out[0] = max(out[0], ov[0])
        out[1] = min(out[1], ov[1])
        if out[1] < out[0]:
            return ov
    return out


def build_manifest(shot: str) -> dict[str, Any]:
    shot_dir = REPO_ROOT / "output" / "shots" / shot
    viewer_manifest_path = shot_dir / "viewer_manifest.json"

    # Base files
    shot_meta_p = shot_dir / "shot_metadata.json"
    rec_p = shot_dir / "recorders_summary.json"
    sit_p = shot_dir / "situation.json"
    events_p = shot_dir / "events.json"
    das_npz_p = shot_dir / "das_activity_map.npz"
    das_meta_p = shot_dir / "das_activity_map_metadata.json"
    hydro_npz_p = shot_dir / "hydrophone_event_score.npz"
    hydro_meta_p = shot_dir / "hydrophone_event_score_metadata.json"

    shot_meta = _safe_read_json(shot_meta_p)
    rec = _safe_read_json(rec_p)
    situation = _safe_read_json(sit_p)
    events = _safe_read_json(events_p)
    das_meta = _safe_read_json(das_meta_p)
    hydro_meta = _safe_read_json(hydro_meta_p)

    ready, missing = _required_status(shot_dir)
    n_events = int((events or {}).get("n_events", len((events or {}).get("events", []))))

    hydro_time = _time_range_from_npz(hydro_npz_p, "t_s")
    das_time = _time_range_from_npz(das_npz_p, "t_windows_s")
    overlap = _compute_overlap(hydro_time, das_time)
    # Prefer alignment info from hydro metadata if present
    hyd_align = (hydro_meta or {}).get("time_alignment_with_das_activity")
    if isinstance(hyd_align, dict):
        for k in ("hydro_time_range_s", "das_activity_time_range_s", "time_overlap", "overlap_time_range_s"):
            if k in hyd_align:
                overlap[k] = hyd_align.get(k)

    available_time_range = overlap.get("overlap_time_range_s") or hydro_time or das_time
    spatial = _spatial_summary(situation)
    source_gt = _source_ground_truth(shot_meta, spatial)
    recommended_interval = _recommended_interval(events, overlap)

    recorder_names = list((rec or {}).keys()) if isinstance(rec, dict) else []
    recorder_primary = recorder_names[0] if recorder_names else None

    manifest = {
        "schema_version": "viewer_manifest_v1",
        "project_title": PROJECT_TITLE,
        "subset_scope": SUBSET_SCOPE,
        "shot_id": shot,
        "display_name": (shot_meta or {}).get("file") or shot,
        "subset": "2022-01-26--04--Whales",
        "viewer_ready": bool(ready),
        "available_time_range_s": available_time_range,
        "recommended_default_interval_s": recommended_interval,
        "event_count": n_events,
        "source_ground_truth": source_gt,
        "spatial_context_summary": spatial,
        "time_alignment_summary": overlap,
        "recorder_summary": {
            "available_recorders": (shot_meta or {}).get("recorders_available"),
            "primary_recorder": recorder_primary,
            "recorders_in_summary": recorder_names,
        },
        "files": {
            # Frontend compatibility keys (site/app.js) with shot-relative paths.
            "shot_metadata": _shot_rel(shot_dir, shot_meta_p),
            "recorders_summary": _shot_rel(shot_dir, rec_p),
            "events": _shot_rel(shot_dir, events_p),
            "situation": _shot_rel(shot_dir, sit_p),
            "hydrophone_activity": _shot_rel(shot_dir, shot_dir / "hydrophone_activity.json"),
            "das_activity": _shot_rel(shot_dir, shot_dir / "viewer" / "das_activity.json"),
            # Current compact-manifest keys retained for backend/docs compatibility.
            "events_file": _rel(events_p),
            "das_activity_map_file": _rel(das_npz_p),
            "das_activity_metadata_file": _rel(das_meta_p),
            "hydrophone_score_file": _rel(hydro_npz_p),
            "hydrophone_score_metadata_file": _rel(hydro_meta_p),
            "situation_file": _rel(sit_p),
            "shot_metadata_file": _rel(shot_meta_p),
            "recorders_summary_file": _rel(rec_p),
            "viewer_manifest_file": _rel(viewer_manifest_path),
        },
        "figures": _figure_refs(shot),
        "missing_files": missing,
        "notes": [
            "Hydrophone event score is a support timing layer, not whale probability.",
            "DAS activity map is the main visual layer for where/how interpretation.",
            "Manifest references large artifacts by path and avoids duplicating large arrays.",
        ],
    }

    shot_dir.mkdir(parents=True, exist_ok=True)
    with open(viewer_manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    return manifest


def build_index(manifests: list[dict[str, Any]]) -> dict[str, Any]:
    idx_path = REPO_ROOT / "output" / "viewer_index.json"
    shots_compact = []
    for m in manifests:
        shots_compact.append(
            {
                "shot_id": m["shot_id"],
                "display_name": m["display_name"],
                "viewer_ready": m["viewer_ready"],
                "event_count": m["event_count"],
                "available_time_range_s": m["available_time_range_s"],
                "recommended_default_interval_s": m["recommended_default_interval_s"],
                "viewer_manifest_file": m["files"]["viewer_manifest_file"],
            }
        )

    payload = {
        "schema_version": "viewer_index_v1",
        "project_title": PROJECT_TITLE,
        "scope": SUBSET_SCOPE,
        "shots_available": [m["shot_id"] for m in manifests],
        "recommended_primary_shot": "whales_humpback",
        "recommended_secondary_shot": "whales_orca",
        "all_viewer_ready": all(m["viewer_ready"] for m in manifests),
        "shots": shots_compact,
    }
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    return payload


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Build compact viewer manifests for Whales shots")
    ap.add_argument("--shot", choices=SHOTS, default=None, help="Build one shot only")
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    shots = [args.shot] if args.shot else list(SHOTS)

    built_map = {m["shot_id"]: m for m in [build_manifest(s) for s in shots]}

    # Build index from all Whales shots:
    # use freshly built manifests when available, otherwise load existing
    # per-shot manifests or build them if missing.
    manifests_for_index: list[dict[str, Any]] = []
    for s in SHOTS:
        if s in built_map:
            manifests_for_index.append(built_map[s])
            continue
        manifest_path = REPO_ROOT / "output" / "shots" / s / "viewer_manifest.json"
        m = _safe_read_json(manifest_path)
        if not isinstance(m, dict):
            m = build_manifest(s)
        manifests_for_index.append(m)

    idx = build_index(manifests_for_index)

    print("Built viewer manifests:")
    for m in built_map.values():
        print(
            f"  - {m['shot_id']}: ready={m['viewer_ready']}, "
            f"events={m['event_count']}, manifest={m['files']['viewer_manifest_file']}"
        )
    print(f"Built viewer index: output/viewer_index.json (all_ready={idx['all_viewer_ready']})")


if __name__ == "__main__":
    main()
