#!/usr/bin/env python3
"""
Validate viewer-readiness for Whales shots (Sprint 2 backend outputs).

Checks required artifacts for:
  - whales_humpback
  - whales_orca

Optional:
  --shot <slug>   check one shot only
  --json          also write compact report to output/shots/VIEWER_READY_STATUS.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from _repo_paths import REPO_ROOT

SHOTS = ("whales_humpback", "whales_orca")

REQUIRED_FILES = {
    "base_exports": [
        "shot_metadata.json",
        "recorders_summary.json",
        "spectrogram.json",
        "waveform.json",
        "situation.json",
    ],
    "events": [
        "events.json",
    ],
    "preprocessing": [
        "das_preprocessed_preview.npz",
        "das_preprocessing_metadata.json",
    ],
    "activity_map": [
        "das_activity_map.npz",
        "das_activity_map_metadata.json",
    ],
    "waterfall": [
        "das_waterfall_preview.npz",
        "das_waterfall_preview_metadata.json",
    ],
    "hydrophone_score": [
        "hydrophone_event_score.npz",
        "hydrophone_event_score_metadata.json",
    ],
}


def _status(ok: bool) -> str:
    return "ok" if ok else "missing"


def _all_required_for_group_exist(shot_dir: Path, group: str) -> tuple[bool, list[str]]:
    missing: list[str] = []
    for name in REQUIRED_FILES[group]:
        p = shot_dir / name
        if not p.is_file():
            missing.append(str(p))
    return (len(missing) == 0), missing


def _extract_summary_fields(shot_dir: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "event_count": None,
        "das_preview_time_range_s": None,
        "candidate_events_fully_inside_das_preview": None,
        "das_activity_shape": None,
        "das_waterfall_shape": None,
        "das_waterfall_dtype": None,
        "das_waterfall_channel_range": None,
        "das_activity_time_range_s": None,
        "hydro_score_len": None,
        "hydro_score_time_range_s": None,
        "time_overlap": None,
        "overlap_time_range_s": None,
    }

    events_p = shot_dir / "events.json"
    events_list: list[dict[str, Any]] = []
    if events_p.is_file():
        try:
            with open(events_p, "r", encoding="utf-8") as f:
                ev = json.load(f)
            summary["event_count"] = int(ev.get("n_events", len(ev.get("events", []))))
            events_list = list(ev.get("events") or [])
        except Exception:
            summary["event_count"] = None

    pre_npz = shot_dir / "das_preprocessed_preview.npz"
    if pre_npz.is_file():
        try:
            z = np.load(pre_npz)
            if "t_s" in z:
                t = np.asarray(z["t_s"], dtype=np.float64)
                if t.size:
                    summary["das_preview_time_range_s"] = [float(t[0]), float(t[-1])]
        except Exception:
            pass

    pr = summary.get("das_preview_time_range_s")
    if isinstance(pr, list) and len(pr) == 2 and events_list:
        p0, p1 = float(pr[0]), float(pr[1])
        inside_flags = []
        for e in events_list:
            t0, t1 = float(e["start_time_s"]), float(e["end_time_s"])
            inside_flags.append(t0 >= p0 - 1e-6 and t1 <= p1 + 1e-6)
        summary["candidate_events_fully_inside_das_preview"] = bool(all(inside_flags))

    activity_p = shot_dir / "das_activity_map.npz"
    if activity_p.is_file():
        try:
            z = np.load(activity_p)
            if "activity_map" in z:
                a = np.asarray(z["activity_map"])
                summary["das_activity_shape"] = [int(a.shape[0]), int(a.shape[1])]
            if "t_windows_s" in z:
                t = np.asarray(z["t_windows_s"], dtype=np.float64)
                if t.size:
                    summary["das_activity_time_range_s"] = [float(t[0]), float(t[-1])]
        except Exception:
            pass

    waterfall_p = shot_dir / "das_waterfall_preview.npz"
    if waterfall_p.is_file():
        try:
            z = np.load(waterfall_p)
            if "data" in z:
                a = np.asarray(z["data"])
                summary["das_waterfall_shape"] = [int(a.shape[0]), int(a.shape[1])]
                summary["das_waterfall_dtype"] = str(a.dtype)
            if "channel_indices" in z:
                ch = np.asarray(z["channel_indices"])
                if ch.size:
                    summary["das_waterfall_channel_range"] = [int(ch[0]), int(ch[-1])]
        except Exception:
            pass

    score_p = shot_dir / "hydrophone_event_score.npz"
    if score_p.is_file():
        try:
            z = np.load(score_p)
            if "t_s" in z:
                t = np.asarray(z["t_s"], dtype=np.float64)
                summary["hydro_score_len"] = int(t.size)
                if t.size:
                    summary["hydro_score_time_range_s"] = [float(t[0]), float(t[-1])]
        except Exception:
            pass

    score_meta_p = shot_dir / "hydrophone_event_score_metadata.json"
    if score_meta_p.is_file():
        try:
            with open(score_meta_p, "r", encoding="utf-8") as f:
                m = json.load(f)
            al = m.get("time_alignment_with_das_activity") or {}
            if "time_overlap" in al:
                summary["time_overlap"] = bool(al.get("time_overlap"))
            if "overlap_time_range_s" in al:
                summary["overlap_time_range_s"] = al.get("overlap_time_range_s")
        except Exception:
            pass

    # Fallback overlap computation if metadata doesn't provide it.
    if summary["time_overlap"] is None:
        h = summary.get("hydro_score_time_range_s")
        d = summary.get("das_activity_time_range_s")
        if isinstance(h, list) and isinstance(d, list):
            s0, s1 = max(h[0], d[0]), min(h[1], d[1])
            summary["time_overlap"] = bool(s1 >= s0)
            summary["overlap_time_range_s"] = [s0, s1] if s1 >= s0 else None

    return summary


def check_shot(shot: str) -> dict[str, Any]:
    shot_dir = REPO_ROOT / "output" / "shots" / shot
    group_status: dict[str, str] = {}
    missing_files: list[str] = []

    for group in ("preprocessing", "activity_map", "waterfall", "hydrophone_score", "events", "base_exports"):
        ok, miss = _all_required_for_group_exist(shot_dir, group)
        group_status[group] = _status(ok)
        missing_files.extend(miss)

    overall_ok = len(missing_files) == 0
    summary = _extract_summary_fields(shot_dir)
    return {
        "shot_id": shot,
        "paths": {"shot_dir": str(shot_dir)},
        "status": {
            **group_status,
            "overall": "viewer-ready" if overall_ok else "incomplete",
        },
        "summary": summary,
        "missing_files": missing_files,
    }


def _print_table(rows: list[dict[str, Any]]) -> None:
    headers = [
        "shot_id",
        "preprocessing",
        "activity_map",
        "hydro_score",
        "waterfall",
        "events",
        "base_exports",
        "overall",
    ]
    fmt = "{:<18} {:<13} {:<12} {:<12} {:<12} {:<8} {:<12} {:<12}"
    print(fmt.format(*headers))
    print("-" * 92)
    for r in rows:
        st = r["status"]
        print(
            fmt.format(
                r["shot_id"],
                st["preprocessing"],
                st["activity_map"],
                st["hydrophone_score"],
                st["waterfall"],
                st["events"],
                st["base_exports"],
                st["overall"],
            )
        )


def _print_details(rows: list[dict[str, Any]]) -> None:
    for r in rows:
        sm = r["summary"]
        print(f"\n[{r['shot_id']}]")
        print(f"  event_count: {sm.get('event_count')}")
        print(f"  das_preview_time_range_s: {sm.get('das_preview_time_range_s')}")
        print(f"  candidate_events_fully_inside_das_preview: {sm.get('candidate_events_fully_inside_das_preview')}")
        print(f"  das_activity_shape: {sm.get('das_activity_shape')}")
        print(f"  das_waterfall_shape: {sm.get('das_waterfall_shape')}")
        print(f"  das_waterfall_dtype: {sm.get('das_waterfall_dtype')}")
        print(f"  das_waterfall_channel_range: {sm.get('das_waterfall_channel_range')}")
        print(f"  hydro_score_len: {sm.get('hydro_score_len')}")
        print(f"  das_activity_time_range_s: {sm.get('das_activity_time_range_s')}")
        print(f"  hydro_score_time_range_s: {sm.get('hydro_score_time_range_s')}")
        print(f"  time_overlap: {sm.get('time_overlap')}")
        print(f"  overlap_time_range_s: {sm.get('overlap_time_range_s')}")
        if r["missing_files"]:
            print("  missing files:")
            for p in r["missing_files"]:
                print(f"    - {p}")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Check viewer-readiness for Whales shots")
    ap.add_argument("--shot", choices=SHOTS, default=None, help="Check one shot only")
    ap.add_argument(
        "--json",
        action="store_true",
        help="Write compact report to output/shots/VIEWER_READY_STATUS.json",
    )
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    shots = [args.shot] if args.shot else list(SHOTS)

    rows = [check_shot(s) for s in shots]
    _print_table(rows)
    _print_details(rows)

    all_ready = all(r["status"]["overall"] == "viewer-ready" for r in rows)
    print(f"\nOverall across selected shots: {'viewer-ready' if all_ready else 'incomplete'}")

    if args.json:
        out_path = REPO_ROOT / "output" / "shots" / "VIEWER_READY_STATUS.json"
        payload = {
            "schema_version": "viewer_ready_status_v1",
            "shots_checked": shots,
            "overall": "viewer-ready" if all_ready else "incomplete",
            "rows": rows,
        }
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        print(f"Saved JSON report: {out_path}")


if __name__ == "__main__":
    main()
