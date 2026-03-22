"""
DASLakeZurich — MVP Ingest/Export Prototype
Reads one shot .h5 file and exports JSON-friendly summaries.

Usage (from repository root):
    python3 src/ingest_prototype.py <shot.h5> [output_dir]
    python3 src/ingest_prototype.py <shot.h5> [output_dir] --situation <Situation.h5>

Output files:
    shot_metadata.json     — shot-level info (attrs, run, recorder availability)
    das_preview.json       — downsampled DAS data (every N-th sample, subset of channels)
    recorders_summary.json — hydrophone recorder metadata + RMS amplitudes
    spectrogram.json       — STFT per recorder channel (fmin/fmax configurable)
    waveform.json          — decimated time-domain waveform per recorder channel
    situation.json         — bathymetry grid + fiber track from Situation.h5
"""

import sys
import json
import pathlib
import datetime

import h5py
import numpy as np
from scipy.signal import stft as scipy_stft, decimate


# ── helpers ──────────────────────────────────────────────────────────────────

def attrs_to_dict(attrs):
    """Convert h5py attrs to plain Python dict (handles bytes, numpy scalars)."""
    out = {}
    for k, v in attrs.items():
        if isinstance(v, bytes):
            v = v.decode()
        elif isinstance(v, np.generic):
            v = v.item()
        elif isinstance(v, np.ndarray):
            v = v.tolist()
        out[k] = v
    return out


def walk_structure(h5obj, indent=0):
    """Print HDF5 tree: groups, datasets, shapes, dtypes, attrs."""
    prefix = "  " * indent
    for key in h5obj.keys():
        item = h5obj[key]
        if isinstance(item, h5py.Dataset):
            print(f"{prefix}[dataset] {key}  shape={item.shape}  dtype={item.dtype}")
            for ak, av in item.attrs.items():
                av_repr = av.decode() if isinstance(av, bytes) else av
                print(f"{prefix}          .{ak} = {av_repr!r}")
        elif isinstance(item, h5py.Group):
            print(f"{prefix}[group]   {key}/")
            walk_structure(item, indent + 1)


