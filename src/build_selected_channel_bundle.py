#!/usr/bin/env python3
"""
Build compact selected-channel DAS bundles for the frontend (no HDF5 at runtime).

Stage 2 (default): whales_orca exports fixed preview columns (189, 12, 50, extras) plus
nearest-grid resolves for NCC hotspot raw anchors (859, 861, 862, 920) and `selected_channels_index.json`;
legacy `selected_channel_*.npz` duplicates the default preview column (172 when present).

Outputs (under output/shots/<shot>/):
  - selected_channels_index.json — maps preview_col → NPZ filenames
  - selected_channel_p<col>_{signal,spectrogram,bandpass_score}.npz per exported column
  - selected_channel_bundle.json — metadata for default preview column
  - selected_channel_{signal,spectrogram,bandpass_score}.npz — copy of default column (backward compatible)
  - Both whales shots: signal NPZs include bandpass_waveform for browser DAS demo playback.
  - Source-vs-DAS reference WAV + JSON (time-aligned to DAS preprocessing window):
    Orca → `orca_source_segment.wav` + `orca_audio_compare.json` + `files.orca_audio_compare`;
    Humpback → `humpback_source_segment.wav` + `humpback_audio_compare.json` + `files.source_audio_compare`.

Patches viewer_manifest.json with `files.selected_channels_index`, `selected_channel_demo` (v2 when >1 col),
and the shot-appropriate audio compare key above.

Usage:
  python3 src/build_selected_channel_bundle.py --shot whales_orca
  python3 src/build_selected_channel_bundle.py --shot whales_orca --preview-cols 189,12,50
  python3 src/build_selected_channel_bundle.py --shot whales_orca --preview-col 189 --band 2000-2350
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

import h5py
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, hilbert, spectrogram, sosfiltfilt

from _repo_paths import REPO_ROOT, resolve_shot_h5

ORCA_SUBDIR = "2022-01-26--04--Whales"
ORCA_FILE = "2022-01-26--04-47-42--Orca.h5"
HUMPBACK_SUBDIR = "2022-01-26--04--Whales"
HUMPBACK_FILE = "2022-01-26--04-46-16--Humpback.h5"

SHOT_SPECS: dict[str, tuple[str, str]] = {
    "whales_orca": (ORCA_SUBDIR, ORCA_FILE),
    "whales_humpback": (HUMPBACK_SUBDIR, HUMPBACK_FILE),
}

# Stage 2 Orca: small fixed set of recommended preview columns (native preview grid indices).
ORCA_STAGE2_PREVIEW_COLS: list[int] = [189, 12, 50]
ORCA_STAGE2_DEFAULT_PREVIEW_COL = 172
ORCA_STAGE2_EXTRA_PREVIEW_COLS: list[int] = [26, 146]
# Raw DAS indices → nearest exportable preview column (see docs/orca_ncc_summary.md).
# Zone ~854–868: 859–862 (860 already typical default via col 172; include neighbors for distinct grids).
# Zone ~908–925: 920 (NCC rank-6 peak; second hotspot representative).
# 861 retained (supervisor / nearest-preview test). Order: resolve in list order; duplicate preview cols skipped.
ORCA_STAGE2_RAW_RESOLVE_TARGETS: list[int] = [859, 861, 862, 920]
HUMPBACK_STAGE2_MAX_CHANNELS = 3
HUMPBACK_STAGE2_MIN_COL_GAP = 20
HUMPBACK_STAGE2_EXTRA_PREVIEW_COLS: list[int] = [20, 154]


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


def _choose_humpback_default_preview_col(shot_dir: Path) -> int:
    """
    Choose one practical Humpback default preview column from event-overlap DAS activity.
    Score = mean(activity during event windows) - mean(activity outside event windows).
    """
    events_p = shot_dir / "events.json"
    act_p = shot_dir / "das_activity_map.npz"
    if not events_p.is_file() or not act_p.is_file():
        return 118
    try:
        with open(events_p, encoding="utf-8") as f:
            events_doc = json.load(f)
        events = events_doc.get("events", [])
        z = np.load(act_p)
        a = np.asarray(z["activity_map"], dtype=np.float64)  # [time, channel]
        t = np.asarray(z["t_windows_s"], dtype=np.float64)
        if a.ndim != 2 or t.ndim != 1 or a.shape[0] != t.shape[0]:
            return [118]
        mask = np.zeros_like(t, dtype=bool)
        for ev in events:
            t0 = float(ev.get("start_time_s"))
            t1 = float(ev.get("end_time_s"))
            if np.isfinite(t0) and np.isfinite(t1) and t1 >= t0:
                mask |= (t >= t0) & (t <= t1)
        if not np.any(mask) or np.all(mask):
            return [118]

        mean_in = a[mask].mean(axis=0)
        mean_out = a[~mask].mean(axis=0)
        contrast = mean_in - mean_out
        combined = contrast + 0.35 * mean_in
        order = np.argsort(combined)[::-1]

        selected: list[int] = []
        for i in order:
            col = int(i)
            if all(abs(col - s) >= HUMPBACK_STAGE2_MIN_COL_GAP for s in selected):
                selected.append(col)
            if len(selected) >= HUMPBACK_STAGE2_MAX_CHANNELS:
                break

        if not selected:
            return [118]
        # Keep previous default (118) if still competitive and selected.
        if 118 in selected:
            selected = [118] + [c for c in selected if c != 118]
        return selected
    except Exception:
        return [118]
    try:
        with open(events_p, encoding="utf-8") as f:
            events_doc = json.load(f)
        events = events_doc.get("events", [])
        z = np.load(act_p)
        a = np.asarray(z["activity_map"], dtype=np.float64)  # [time, channel]
        t = np.asarray(z["t_windows_s"], dtype=np.float64)
        if a.ndim != 2 or t.ndim != 1 or a.shape[0] != t.shape[0]:
            return 118
        mask = np.zeros_like(t, dtype=bool)
        for ev in events:
            t0 = float(ev.get("start_time_s"))
            t1 = float(ev.get("end_time_s"))
            if np.isfinite(t0) and np.isfinite(t1) and t1 >= t0:
                mask |= (t >= t0) & (t <= t1)
        if not np.any(mask) or np.all(mask):
            return 118
        mean_in = a[mask].mean(axis=0)
        mean_out = a[~mask].mean(axis=0)
        score = mean_in - mean_out
        best = int(np.argmax(score))
        if 0 <= best < a.shape[1]:
            return best
        return 118
    except Exception:
        return 118


def _rank_humpback_preview_cols(shot_dir: Path) -> list[int]:
    """
    Return a ranked small set of Humpback preview columns using event-aware DAS activity.
    Priority score combines event contrast and in-event absolute activity:
      score = (mean_in - mean_out) + 0.35 * mean_in
    Then enforce diversity with a minimum preview-column gap.
    """
    events_p = shot_dir / "events.json"
    act_p = shot_dir / "das_activity_map.npz"
    if not events_p.is_file() or not act_p.is_file():
        return [118]
    try:
        with open(events_p, encoding="utf-8") as f:
            events_doc = json.load(f)
        events = events_doc.get("events", [])
        z = np.load(act_p)
        a = np.asarray(z["activity_map"], dtype=np.float64)  # [time, channel]
        t = np.asarray(z["t_windows_s"], dtype=np.float64)
        if a.ndim != 2 or t.ndim != 1 or a.shape[0] != t.shape[0]:
            return [118]
        mask = np.zeros_like(t, dtype=bool)
        for ev in events:
            t0 = float(ev.get("start_time_s"))
            t1 = float(ev.get("end_time_s"))
            if np.isfinite(t0) and np.isfinite(t1) and t1 >= t0:
                mask |= (t >= t0) & (t <= t1)
        if not np.any(mask) or np.all(mask):
            return [118]

        mean_in = a[mask].mean(axis=0)
        mean_out = a[~mask].mean(axis=0)
        contrast = mean_in - mean_out
        combined = contrast + 0.35 * mean_in
        order = np.argsort(combined)[::-1]

        selected: list[int] = []
        for i in order:
            col = int(i)
            if all(abs(col - s) >= HUMPBACK_STAGE2_MIN_COL_GAP for s in selected):
                selected.append(col)
            if len(selected) >= HUMPBACK_STAGE2_MAX_CHANNELS:
                break

        if not selected:
            return [118]
        # Keep previous default (118) if still competitive and selected.
        if 118 in selected:
            selected = [118] + [c for c in selected if c != 118]
        return selected
    except Exception:
        return [118]


def _preview_col_for_raw_channel(channel_indices: np.ndarray, raw: int) -> int:
    """Preview grid index (position in channel_indices) for exact raw match or nearest neighbor."""
    if channel_indices.ndim != 1 or channel_indices.size == 0:
        return 0
    idx_exact = np.where(channel_indices == int(raw))[0]
    if idx_exact.size > 0:
        return int(idx_exact[0])
    return int(np.argmin(np.abs(channel_indices - int(raw))))


def _orca_raw_targets_as_preview_pairs(
    channel_indices: np.ndarray, raw_targets: list[int]
) -> list[tuple[int, int]]:
    """(requested_raw, preview_col) per target. Preview col may repeat; caller skips duplicate columns."""
    return [(int(r), _preview_col_for_raw_channel(channel_indices, int(r))) for r in raw_targets]


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
    index_name: str | None = None,
    available_preview_cols: list[int] | None = None,
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
    if index_name:
        files["selected_channels_index"] = index_name

    cols = list(available_preview_cols) if available_preview_cols else [preview_col]
    stage2 = len(cols) > 1
    demo: dict[str, Any] = {
        "schema_version": "selected_channel_demo_v2" if stage2 else "selected_channel_demo_v1",
        "shot_id": shot_id,
        "preview_column": preview_col,
        "raw_das_channel_index": raw_ch,
        "recommended_band_hz": band,
        "bundle_metadata_file": _shot_rel(shot_dir, shot_dir / bundle_name),
        "notes": (
            "Selected-channel native-rate NPZ export(s) for this shot. "
            "Band-pass score is DAS support only, not whale probability. "
            "Does not replace the DAS activity map."
        ),
    }
    if stage2:
        demo["stage"] = 2
        demo["default_preview_col"] = preview_col
        demo["available_preview_cols"] = cols
        if index_name:
            demo["index_file"] = index_name
    manifest["selected_channel_demo"] = demo
    manifest["selected_channel_mode_available"] = True

    notes = manifest.setdefault("notes", [])
    tag = "selected_channel_demo: compact NPZ bundle avoids HDF5 at frontend load time."
    if isinstance(notes, list) and tag not in notes:
        notes.append(tag)

    with open(man_p, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


def _patch_manifest_audio_compare(
    shot_dir: Path, compare_json_name: str, manifest_key: str, note_tag: str
) -> None:
    """Register audio compare JSON in viewer_manifest.files if manifest exists."""
    man_p = shot_dir / "viewer_manifest.json"
    if not man_p.is_file():
        return
    with open(man_p, encoding="utf-8") as f:
        manifest: dict[str, Any] = json.load(f)
    files = manifest.setdefault("files", {})
    files[manifest_key] = compare_json_name
    notes = manifest.setdefault("notes", [])
    if isinstance(notes, list) and note_tag not in notes:
        notes.append(note_tag)
    with open(man_p, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


def _write_source_playback_wav_trim_leading_silence(
    seg_i16: np.ndarray,
    fs_src: int,
    wav_path_playback: Path,
    *,
    peak_fraction: float = 0.01,
    pre_roll_s: float = 0.1,
) -> dict[str, Any] | None:
    """
    Write a playback-only copy with leading silence removed (in-file zeros / quiet run-in).
    Original aligned segment must stay untouched elsewhere.

    Onset: first sample where |x| >= peak_fraction * max(|x|). Pre-roll keeps pre_roll_s
    of audio before that onset when possible.

    Returns trim metadata dict for JSON, or None if no separate playback file was written.
    """
    x = np.abs(seg_i16.astype(np.float64))
    peak = float(np.max(x))
    if peak <= 0:
        return None
    thr = peak_fraction * peak
    above = x >= thr
    if not np.any(above):
        return None
    onset = int(np.argmax(above))
    preroll = max(0, int(round(float(pre_roll_s) * fs_src)))
    start = max(0, onset - preroll)
    if start <= 0:
        return None
    trimmed = seg_i16[start:]
    wavfile.write(str(wav_path_playback), int(round(fs_src)), trimmed)
    return {
        "pre_roll_s": float(pre_roll_s),
        "peak_fraction_threshold": float(peak_fraction),
        "onset_sample_in_full_segment": int(onset),
        "playback_starts_at_sample": int(start),
        "removed_leading_s": float(start) / float(fs_src),
        "playback_wav_samples": int(trimmed.shape[0]),
    }


def export_source_compare_audio(shot_dir: Path, h5_path: Path, shot_id: str) -> None:
    """
    Write source reference WAV + *audio_compare.json for source-vs-DAS demo playback.
    Segment uses das_preprocessing_metadata selected_interval start_time_s/end_time_s (DAS-relative seconds).
    Schema remains orca_audio_compare_v1 for frontend compatibility; shot_id distinguishes shots.
    """
    meta_p = shot_dir / "das_preprocessing_metadata.json"
    if not meta_p.is_file() or not h5_path.is_file():
        return
    with open(meta_p, encoding="utf-8") as f:
        meta = json.load(f)
    sel = meta.get("selected_interval") or {}
    t0 = float(sel.get("start_time_s", 0.0))
    t1 = float(sel.get("end_time_s", t0 + 1.0))
    if t1 <= t0:
        return

    with h5py.File(h5_path, "r") as f:
        if "Source" not in f:
            return
        src_ds = f["Source"]
        src_full = np.asarray(src_ds[:], dtype=np.float64).ravel()
        a = dict(src_ds.attrs)
        fs_src = float(a.get("Sample Rate (Hz)", 50000.0))

    i0 = max(0, int(np.floor(t0 * fs_src)))
    i1 = min(int(src_full.shape[0]), int(np.ceil(t1 * fs_src)))
    if i1 <= i0:
        return
    seg = src_full[i0:i1]
    peak = float(np.max(np.abs(seg))) + 1e-12
    seg_i16 = np.clip(seg / peak * 0.95 * 32767.0, -32768, 32767).astype(np.int16)

    if shot_id == "whales_orca":
        wav_name = "orca_source_segment.wav"
        wav_playback_name = "orca_source_segment_playback.wav"
        json_name = "orca_audio_compare.json"
        manifest_key = "orca_audio_compare"
        note_tag = "orca_audio_compare: source WAV segment time-aligned to DAS preprocessing window (demo only)."
        interpretation = (
            "Source: dataset 'Sound pressure @1m' reference. DAS: band-limited, received strain-related "
            "channel (demo playback). Compare for distortion/sparsity illustration, not validated bioacoustic truth."
        )
    elif shot_id == "whales_humpback":
        wav_name = "humpback_source_segment.wav"
        wav_playback_name = "humpback_source_segment_playback.wav"
        json_name = "humpback_audio_compare.json"
        manifest_key = "source_audio_compare"
        note_tag = (
            "source_audio_compare: Humpback source WAV segment time-aligned to DAS preprocessing window (demo only)."
        )
        interpretation = (
            "Source: dataset 'Sound pressure @1m' reference. DAS: band-limited, received strain-related "
            "channel (demo playback). Humpback DAS is often weaker and noisier than Orca on selected channels—"
            "compare for structure and sparsity only, not validated bioacoustic truth."
        )
    else:
        return

    wav_path = shot_dir / wav_name
    wavfile.write(str(wav_path), int(round(fs_src)), seg_i16)

    doc: dict[str, Any] = {
        "schema_version": "orca_audio_compare_v1",
        "shot_id": shot_id,
        "source_wav_file": wav_path.name,
        "source_sample_rate_hz": int(round(fs_src)),
        "time_range_s_das_axis": [t0, t1],
        "alignment_note": (
            "Indices floor(t0×fs_source):ceil(t1×fs_source) using DAS preprocessing start_time_s/end_time_s "
            "(seconds from DAS trace origin in export). Experimental reference only."
        ),
        "interpretation": interpretation,
    }

    playback_path = shot_dir / wav_playback_name
    trim_meta = _write_source_playback_wav_trim_leading_silence(
        seg_i16, int(round(fs_src)), playback_path
    )
    if trim_meta is not None:
        doc["source_wav_playback_file"] = playback_path.name
        doc["source_playback_trim"] = trim_meta
        doc["source_playback_note"] = (
            "source_wav_playback_file is for browser convenience only: leading silence removed "
            "(first sample reaching >= peak_fraction_threshold × max|sample|), with pre_roll_s kept before onset. "
            "source_wav_file remains the full DAS-interval-aligned segment for any comparison that needs exact alignment."
        )
    json_path = shot_dir / json_name
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
    _patch_manifest_audio_compare(shot_dir, json_path.name, manifest_key, note_tag)


def _parse_band(s: str) -> tuple[float, float]:
    a, b = s.split("-", 1)
    return float(a), float(b)


def _export_preview_column_npzs(
    *,
    shot_dir: Path,
    shot_id: str,
    preview_col: int,
    f_lo: float,
    f_hi: float,
    args: argparse.Namespace,
    start_idx: int,
    end_idx: int,
    channel_indices: np.ndarray,
    distances_m: np.ndarray,
    h5_path: Path,
    ev_p: Path,
    hydro_npz_p: Path,
    hydro_meta_p: Path | None,
    shot_meta_p: Path | None,
    npz_stem: str,
) -> dict[str, Any]:
    """Write signal / spectrogram / band-pass NPZs for one preview column; return bundle JSON dict."""
    if preview_col < 0 or preview_col >= len(channel_indices):
        raise SystemExit(f"preview_col {preview_col} out of range [0, {len(channel_indices)})")
    raw_ch = int(channel_indices[preview_col])
    dist_m = float(distances_m[preview_col])

    with h5py.File(h5_path, "r") as f:
        das = f["DAS"]
        attrs = dict(das.attrs)
        fs_hz = float(attrs.get("OutputDataRate", 5000.0))
        amp_scaling = float(attrs.get("AmpScaling", 1.0))
        raw = das[start_idx:end_idx, raw_ch].astype(np.float64).ravel() * amp_scaling
    signal = (raw - np.median(raw)).astype(np.float32)
    n = signal.shape[0]
    t_native = (start_idx / fs_hz + np.arange(n, dtype=np.float64) / fs_hz).astype(np.float32)

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

    sos = _band_sos(fs_hz, f_lo, f_hi)
    filtered = sosfiltfilt(sos, raw)
    envelope = np.abs(hilbert(filtered))
    win = max(3, int(round(args.envelope_rms_ms * 1e-3 * fs_hz)))
    bandpass_support_score = _rolling_rms_1d(envelope, win).astype(np.float32)
    thr = float(_mad_threshold(bandpass_support_score.astype(np.float64), args.mad_k))
    signal_present_mask = (bandpass_support_score > thr).astype(np.uint8)

    sig_path = shot_dir / f"{npz_stem}_signal.npz"
    spec_path = shot_dir / f"{npz_stem}_spectrogram.npz"
    bp_path = shot_dir / f"{npz_stem}_bandpass_score.npz"

    sig_payload: dict[str, Any] = {
        "t_s": t_native,
        "signal": signal,
        "signal_type": np.array("median_centered_native_amplitude"),
        "channel_index": np.int32(raw_ch),
        "preview_col": np.int32(preview_col),
        "distance_m": np.float32(dist_m),
        "fs_hz": np.float32(fs_hz),
    }
    # Whales: band-pass waveform (same band as score) for browser demo playback — not "whale in water".
    bp_wf = (filtered - np.median(filtered)).astype(np.float32)
    sig_payload["bandpass_waveform"] = bp_wf
    sig_payload["bandpass_waveform_hz"] = np.array([f_lo, f_hi], dtype=np.float32)
    sig_payload["bandpass_waveform_note"] = np.array(
        "median_centered_bandpass_for_demo_playback; received_DAS_not_acoustic_pressure"
    )
    np.savez_compressed(sig_path, **sig_payload)
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
    if shot_meta_p and shot_meta_p.is_file():
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
    shot_label = "Orca" if shot_id == "whales_orca" else "Humpback"
    bundle: dict[str, Any] = {
        "schema_version": "selected_channel_bundle_v1",
        "shot_id": shot_id,
        "selected_preview_col": preview_col,
        "selected_raw_channel": raw_ch,
        "selected_distance_m": dist_m,
        "selected_channel_label": (
            f"{shot_label} DAS raw ch {raw_ch} (preview col {preview_col}, ~{dist_m:.1f} m along cable)"
        ),
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
            "notes": "Covers full Nyquist; the recommended support band for this shot is within this grid.",
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
        if hydro_meta_p and hydro_meta_p.is_file()
        else None,
        "source_ground_truth": source_gt,
        "bundle_files": {
            "metadata": "selected_channel_bundle.json",
            "signal_npz": _shot_rel(shot_dir, sig_path),
            "spectrogram_npz": _shot_rel(shot_dir, spec_path),
            "bandpass_score_npz": _shot_rel(shot_dir, bp_path),
        },
        "repo_relative_paths": {
            "shot_dir": _repo_rel(shot_dir),
        },
        "notes": [
            "Per-preview-column NPZ bundle for selected-channel viewer (no HDF5 in browser).",
            "DAS activity map and hydrophone pipeline outputs remain the primary synchronized layers.",
            "Band-pass score is optional DAS-side support for selected-channel view only.",
        ],
    }
    return bundle


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Build selected-channel NPZ bundle for viewer demo")
    ap.add_argument("--shot", default="whales_orca", choices=("whales_orca", "whales_humpback"))
    ap.add_argument("--shot-dir", type=Path, default=None)
    ap.add_argument(
        "--preview-col",
        type=int,
        default=-1,
        help="Export only this preview column (-1: use --preview-cols or Stage-2 default set)",
    )
    ap.add_argument(
        "--preview-cols",
        type=str,
        default="",
        help=(
            "Comma-separated preview columns. "
            "Default when unset: Orca=189,12,50; Humpback=ranked event-aware top set."
        ),
    )
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
    orca_extra_target_cols: list[int] = []
    orca_requested_raw_by_col: dict[int, int] = {}
    if shot_id == "whales_humpback":
        pre_meta_band_lo, pre_meta_band_hi = 15.0, 1200.0
        pre_meta_p_probe = shot_dir / "das_preprocessing_metadata.json"
        if pre_meta_p_probe.is_file():
            try:
                with open(pre_meta_p_probe, encoding="utf-8") as f:
                    pre_meta_probe = json.load(f)
                filt = pre_meta_probe.get("filter", {}) or {}
                if np.isfinite(float(filt.get("fmin_hz", pre_meta_band_lo))):
                    pre_meta_band_lo = float(filt.get("fmin_hz", pre_meta_band_lo))
                if np.isfinite(float(filt.get("fmax_hz", pre_meta_band_hi))):
                    pre_meta_band_hi = float(filt.get("fmax_hz", pre_meta_band_hi))
            except Exception:
                pass
        if args.band.strip():
            f_lo, f_hi = _parse_band(args.band.strip())
        else:
            f_lo, f_hi = pre_meta_band_lo, pre_meta_band_hi
        if int(args.preview_col) >= 0:
            preview_cols = [int(args.preview_col)]
        elif args.preview_cols.strip():
            preview_cols = [int(x.strip()) for x in args.preview_cols.split(",") if x.strip()]
        else:
            preview_cols = _rank_humpback_preview_cols(shot_dir)
            for c in HUMPBACK_STAGE2_EXTRA_PREVIEW_COLS:
                if c not in preview_cols:
                    preview_cols.append(c)
        # Stage-1 continuity: keep 118 as default when present.
        default_preview_col = 118 if 118 in preview_cols else int(preview_cols[0])
    else:
        if args.band.strip():
            f_lo, f_hi = _parse_band(args.band.strip())
        else:
            f_lo, f_hi = def_lo, def_hi
        if int(args.preview_col) >= 0:
            preview_cols = [int(args.preview_col)]
        elif args.preview_cols.strip():
            preview_cols = [int(x.strip()) for x in args.preview_cols.split(",") if x.strip()]
        else:
            preview_cols = list(ORCA_STAGE2_PREVIEW_COLS)
            for c in ORCA_STAGE2_EXTRA_PREVIEW_COLS:
                if c not in preview_cols:
                    preview_cols.append(c)
            # NCC / supervisor raw anchors → nearest preview columns (see ORCA_STAGE2_RAW_RESOLVE_TARGETS).
            orca_extra_target_cols = list(ORCA_STAGE2_RAW_RESOLVE_TARGETS)
        if ORCA_STAGE2_DEFAULT_PREVIEW_COL in preview_cols:
            default_preview_col = ORCA_STAGE2_DEFAULT_PREVIEW_COL
        elif def_col in preview_cols:
            default_preview_col = def_col
        else:
            default_preview_col = int(preview_cols[0])

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
    if shot_id == "whales_orca" and orca_extra_target_cols:
        pairs = _orca_raw_targets_as_preview_pairs(channel_indices, orca_extra_target_cols)
        for raw_target, c in pairs:
            orca_requested_raw_by_col[int(c)] = int(raw_target)
            if c not in preview_cols:
                preview_cols.append(c)
    # Re-evaluate default after any auto-mapped additions (e.g. Orca raw-861 nearest preview).
    if shot_id == "whales_orca":
        if ORCA_STAGE2_DEFAULT_PREVIEW_COL in preview_cols:
            default_preview_col = ORCA_STAGE2_DEFAULT_PREVIEW_COL
        elif def_col in preview_cols:
            default_preview_col = def_col
        else:
            default_preview_col = int(preview_cols[0])

    subdir, fname = SHOT_SPECS[shot_id]
    h5_path = resolve_shot_h5(subdir, fname)
    if not h5_path.is_file():
        raise SystemExit(f"Missing HDF5 for export: {h5_path}")

    index_channels: list[dict[str, Any]] = []
    bundle_for_default: dict[str, Any] | None = None
    raw_ch_default = 0
    last_sxx_shape: tuple[int, ...] = ()
    last_n = 0
    last_fs = 5000.0

    for pc in preview_cols:
        stem = f"selected_channel_p{pc}"
        bundle = _export_preview_column_npzs(
            shot_dir=shot_dir,
            shot_id=shot_id,
            preview_col=int(pc),
            f_lo=f_lo,
            f_hi=f_hi,
            args=args,
            start_idx=start_idx,
            end_idx=end_idx,
            channel_indices=channel_indices,
            distances_m=distances_m,
            h5_path=h5_path,
            ev_p=ev_p,
            hydro_npz_p=hydro_npz_p,
            hydro_meta_p=hydro_meta_p if hydro_meta_p.is_file() else None,
            shot_meta_p=shot_meta_p,
            npz_stem=stem,
        )
        sig_name = f"{stem}_signal.npz"
        index_channels.append(
            {
                "preview_col": int(pc),
                "raw_das_channel_index": int(bundle["selected_raw_channel"]),
                "distance_m": float(bundle["selected_distance_m"]),
                "label": (
                    f"{bundle['selected_channel_label']} (nearest preview export to requested raw ch {orca_requested_raw_by_col[int(pc)]})"
                    if int(pc) in orca_requested_raw_by_col and int(bundle["selected_raw_channel"]) != int(orca_requested_raw_by_col[int(pc)])
                    else str(bundle["selected_channel_label"])
                ),
                "files": {
                    "signal": sig_name,
                    "spectrogram": f"{stem}_spectrogram.npz",
                    "bandpass_score": f"{stem}_bandpass_score.npz",
                },
            }
        )
        if int(pc) == default_preview_col:
            bundle_for_default = bundle
            raw_ch_default = int(bundle["selected_raw_channel"])
            # legacy filenames (default channel = 189 typically)
            shutil.copyfile(shot_dir / sig_name, shot_dir / "selected_channel_signal.npz")
            shutil.copyfile(shot_dir / f"{stem}_spectrogram.npz", shot_dir / "selected_channel_spectrogram.npz")
            shutil.copyfile(shot_dir / f"{stem}_bandpass_score.npz", shot_dir / "selected_channel_bandpass_score.npz")
            last_n = int(np.load(shot_dir / sig_name)["t_s"].shape[0])
            last_fs = float(bundle["sampling_rate_hz"])
            spec_f = shot_dir / f"{stem}_spectrogram.npz"
            if spec_f.is_file():
                last_sxx_shape = tuple(np.load(spec_f)["Sxx_db"].shape)

    if bundle_for_default is None:
        raise SystemExit(f"default_preview_col {default_preview_col} not in exported columns {preview_cols}")

    bundle_for_default["bundle_files"] = {
        "metadata": "selected_channel_bundle.json",
        "signal_npz": "selected_channel_signal.npz",
        "spectrogram_npz": "selected_channel_spectrogram.npz",
        "bandpass_score_npz": "selected_channel_bandpass_score.npz",
    }
    bundle_path = shot_dir / "selected_channel_bundle.json"
    with open(bundle_path, "w", encoding="utf-8") as f:
        json.dump(bundle_for_default, f, indent=2, ensure_ascii=False)

    index_path: Path | None = None
    if len(preview_cols) > 1:
        index_doc: dict[str, Any] = {
            "schema_version": "selected_channels_index_v1",
            "shot_id": shot_id,
            "default_preview_col": default_preview_col,
            "recommended_bandpass_hz": [f_lo, f_hi],
            "channels": index_channels,
            "notes": [
                "Maps preview_column to per-channel NPZ triples for selected-channel Stage-2 viewer.",
                "Legacy filenames selected_channel_*.npz duplicate the default_preview_col exports.",
                "Both whales shots export bandpass_waveform for DAS demo audio; source WAV/JSON uses files.orca_audio_compare (Orca) or files.source_audio_compare (Humpback).",
                "Orca-only: NCC-guided raw resolve targets (859, 861, 862, 920) → nearest preview grid; see docs/orca_ncc_summary.md.",
            ],
        }
        index_path = shot_dir / "selected_channels_index.json"
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(index_doc, f, indent=2, ensure_ascii=False)

    if not args.no_patch_manifest:
        _patch_viewer_manifest(
            shot_dir,
            bundle_name=bundle_path.name,
            shot_id=shot_id,
            preview_col=default_preview_col,
            raw_ch=raw_ch_default,
            band=[f_lo, f_hi],
            index_name=index_path.name if index_path else None,
            available_preview_cols=list(preview_cols),
        )

    export_source_compare_audio(shot_dir, h5_path, shot_id)

    print(f"Exported preview columns: {preview_cols} (default={default_preview_col}) band={f_lo}-{f_hi} Hz")
    if index_path is not None:
        print(f"Saved {index_path.name} ({len(index_channels)} channels)")
    print(f"Saved {bundle_path.name}")
    print(f"Legacy selected_channel_*.npz aligned to preview_col={default_preview_col}")
    if last_sxx_shape:
        print(f"Last spectrogram Sxx_db shape {last_sxx_shape}, ~{last_n} samples @ {last_fs} Hz")
    if not args.no_patch_manifest:
        print("Patched viewer_manifest.json (selected-channel demo + file references)")


if __name__ == "__main__":
    main()
