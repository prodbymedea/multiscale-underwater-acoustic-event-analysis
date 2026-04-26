#!/usr/bin/env python3
"""
Build a compact single-channel DAS bundle for frontend demo (no HDF5 at runtime).

Stage 1 scope: whales_orca only, one default channel (preview col 189 / raw ch 945 by default).

Outputs (under output/shots/<shot>/):
  - selected_channel_bundle.json   — metadata + file index
  - selected_channel_signal.npz    — native-rate median-centered waveform
  - selected_channel_spectrogram.npz — STFT magnitude in dB
  - selected_channel_bandpass_score.npz — optional Orca band support score (not whale probability)

Optionally patches existing viewer_manifest.json to reference these files (does not remove keys).

Usage:
  python3 src/build_selected_channel_bundle.py --shot whales_orca
  python3 src/build_selected_channel_bundle.py --shot whales_orca --preview-col 189 --band 2000-2350
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import h5py
import numpy as np
from scipy.signal import butter, hilbert, spectrogram, sosfiltfilt

from _repo_paths import REPO_ROOT, resolve_shot_h5

ORCA_SUBDIR = "2022-01-26--04--Whales"
ORCA_FILE = "2022-01-26--04-47-42--Orca.h5"

SHOT_SPECS: dict[str, tuple[str, str]] = {
    "whales_orca": (ORCA_SUBDIR, ORCA_FILE),
}


def _mad_threshold(x: np.ndarray, k: float) -> float:
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    sig = 1.4826 * mad if mad > 1e-12 else float(np.std(x)) or 1.0
    return med + k * sig


def _band_sos(fs_hz: float, f_lo: float, f_hi: float, order: int = 4):
    nyq = 0.5 * fs_hz
    if not (0 < f_lo < f_hi < nyq * 0.99):
        raise ValueError(f"Band [{f_lo}, {f_hi}] Hz invalid for fs={fs_hz} (Nyquist={nyq}).")
    return butter(order, [f_lo / nyq, f_hi / nyq], btype="band", output="sos")


def _rolling_rms_1d(x: np.ndarray, win: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    if win < 3 or win > len(x):
        return np.sqrt(np.maximum(x, 0.0))
    w = np.ones(win, dtype=np.float64) / float(win)
    ex2 = np.convolve(x * x, w, mode="same")
    return np.sqrt(np.maximum(ex2, 0.0))


def _load_defaults_from_summaries(shot_dir: Path) -> tuple[int, float, float]:
    """Returns preview_col, f_lo, f_hi from latest JSON summaries when possible."""
    bp = shot_dir / "orca_bandpass_summary.json"
    if bp.is_file():
        with open(bp, encoding="utf-8") as f:
            doc = json.load(f)
        rec = doc.get("recommended_default_from_contrast_heuristic")
        if isinstance(rec, dict):
            col = int(rec["preview_column"])
            lo, hi = float(rec["band_hz"][0]), float(rec["band_hz"][1])
            return col, lo, hi
    ins = shot_dir / "channel_inspection_summary.json"
    if ins.is_file():
        with open(ins, encoding="utf-8") as f:
            doc = json.load(f)
        col = int(doc.get("recommended_default_preview_column", 189))
        return col, 2000.0, 2350.0
    return 189, 2000.0, 2350.0


def _shot_rel(shot_dir: Path, path: Path) -> str:
    try:
        return str(path.resolve().relative_to(shot_dir.resolve()))
    except Exception:
        return path.name


def _repo_rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT.resolve()))
    except Exception:
        return str(path)


def _patch_viewer_manifest(
    shot_dir: Path,
    *,
    bundle_name: str,
    shot_id: str,
    preview_col: int,
    raw_ch: int,
    band: list[float],
) -> None:
    man_p = shot_dir / "viewer_manifest.json"
    if not man_p.is_file():
        return
    with open(man_p, encoding="utf-8") as f:
        manifest: dict[str, Any] = json.load(f)

    files = manifest.setdefault("files", {})
    files["selected_channel_bundle"] = _shot_rel(shot_dir, shot_dir / bundle_name)
    files["selected_channel_signal"] = "selected_channel_signal.npz"
    files["selected_channel_spectrogram"] = "selected_channel_spectrogram.npz"
    files["selected_channel_bandpass_score"] = "selected_channel_bandpass_score.npz"

    manifest["selected_channel_demo"] = {
        "schema_version": "selected_channel_demo_v1",
        "shot_id": shot_id,
        "preview_column": preview_col,
        "raw_das_channel_index": raw_ch,
        "recommended_band_hz": band,
        "bundle_metadata_file": _shot_rel(shot_dir, shot_dir / bundle_name),
        "notes": (
            "Single-channel native-rate export for Orca demo. "
            "Band-pass score is DAS support only, not whale probability. "
            "Does not replace the DAS activity map."
        ),
    }

    notes = manifest.setdefault("notes", [])
    tag = "selected_channel_demo: compact NPZ bundle avoids HDF5 at frontend load time."
    if isinstance(notes, list) and tag not in notes:
        notes.append(tag)

    with open(man_p, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


def _parse_band(s: str) -> tuple[float, float]:
    a, b = s.split("-", 1)
    return float(a), float(b)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Build selected-channel NPZ bundle for viewer demo")
    ap.add_argument("--shot", default="whales_orca", choices=("whales_orca",))
    ap.add_argument("--shot-dir", type=Path, default=None)
    ap.add_argument("--preview-col", type=int, default=-1, help="Override preview column (default: from summaries)")
    ap.add_argument("--band", type=str, default="", help="f_lo-f_hi Hz, e.g. 2000-2350")
    ap.add_argument("--mad-k", type=float, default=3.0)
    ap.add_argument("--envelope-rms-ms", type=float, default=40.0)
    ap.add_argument(
        "--spectrogram-nperseg",
        type=int,
        default=512,
        help="STFT length at native DAS fs (~9.8 Hz freq resolution at 5 kHz)",
    )
    ap.add_argument("--spectrogram-noverlap", type=int, default=384)
    ap.add_argument("--no-patch-manifest", action="store_true", help="Do not merge paths into viewer_manifest.json")
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    shot_id = args.shot
    if shot_id not in SHOT_SPECS:
        raise SystemExit(f"Only {list(SHOT_SPECS)} supported in Stage 1.")

    shot_dir = (args.shot_dir or (REPO_ROOT / "output" / "shots" / shot_id)).resolve()
    shot_dir.mkdir(parents=True, exist_ok=True)

    def_col, def_lo, def_hi = _load_defaults_from_summaries(shot_dir)
    preview_col = int(args.preview_col) if args.preview_col >= 0 else def_col
    if args.band.strip():
        f_lo, f_hi = _parse_band(args.band.strip())
    else:
        f_lo, f_hi = def_lo, def_hi

    pre_meta_p = shot_dir / "das_preprocessing_metadata.json"
    pre_npz_p = shot_dir / "das_preprocessed_preview.npz"
    ev_p = shot_dir / "events.json"
    hydro_npz_p = shot_dir / "hydrophone_event_score.npz"
    hydro_meta_p = shot_dir / "hydrophone_event_score_metadata.json"
    shot_meta_p = shot_dir / "shot_metadata.json"

    for p in (pre_meta_p, pre_npz_p, ev_p, hydro_npz_p):
        if not p.is_file():
            raise SystemExit(f"Missing required file: {p}")

    with open(pre_meta_p, encoding="utf-8") as f:
        pre_meta = json.load(f)
    sel = pre_meta["selected_interval"]
    start_idx, end_idx = int(sel["start_idx"]), int(sel["end_idx"])

    z = np.load(pre_npz_p)
    channel_indices = np.asarray(z["channel_indices"], dtype=np.int64)
    distances_m = np.asarray(z["distances_m"], dtype=np.float64)
    if preview_col < 0 or preview_col >= len(channel_indices):
        raise SystemExit(f"preview_col {preview_col} out of range [0, {len(channel_indices)})")
    raw_ch = int(channel_indices[preview_col])
    dist_m = float(distances_m[preview_col])

    subdir, fname = SHOT_SPECS[shot_id]
    h5_path = resolve_shot_h5(subdir, fname)
    if not h5_path.is_file():
        raise SystemExit(f"Missing HDF5 for export: {h5_path}")

    with h5py.File(h5_path, "r") as f:
        das = f["DAS"]
        attrs = dict(das.attrs)
        fs_hz = float(attrs.get("OutputDataRate", 5000.0))
        amp_scaling = float(attrs.get("AmpScaling", 1.0))
        raw = das[start_idx:end_idx, raw_ch].astype(np.float64).ravel() * amp_scaling
    signal = (raw - np.median(raw)).astype(np.float32)
    n = signal.shape[0]
    t_native = (start_idx / fs_hz + np.arange(n, dtype=np.float64) / fs_hz).astype(np.float32)

    # --- Spectrogram (native rate, full band up to Nyquist for viewer exploration)
    nperseg = int(args.spectrogram_nperseg)
    noverlap = int(args.spectrogram_noverlap)
    freqs, t_spec, Sxx = spectrogram(
        signal.astype(np.float64),
        fs=fs_hz,
        window="hann",
        nperseg=nperseg,
        noverlap=noverlap,
        scaling="density",
        mode="psd",
    )
    Sxx_db = (10.0 * np.log10(np.maximum(Sxx, 1e-20))).astype(np.float32)

    # --- Band-pass score (same definition as orca_bandpass baseline)
    sos = _band_sos(fs_hz, f_lo, f_hi)
    filtered = sosfiltfilt(sos, raw)
    envelope = np.abs(hilbert(filtered))
    win = max(3, int(round(args.envelope_rms_ms * 1e-3 * fs_hz)))
    bandpass_support_score = _rolling_rms_1d(envelope, win).astype(np.float32)
    thr = float(_mad_threshold(bandpass_support_score.astype(np.float64), args.mad_k))
    signal_present_mask = (bandpass_support_score > thr).astype(np.uint8)

    sig_path = shot_dir / "selected_channel_signal.npz"
    spec_path = shot_dir / "selected_channel_spectrogram.npz"
    bp_path = shot_dir / "selected_channel_bandpass_score.npz"
    bundle_path = shot_dir / "selected_channel_bundle.json"

    np.savez_compressed(
        sig_path,
        t_s=t_native,
        signal=signal,
        signal_type=np.array("median_centered_native_amplitude"),
        channel_index=np.int32(raw_ch),
        preview_col=np.int32(preview_col),
        distance_m=np.float32(dist_m),
        fs_hz=np.float32(fs_hz),
    )
    np.savez_compressed(
        spec_path,
        t_s=t_spec.astype(np.float32),
        freqs_hz=freqs.astype(np.float32),
        Sxx_db=Sxx_db,
        channel_index=np.int32(raw_ch),
        preview_col=np.int32(preview_col),
        fs_hz=np.float32(fs_hz),
        nperseg=np.int32(nperseg),
        noverlap=np.int32(noverlap),
        window=np.array("hann"),
    )
    np.savez_compressed(
        bp_path,
        t_s=t_native,
        bandpass_support_score=bandpass_support_score,
        signal_present_mask=signal_present_mask,
        threshold=np.float32(thr),
        band_hz=np.array([f_lo, f_hi], dtype=np.float32),
        channel_index=np.int32(raw_ch),
        preview_col=np.int32(preview_col),
        mad_k=np.float32(args.mad_k),
        envelope_rms_window_ms=np.float32(args.envelope_rms_ms),
    )

    source_gt: dict[str, Any] = {"available": False}
    if shot_meta_p.is_file():
        with open(shot_meta_p, encoding="utf-8") as f:
            sm = json.load(f)
        src = sm.get("source") or {}
        if src.get("pos_x_m") is not None and src.get("pos_y_m") is not None:
            source_gt = {
                "available": True,
                "x": float(src["pos_x_m"]),
                "y": float(src["pos_y_m"]),
                "depth_m": float(src["depth_m"]) if src.get("depth_m") is not None else None,
                "coordinate_system": "CH1903+ / LV95",
            }

    t0, t1 = float(t_native[0]), float(t_native[-1])
    bundle: dict[str, Any] = {
        "schema_version": "selected_channel_bundle_v1",
        "shot_id": shot_id,
        "selected_preview_col": preview_col,
        "selected_raw_channel": raw_ch,
        "selected_distance_m": dist_m,
        "selected_channel_label": f"Orca DAS raw ch {raw_ch} (preview col {preview_col}, ~{dist_m:.1f} m along cable)",
        "time_range_s": [t0, t1],
        "sampling_rate_hz": fs_hz,
        "recommended_bandpass_hz": [f_lo, f_hi],
        "recommended_score_definition": (
            "rolling RMS of |Hilbert(band-pass trace)|; "
            f"threshold = median + {args.mad_k} * 1.4826 * MAD on score (DAS support, not whale probability)"
        ),
        "waveform_export": {
            "file": _shot_rel(shot_dir, sig_path),
            "description": "Median-centered DAS amplitude at native OutputDataRate (int16×AmpScaling, float32); full preprocessing interval.",
            "signal_dtype": "float32",
            "no_temporal_downsample": True,
        },
        "spectrogram_export": {
            "file": _shot_rel(shot_dir, spec_path),
            "spectrogram_time_range_s": [float(t_spec[0]), float(t_spec[-1])] if t_spec.size else [t0, t1],
            "spectrogram_freq_range_hz": [float(freqs[0]), float(freqs[-1])] if freqs.size else [0.0, fs_hz / 2.0],
            "nperseg": nperseg,
            "noverlap": noverlap,
            "window": "hann",
            "Sxx_scale": "PSD dB (10*log10)",
            "notes": "Covers full Nyquist; Orca-focused band 2000–2350 Hz is within this grid.",
        },
        "bandpass_support_export": {
            "file": _shot_rel(shot_dir, bp_path),
            "recommended_bandpass_hz": [f_lo, f_hi],
            "recommended_score_definition": (
                "rolling RMS of |Hilbert(band-pass trace)|; "
                f"threshold = median + {args.mad_k} * 1.4826 * MAD on score"
            ),
            "not_whale_probability": True,
        },
        "events_file": _shot_rel(shot_dir, ev_p),
        "hydrophone_score_file": _shot_rel(shot_dir, hydro_npz_p),
        "hydrophone_score_metadata_file": _shot_rel(shot_dir, hydro_meta_p)
        if hydro_meta_p.is_file()
        else None,
        "source_ground_truth": source_gt,
        "bundle_files": {
            "metadata": _shot_rel(shot_dir, bundle_path),
            "signal_npz": _shot_rel(shot_dir, sig_path),
            "spectrogram_npz": _shot_rel(shot_dir, spec_path),
            "bandpass_score_npz": _shot_rel(shot_dir, bp_path),
        },
        "repo_relative_paths": {
            "shot_dir": _repo_rel(shot_dir),
        },
        "notes": [
            "Frontend should load this bundle instead of HDF5 for the default Orca single-channel demo.",
            "DAS activity map and hydrophone pipeline outputs remain the primary synchronized layers.",
            "Band-pass score is optional DAS-side support for selected-channel view only.",
        ],
    }

    with open(bundle_path, "w", encoding="utf-8") as f:
        json.dump(bundle, f, indent=2, ensure_ascii=False)

    if not args.no_patch_manifest:
        _patch_viewer_manifest(
            shot_dir,
            bundle_name=bundle_path.name,
            shot_id=shot_id,
            preview_col=preview_col,
            raw_ch=raw_ch,
            band=[f_lo, f_hi],
        )

    print(f"Default channel: preview_col={preview_col} raw_ch={raw_ch} band={f_lo}-{f_hi} Hz")
    print(f"Saved {bundle_path.name}")
    print(f"Saved {sig_path.name} ({n} samples @ {fs_hz} Hz)")
    print(f"Saved {spec_path.name} Sxx_db shape {Sxx_db.shape}")
    print(f"Saved {bp_path.name}")
    if not args.no_patch_manifest:
        print("Patched viewer_manifest.json with selected_channel_demo + file paths")


if __name__ == "__main__":
    main()