def safe_json(obj):
    """Recursively make obj JSON-serialisable."""
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, bytes):
        return obj.decode()
    if isinstance(obj, dict):
        return {k: safe_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [safe_json(v) for v in obj]
    return obj


def write_json(path, data):
    with open(path, "w") as f:
        json.dump(safe_json(data), f, indent=2, ensure_ascii=False)
    print(f"  → saved {path}")


# ── main sections ─────────────────────────────────────────────────────────────

def extract_shot_metadata(f: h5py.File, h5_path: pathlib.Path) -> dict:
    """
    Build shot_metadata: top-level attrs + per-group presence flags.
    """
    meta = {
        "file": h5_path.name,
        "file_size_mb": round(h5_path.stat().st_size / 1e6, 2),
        "top_level_attrs": attrs_to_dict(f.attrs),
        "groups_present": list(f.keys()),
        "recorders_available": [],
        "has_das": "DAS" in f,
        "has_source": "Source" in f,
    }

    # Which recorders are in this shot?
    for r in ("Recorder-A", "Recorder-B", "Recorder-C"):
        if r in f:
            meta["recorders_available"].append(r)

    # DAS quick summary
    if "DAS" in f:
        das = f["DAS"]
        a = attrs_to_dict(das.attrs)
        meta["das"] = {
            "shape_npts_x_nchan": list(das.shape),
            "dtype": str(das.dtype),
            "fs_hz": a.get("OutputDataRate"),
            "gauge_length_m": a.get("GaugeLength"),
            "spatial_resolution_m": a.get("SpatialResolution"),
            "start_distance_m": a.get("StartDistance"),
            "stop_distance_m": a.get("StopDistance"),
            "unit": a.get("Unit"),
            "amp_scaling": a.get("AmpScaling"),
            "part_start_time": a.get("PartStartTime"),
            "part_end_time": a.get("PartEndTime"),
            "n_channels": das.shape[1] if das.ndim == 2 else None,
            "n_samples": das.shape[0] if das.ndim >= 1 else None,
        }

    # Source quick summary
    if "Source" in f:
        src = f["Source"]
        a = attrs_to_dict(src.attrs)
        meta["source"] = {
            "shape": list(src.shape),
            "dtype": str(src.dtype),
            "fs_hz": a.get("Sample Rate (Hz)"),
            "duration_s": a.get("Duration (s)"),
            "depth_m": a.get("Source Depth (m)"),
            "pos_x_m": a.get("Position X (m)"),
            "pos_y_m": a.get("Position Y (m)"),
            "start_time": a.get("Start Time"),
            "signal_description": a.get("Signal"),
        }

    return meta


def extract_das_preview(f: h5py.File,
                         channel_step: int = 50,
                         time_downsample: int = 20,
                         max_channels: int = 20) -> dict:
    """
    Downsampled DAS preview for frontend waterfall/heatmap.

    channel_step    : pick every Nth channel along the fiber
    time_downsample : keep every Nth time sample (decimation)
    max_channels    : cap on number of output channels

    Returns a dict ready to JSON-dump with:
      - t_s        : time axis [seconds]
      - channels   : channel indices selected
      - distances_m: fiber distance for each channel
      - data       : 2D list [n_time, n_chan] in (nm/m)/s (float32 → float)
    """
    if "DAS" not in f:
        return {"error": "DAS group not found"}

    das = f["DAS"]
    a = attrs_to_dict(das.attrs)

    fs = float(a.get("OutputDataRate", 5000))
    amp = float(a.get("AmpScaling", 1.0))
    start_dist = float(a.get("StartDistance", 0.0))
    spatial_res = float(a.get("SpatialResolution", 1.0))

    npts, nchan = das.shape

    # Channel selection
    chan_indices = list(range(0, nchan, channel_step))[:max_channels]

    # Read only selected channels (h5py allows fancy indexing)
    raw = das[:, chan_indices]          # shape: (npts, n_selected)
    raw = raw.astype(np.float32) * amp  # convert ADC counts → (nm/m)/s

    # Time decimation
    raw_ds = raw[::time_downsample, :]   # shape: (npts//ds, n_selected)

    # Time axis
    t = np.arange(raw_ds.shape[0]) * (time_downsample / fs)

    # Distance axis (fiber distance for each selected channel)
    distances = [start_dist + i * spatial_res for i in chan_indices]

    return {
        "description": "Downsampled DAS preview for frontend heatmap/waterfall",
        "unit": "(nm/m)/s",
        "fs_original_hz": fs,
        "time_downsample_factor": time_downsample,
        "channel_step": channel_step,
        "n_time": raw_ds.shape[0],
        "n_channels": raw_ds.shape[1],
        "t_s": t.tolist(),
        "channels": chan_indices,
        "distances_m": distances,
        "data": raw_ds.tolist(),   # [n_time][n_chan]
    }


def extract_spectrogram(f: h5py.File,
                         fmin: float = 10.0,
                         fmax: float = 5000.0,
                         target_fs: float = 10000.0,
                         nperseg: int = 1024,
                         noverlap: int = 0,
                         preview_channel: str = "Tetra-Top") -> dict:
    """
    STFT spectrogram for each hydrophone recorder — one preview channel.

    Size strategy (keeps JSON ≲ 2 MB per recorder):
      1. Decimate 50 kHz → 10 kHz before STFT (5× fewer samples).
      2. nperseg=1024, noverlap=0 → ~400 non-overlapping frames for 41 s.
         Time resolution ≈ 0.1 s — sufficient for whale call visualization.
      3. Export only preview_channel (Tetra-Top) — all 4 RMS values are in
         recorders_summary.json; extra channels can be added on demand.
      4. Round dB values to 1 decimal place.

    Output per recorder:
      - freqs_hz : frequency axis trimmed to fmin–fmax
      - t_s      : time axis
      - Sxx_db   : PSD [n_freq × n_time] in dB re 1 Pa²/Hz
    """
    recorder_names = [k for k in f.keys() if k.startswith("Recorder-")]
    result = {}

    for name in recorder_names:
        rec = f[name]
        a = attrs_to_dict(rec.attrs)
        fs_orig = float(a.get("Sample Rate (Hz)", 50000))

        data = rec[:].astype(np.float32)  # (npts, 4)
        channel_labels = ["Tetra-Top", "Tetra-A", "Tetra-B", "Tetra-C"]

        # Pick preview channel index
        ch_idx = channel_labels.index(preview_channel) \
                 if preview_channel in channel_labels else 0
        ch_name = channel_labels[ch_idx]
        sig = data[:, ch_idx]

        # Anti-aliased decimation
        dec_factor = max(1, int(fs_orig / target_fs))
        fs_dec = fs_orig / dec_factor
        if dec_factor > 1:
            sig = decimate(sig, dec_factor, ftype="iir", zero_phase=True)

        freqs, t, Zxx = scipy_stft(sig, fs=fs_dec, nperseg=nperseg, noverlap=noverlap)

        # Trim to fmin–fmax
        freq_mask = (freqs >= fmin) & (freqs <= fmax)
        freqs_trim = freqs[freq_mask]
        Zxx_trim = Zxx[freq_mask, :]

        # PSD in dB, rounded to 1 decimal to keep JSON compact
        psd = np.abs(Zxx_trim) ** 2 / (fs_dec / nperseg)
        psd_db = np.round(10 * np.log10(np.maximum(psd, 1e-20)), 1)

        result[name] = {
            "fs_original_hz": fs_orig,
            "fs_decimated_hz": fs_dec,
            "decimate_factor": dec_factor,
            "nperseg": nperseg,
            "noverlap": noverlap,
            "fmin_hz": fmin,
            "fmax_hz": fmax,
            "unit": "dB re 1 Pa^2/Hz",
            "preview_channel": ch_name,
            "n_freq": int(freqs_trim.shape[0]),
            "n_time": int(t.shape[0]),
            "freqs_hz": freqs_trim.tolist(),
            "t_s": t.tolist(),
            "Sxx_db": psd_db.tolist(),   # [n_freq][n_time]
        }

    return result


def extract_waveform(f: h5py.File,
                     downsample: int = 10,
                     max_samples: int = 50000) -> dict:
    """
    Decimated time-domain waveform for each recorder channel.

    downsample  : keep every Nth sample (anti-alias not applied — preview only)
    max_samples : hard cap on output length

    Returns per recorder per channel:
      - t_s       : time axis [seconds]
      - signal_pa : pressure in Pa
    """
    recorder_names = [k for k in f.keys() if k.startswith("Recorder-")]
    result = {}

    for name in recorder_names:
        rec = f[name]
        a = attrs_to_dict(rec.attrs)
        fs = float(a.get("Sample Rate (Hz)", 50000))

        data = rec[:].astype(np.float32)  # (npts, 4)

        # Decimation
        data_ds = data[::downsample, :]
        if data_ds.shape[0] > max_samples:
            data_ds = data_ds[:max_samples, :]

        npts_ds = data_ds.shape[0]
        t = (np.arange(npts_ds) * downsample / fs).tolist()

        channel_labels = ["Tetra-Top", "Tetra-A", "Tetra-B", "Tetra-C"]
        channels = {}
        for ch_idx, ch_name in enumerate(channel_labels[:data.shape[1]]):
            channels[ch_name] = {
                "t_s": t,
                "signal_pa": data_ds[:, ch_idx].tolist(),
            }

        result[name] = {
            "fs_original_hz": fs,
            "downsample_factor": downsample,
            "n_samples_preview": npts_ds,
            "duration_preview_s": round(npts_ds * downsample / fs, 3),
            "unit": "Pa",
            "channels": channels,
        }

    return result


def extract_situation(situation_path: pathlib.Path,
                      bathy_step: int = 10) -> dict:
    """
    Read Situation.h5: bathymetry grid + fiber track + boat tracks.

    bathy_step : downsample bathymetry grid (every Nth row/col).
                 step=10 → 1000×1000 grid becomes 100×100 (manageable for frontend).

    Returns:
      - meta         : file-level attrs (CRS, lake level, sound speed, etc.)
      - bathymetry   : downsampled 2D depth grid with x/y coordinate vectors
      - fiber_track  : in-water fiber segment [X, Y, depth] points
      - boat_tracks  : dict of named boat tracks, each a list of {t, x, y, depth}
    """
    if not situation_path.exists():
        return {"error": f"Situation.h5 not found at {situation_path}"}

    with h5py.File(situation_path, "r") as sf:
        result = {"meta": attrs_to_dict(sf.attrs)}

        # ── Bathymetry ──────────────────────────────────────────────────────
        bathy_ds = sf["Bathymetry"]
        ba = attrs_to_dict(bathy_ds.attrs)
        depth_grid = bathy_ds[::bathy_step, ::bathy_step]

        # X/Y coordinate vectors (stored as attrs or separate datasets)
        # Reconstruct from bounds + shape
        orig_shape = bathy_ds.shape  # (rows, cols) before downsampling
        x_coords = np.array(ba.get("X", []))
        y_coords = np.array(ba.get("Y", []))

        if x_coords.size == 0:
            # Fall back: reconstruct from data_coordinates attr if present
            dc = ba.get("data_coordinates", None)
            if dc:
                x_coords = np.linspace(dc[0], dc[1], orig_shape[1])
                y_coords = np.linspace(dc[2], dc[3], orig_shape[0])

        result["bathymetry"] = {
            "description": "Lake depth relative to lake level (negative = underwater)",
            "unit": "m",
            "crs": result["meta"].get("Coordinates"),
            "bathy_step": bathy_step,
            "shape": list(depth_grid.shape),
            "x_coords": x_coords[::bathy_step].tolist() if x_coords.size else [],
            "y_coords": y_coords[::bathy_step].tolist() if y_coords.size else [],
            "depth_grid": depth_grid.tolist(),
            "attrs": ba,
        }

        # ── Fiber track ─────────────────────────────────────────────────────
        tracks_group = sf["Tracks"]
        interp = tracks_group.get("Interpolated")
        fiber_segments = {}

        if interp is not None:
            if isinstance(interp, h5py.Dataset):
                # Single dataset: columns [T, X, Y, Depth]
                d = interp[:]
                fiber_segments["all"] = [
                    {"t": row[0], "x": row[1], "y": row[2], "depth": row[3]}
                    for row in d
                ]
            elif isinstance(interp, h5py.Group):
                # Sub-groups per segment type
                for seg_name in interp.keys():
                    seg = interp[seg_name]
                    if isinstance(seg, h5py.Dataset):
                        d = seg[:]
                        ncols = d.shape[1] if d.ndim == 2 else 0
                        fiber_segments[seg_name] = [
                            {
                                "x": float(row[0]),
                                "y": float(row[1]),
                                **({"depth": float(row[2])} if ncols > 2 else {}),
                            }
                            for row in d
                        ]

        result["fiber_track"] = {
            "description": "Interpolated fiber-optic cable track in lake",
            "crs": result["meta"].get("Coordinates"),
            "segments": fiber_segments,
        }

        # ── Boat tracks ─────────────────────────────────────────────────────
        boat_tracks = {}
        for track_name in tracks_group.keys():
            if track_name == "Interpolated":
                continue
            item = tracks_group[track_name]
            if isinstance(item, h5py.Dataset):
                d = item[:]
                ncols = d.shape[1] if d.ndim == 2 else 0
                boat_tracks[track_name] = [
                    {
                        "t": float(row[0]),
                        "x": float(row[1]),
                        "y": float(row[2]),
                        **({"depth": float(row[3])} if ncols > 3 else {}),
                    }
                    for row in d
                ]
            elif isinstance(item, h5py.Group):
                # Has sub-datasets (e.g. shots sub-group)
                sub = {}
                for sub_name in item.keys():
                    sub_ds = item[sub_name]
                    if isinstance(sub_ds, h5py.Dataset):
                        d = sub_ds[:]
                        ncols = d.shape[1] if d.ndim == 2 else 0
                        sub[sub_name] = [
                            {
                                "t": float(row[0]),
                                "x": float(row[1]),
                                "y": float(row[2]),
                                **({"depth": float(row[3])} if ncols > 3 else {}),
                            }
                            for row in d
                        ]
                boat_tracks[track_name] = sub

        result["boat_tracks"] = {
            "description": "GPS boat tracks during experiment runs",
            "crs": result["meta"].get("Coordinates"),
            "tracks": boat_tracks,
        }

    return result


def extract_recorders_summary(f: h5py.File) -> dict:
    """
    For each available hydrophone recorder: metadata + per-channel RMS.
    """
    recorder_names = [k for k in f.keys() if k.startswith("Recorder-")]
    result = {}

    for name in recorder_names:
        rec = f[name]
        a = attrs_to_dict(rec.attrs)

        data = rec[:].astype(np.float32)   # shape: (npts, 4)
        fs = float(a.get("Sample Rate (Hz)", 50000))
        npts = data.shape[0]

        channel_labels = ["Tetra-Top", "Tetra-A", "Tetra-B", "Tetra-C"]
        rms_pa = [float(np.sqrt(np.mean(data[:, ch] ** 2)))
                  for ch in range(data.shape[1])]

        result[name] = {
            "attrs": a,
            "shape_npts_x_4ch": list(rec.shape),
            "dtype": str(rec.dtype),
            "fs_hz": fs,
            "duration_s": round(npts / fs, 3),
            "channels": channel_labels[:data.shape[1]],
            "rms_pa": dict(zip(channel_labels[:data.shape[1]], rms_pa)),
        }

    return result


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 ingest_prototype.py <shot.h5> [output_dir] [--situation <Situation.h5>]")
        sys.exit(1)

    h5_path = pathlib.Path(sys.argv[1])
    out_dir = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith("--") \
              else h5_path.parent / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Optional --situation flag
    situation_path = None
    if "--situation" in sys.argv:
        idx = sys.argv.index("--situation")
        situation_path = pathlib.Path(sys.argv[idx + 1])

    print(f"\n{'='*60}")
    print(f"  DASLakeZurich MVP Ingest Prototype")
    print(f"  File : {h5_path}")
    print(f"  Out  : {out_dir}")
    print(f"{'='*60}\n")

    with h5py.File(h5_path, "r") as f:

        # 1. HDF5 structure tree
        print("── HDF5 Structure ──────────────────────────────────────────")
        walk_structure(f)
        print()

        # 2. Shot metadata
        print("── Extracting shot_metadata ────────────────────────────────")
        meta = extract_shot_metadata(f, h5_path)
        write_json(out_dir / "shot_metadata.json", meta)

        # 3. DAS preview
        print("── Extracting das_preview (downsampled) ────────────────────")
        das_prev = extract_das_preview(f,
                                        channel_step=50,
                                        time_downsample=20,
                                        max_channels=20)
        write_json(out_dir / "das_preview.json", das_prev)
        if "error" not in das_prev:
            print(f"     original DAS  : {meta['das']['n_samples']} samples × "
                  f"{meta['das']['n_channels']} channels")
            print(f"     preview DAS   : {das_prev['n_time']} samples × "
                  f"{das_prev['n_channels']} channels")

        # 4. Recorders summary
        print("── Extracting recorders_summary ────────────────────────────")
        rec_sum = extract_recorders_summary(f)
        write_json(out_dir / "recorders_summary.json", rec_sum)
        for rname, rd in rec_sum.items():
            print(f"     {rname}: RMS = "
                  f"{', '.join(f'{v:.4f} Pa' for v in rd['rms_pa'].values())}")

        # 5. Spectrogram
        print("── Extracting spectrogram (STFT, 10–5000 Hz) ───────────────")
        spectro = extract_spectrogram(f, fmin=10.0, fmax=5000.0)
        write_json(out_dir / "spectrogram.json", spectro)
        for rname, rd in spectro.items():
            print(f"     {rname}/{rd['preview_channel']}: "
                  f"{rd['n_freq']} freq bins × {rd['n_time']} time frames")

        # 6. Waveform (decimated)
        print("── Extracting waveform (decimated ×10) ─────────────────────")
        waveform = extract_waveform(f, downsample=10, max_samples=50000)
        write_json(out_dir / "waveform.json", waveform)
        for rname, rd in waveform.items():
            print(f"     {rname}: {rd['n_samples_preview']} samples "
                  f"({rd['duration_preview_s']} s preview, "
                  f"original fs={rd['fs_original_hz']} Hz)")

    # 7. Situation (bathymetry + fiber track)
    print("── Extracting situation (Situation.h5) ─────────────────────")
    sit_path = situation_path or (h5_path.parent.parent / "Situation.h5")
    situation = extract_situation(sit_path, bathy_step=10)
    write_json(out_dir / "situation.json", situation)
    if "error" not in situation:
        bathy = situation["bathymetry"]
        n_fiber = sum(len(v) for v in situation["fiber_track"]["segments"].values())
        n_boat  = len(situation["boat_tracks"]["tracks"])
        print(f"     bathymetry  : {bathy['shape']} grid (step={bathy['bathy_step']})")
        print(f"     fiber pts   : {n_fiber}")
        print(f"     boat tracks : {n_boat}")
    else:
        print(f"     {situation['error']}")

    print()
    print("── Output summary ───────────────────────────────────────────")
    for f_out in sorted(out_dir.glob("*.json")):
        size_kb = f_out.stat().st_size / 1024
        print(f"     {f_out.name:<30} {size_kb:>8.1f} KB")
    print()
    print("Done.")


if __name__ == "__main__":
    main()
