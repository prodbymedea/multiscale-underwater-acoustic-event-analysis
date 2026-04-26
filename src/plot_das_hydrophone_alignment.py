#!/usr/bin/env python3
"""
Quick validation figure: DAS preview/activity coverage vs hydrophone score and events.

For whales_orca the default output name is `orca_alignment_check.png` (Backend Task 2).

Usage:
  python3 src/plot_das_hydrophone_alignment.py --shot whales_orca
  python3 src/plot_das_hydrophone_alignment.py --shot whales_humpback
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np

from _repo_paths import REPO_ROOT

_mpl_cfg = REPO_ROOT / ".mplconfig"
_mpl_cfg.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

SHOTS = ("whales_humpback", "whales_orca")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Plot DAS vs hydrophone time alignment")
    ap.add_argument("--shot", required=True, choices=SHOTS)
    ap.add_argument("--shot-dir", type=Path, default=None)
    ap.add_argument("--fig-dir", type=Path, default=None)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    shot = args.shot
    shot_dir = (args.shot_dir or (REPO_ROOT / "output" / "shots" / shot)).resolve()
    fig_dir = (args.fig_dir or (REPO_ROOT / "figures" / "shots" / shot)).resolve()
    fig_dir.mkdir(parents=True, exist_ok=True)

    if shot == "whales_orca":
        out_png = fig_dir / "orca_alignment_check.png"
    else:
        out_png = fig_dir / "das_hydrophone_alignment.png"

    pre_npz = shot_dir / "das_preprocessed_preview.npz"
    act_npz = shot_dir / "das_activity_map.npz"
    hydro_npz = shot_dir / "hydrophone_event_score.npz"
    events_p = shot_dir / "events.json"

    for p in (pre_npz, act_npz, hydro_npz, events_p):
        if not p.is_file():
            raise SystemExit(f"Missing {p}")

    t_das = np.asarray(np.load(pre_npz)["t_s"], dtype=np.float64)
    t_act = np.asarray(np.load(act_npz)["t_windows_s"], dtype=np.float64)
    hz = np.load(hydro_npz)
    t_h = np.asarray(hz["t_s"], dtype=np.float64)
    s_norm = np.asarray(hz["normalized_event_score"], dtype=np.float64)

    with open(events_p, encoding="utf-8") as f:
        ev_doc = json.load(f)
    events = list(ev_doc.get("events") or [])

    t_hi = float(max(t_das[-1], t_act[-1], t_h[-1]))
    for ev in events:
        t_hi = max(t_hi, float(ev["end_time_s"]))

    fig, ax = plt.subplots(figsize=(12, 4.5))
    d0, d1 = float(t_das[0]), float(t_das[-1])
    a0, a1 = float(t_act[0]), float(t_act[-1])

    ax.axvspan(d0, d1, alpha=0.15, color="tab:blue", label=f"DAS preprocessed preview [{d0:.2f}, {d1:.2f}] s")
    ax.axvspan(a0, a1, alpha=0.12, color="tab:cyan", label=f"DAS activity map [{a0:.2f}, {a1:.2f}] s")

    ax.plot(t_h, s_norm, color="tab:orange", lw=0.9, label="Hydrophone support score (norm.)")

    for ev in events:
        t0, t1 = float(ev["start_time_s"]), float(ev["end_time_s"])
        inside = t0 >= d0 - 1e-6 and t1 <= d1 + 1e-6
        col = "tab:red" if inside else "tab:purple"
        ax.axvspan(t0, t1, alpha=0.22, color=col, linewidth=0)

    ax.set_xlim(0.0, t_hi * 1.02)
    ax.set_ylim(-0.05, 1.05)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Normalized hydro score")
    ax.set_title(f"{shot}: DAS coverage vs hydrophone timing (candidate events shaded)")
    ax.grid(True, alpha=0.25)

    handles, labels = ax.get_legend_handles_labels()
    from matplotlib.patches import Patch

    handles.extend(
        [
            Patch(facecolor="tab:red", alpha=0.22, label="Event inside DAS preview"),
            Patch(facecolor="tab:purple", alpha=0.22, label="Event outside DAS preview"),
        ]
    )
    ax.legend(handles=handles, loc="upper right", fontsize=8)

    fig.tight_layout()
    fig.savefig(out_png, dpi=120)
    plt.close(fig)
    print(f"Saved {out_png}")


if __name__ == "__main__":
    main()
