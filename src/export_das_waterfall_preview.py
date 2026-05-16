#!/usr/bin/env python3
"""
Export a notebook-style DAS waterfall preview from raw HDF5.

This artifact is intentionally different from `das_preprocessed_preview.npz`.
It follows the reference notebook preview convention: load a compact contiguous
raw DAS sample window, keep the full channel axis, and store native raw counts
so broad cable structure remains visible. It is a visualization/context
artifact, not a whale detection product.

Outputs:
  - output/shots/<shot>/das_waterfall_preview.npz
  - output/shots/<shot>/das_waterfall_preview_metadata.json

Usage:
  python3 src/export_das_waterfall_preview.py --shot whales_orca
  python3 src/export_das_waterfall_preview.py --shot whales_humpback
  python3 src/export_das_waterfall_preview.py --all
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import h5py
import numpy as np

from _repo_paths import REPO_ROOT, resolve_shot_h5

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
    spec = WHALES_SHOTS[slug]
    return resolve_shot_h5(spec["subdir"], spec["filename"])


def _json_safe(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def _stats(arr: np.ndarray) -> dict[str, float]:
    q = np.percentile(arr, [1, 2, 5, 50, 95, 98, 99])
    return {
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr)),
        "p01": float(q[0]),
        "p02": float(q[1]),
        "p05": float(q[2]),
        "p50": float(q[3]),
        "p95": float(q[4]),
        "p98": float(q[5]),
        "p99": float(q[6]),
    }


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Export raw/native DAS waterfall preview")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--shot", choices=sorted(WHALES_SHOTS))
    group.add_argument("--all", action="store_true", help="Export all whales shots")
    ap.add_argument("--shot-path", type=Path, default=None, help="Override HDF5 path for --shot")
    ap.add_argument("--start-s", type=float, default=0.0)
    ap.add_argument("--duration-s", type=float, default=0.0, help="If >0, overrides --max-samples")
    ap.add_argument(
        "--max-samples",
        type=int,
        default=30_000,
        help="Maximum raw DAS samples to export when --duration-s is not set; 30000 matches the reference notebook preview.",
    )
    ap.add_argument("--time-downsample", type=int, default=1, help="Keep every Nth raw DAS sample")
    ap.add_argument("--channel-step", type=int, default=1, help="Keep every Nth DAS channel")
    ap.add_argument("--max-channels", type=int, default=0, help="0 = no channel cap")
    ap.add_argument("--apply-amp-scaling", action="store_true", help="Store scaled float32 units instead of native int16 counts")
    ap.add_argument("--out-dir", type=Path, default=None)
    return ap.parse_args()


def export_one(args: argparse.Namespace, shot: str) -> Path:
    shot_path = args.shot_path if args.shot_path and args.shot else _shot_path_from_slug(shot)
    if not shot_path.is_file():
        raise SystemExit(f"Shot not found: {shot_path}")

    out_dir = args.out_dir or (REPO_ROOT / "output" / "shots" / shot)
    out_dir.mkdir(parents=True, exist_ok=True)

    with h5py.File(shot_path, "r") as f:
        if "DAS" not in f:
            raise SystemExit(f"DAS dataset not found in shot: {shot_path}")
        das = f["DAS"]
        n_samples, n_channels = das.shape
        attrs = {str(k): _json_safe(v) for k, v in das.attrs.items()}
        raw_fs_hz = float(das.attrs.get("OutputDataRate", 5000.0))
        amp_scaling = float(das.attrs.get("AmpScaling", 1.0))
        start_dist = float(das.attrs.get("StartDistance", 0.0))
        spatial_res = float(das.attrs.get("SpatialResolution", 1.0))

        start_idx = max(0, int(round(args.start_s * raw_fs_hz)))
        if args.duration_s > 0:
            end_idx = min(n_samples, start_idx + int(round(args.duration_s * raw_fs_hz)))
        elif args.max_samples > 0:
            end_idx = min(n_samples, start_idx + int(args.max_samples))
        else:
            end_idx = n_samples
        if end_idx <= start_idx:
            raise SystemExit("Empty selected interval; adjust --start-s / --duration-s.")

        ds = max(1, int(args.time_downsample))
        channel_step = max(1, int(args.channel_step))
        channel_indices = np.arange(0, n_channels, channel_step, dtype=np.int32)
        if args.max_channels > 0:
            channel_indices = channel_indices[: args.max_channels]

        sample_indices = np.arange(start_idx, end_idx, ds, dtype=np.int32)
        data = das[start_idx:end_idx:ds, channel_indices]
        if args.apply_amp_scaling:
            data_out = data.astype(np.float32) * amp_scaling
            amplitude_units = str(attrs.get("RawDataUnit", "DAS units")) + " scaled by AmpScaling"
        else:
            data_out = data.astype(np.int16, copy=False)
            amplitude_units = "native int16 DAS counts before AmpScaling"

    t_s = sample_indices.astype(np.float64) / raw_fs_hz
    distances_m = start_dist + channel_indices.astype(np.float64) * spatial_res
    preview_fs_hz = raw_fs_hz / ds

    npz_path = out_dir / "das_waterfall_preview.npz"
    np.savez_compressed(
        npz_path,
        data=data_out,
        t_s=t_s.astype(np.float32),
        sample_indices=sample_indices,
        channel_indices=channel_indices,
        distances_m=distances_m.astype(np.float32),
        raw_fs_hz=np.asarray([raw_fs_hz], dtype=np.float32),
        fs_hz=np.asarray([preview_fs_hz], dtype=np.float32),
        time_downsample=np.asarray([ds], dtype=np.int32),
        amp_scaling=np.asarray([amp_scaling], dtype=np.float32),
    )

    metadata = {
        "schema_version": "das_waterfall_preview_v1",
        "shot_slug": shot,
        "shot_path": str(shot_path.resolve()),
        "source_dataset": "DAS",
        "das_shape_n_samples_x_n_channels": [int(n_samples), int(n_channels)],
        "data_shape_time_x_channels": [int(data_out.shape[0]), int(data_out.shape[1])],
        "dtype": str(data_out.dtype),
        "raw_fs_hz": raw_fs_hz,
        "preview_fs_hz": preview_fs_hz,
        "time_downsample": ds,
        "selected_interval": {
            "start_idx": int(start_idx),
            "end_idx": int(end_idx),
            "start_time_s": float(start_idx / raw_fs_hz),
            "end_time_s": float(end_idx / raw_fs_hz),
        },
        "channel_selection": {
            "channel_step": channel_step,
            "max_channels": int(args.max_channels),
            "n_channels_selected": int(len(channel_indices)),
            "channel_indices_min_max": [int(channel_indices[0]), int(channel_indices[-1])],
        },
        "amplitude_units": amplitude_units,
        "processing_note": (
            "Notebook-style raw DAS waterfall preview: compact contiguous raw sample window, full channel axis by default, "
            "no band-pass, no per-channel robust normalization, no AmpScaling unless requested. "
            "Only optional time/channel subsampling is applied for browser-sized preview."
        ),
        "normalization": "none in exported data; frontend applies display-only robust diverging color clipping",
        "stats": _stats(data_out),
        "hdf5_attrs": attrs,
        "outputs": {
            "npz_path": str(npz_path.resolve()),
            "metadata_path": str((out_dir / "das_waterfall_preview_metadata.json").resolve()),
        },
    }

    meta_path = out_dir / "das_waterfall_preview_metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    print(f"Shot: {shot}")
    print(f"Loaded: {shot_path}")
    print(f"Waterfall data: {data_out.shape}, dtype={data_out.dtype}, channels={len(channel_indices)}, fs={preview_fs_hz:g} Hz")
    print(f"Amplitude: {amplitude_units}")
    print(f"Saved: {npz_path}")
    print(f"Saved: {meta_path}")
    return npz_path


def main() -> None:
    args = parse_args()
    shots = sorted(WHALES_SHOTS) if args.all else [args.shot]
    if args.shot_path and len(shots) != 1:
        raise SystemExit("--shot-path can only be used with --shot")
    for shot in shots:
        export_one(args, shot)


if __name__ == "__main__":
    main()
