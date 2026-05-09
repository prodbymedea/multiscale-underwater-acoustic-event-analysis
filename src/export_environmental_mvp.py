#!/usr/bin/env python3
"""
Compact MVP exporter for Delft3D-FLOW environmental NetCDF (Lake Zurich thesis).

Reads UMNLDF, VMNLDF, R1 temperature, THERMOCLINE (+ XZ, YZ, ZK_LYR, time; optional ALFAS for east/north).
Writes model-frame map fields and honest metadata; fiber sampling is deferred until
CRS alignment is verified (no fake overlay).

Usage:
  python src/export_environmental_mvp.py
  python src/export_environmental_mvp.py --nc data/raw/environment/Models.delft3dflow_zurich_20220130.nc
  python src/export_environmental_mvp.py --time-stride 6 --space-stride 2
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cftime
from typing import Any

import numpy as np

from _repo_paths import REPO_ROOT

try:
    from netCDF4 import Dataset
except ImportError as e:
    print("netCDF4 is required: pip install netCDF4", file=sys.stderr)
    raise SystemExit(1) from e

SCHEMA_VERSION = "1.2"
DEFAULT_NC = REPO_ROOT / "data" / "raw" / "environment" / "Models.delft3dflow_zurich_20220123.nc"
OUT_DIR = REPO_ROOT / "output" / "environmental"
DEFAULT_START_UTC = "2022-01-25"
DEFAULT_END_UTC = "2022-01-28"
THERMOCLINE_FILL = -999.0
# Delft3D dry / inactive horizontal velocity sentinel in this export (no CF _FillValue on U1).
DELFT_DRY_VEL_ABS_MIN = 998.0
# Default thesis instant when choosing among coverage-qualified timesteps.
WHALE_WINDOW_PREFER_UNIX_UTC = datetime(2022, 1, 26, 12, 0, tzinfo=timezone.utc).timestamp()
R1_DRY_SENTINEL = THERMOCLINE_FILL  # dry/land temperature cells use same -999 convention here
DEFAULT_EXPORT_ALL_DEPTHS = True


def _read_var(ds: Dataset, name: str) -> np.ndarray:
    v = ds.variables[name]
    arr = np.array(v[:], dtype=np.float64)
    if getattr(v, "_FillValue", None) is not None:
        fv = float(v._FillValue)
        arr = np.where(arr == fv, np.nan, arr)
    return arr


def _read_scalar_attr(ds: Dataset, varname: str, attr: str, default: str | None = None) -> str | None:
    if varname not in ds.variables:
        return default
    v = ds.variables[varname]
    if hasattr(v, attr):
        val = getattr(v, attr)
        if isinstance(val, bytes):
            return val.decode("utf-8", errors="replace")
        return str(val)
    return default


def parse_utc_bound(value: str, *, end_of_day: bool = False) -> datetime:
    """Parse YYYY-MM-DD or ISO datetime as UTC; date-only end bounds are exclusive next-day."""
    s = str(value).strip()
    if not s:
        raise ValueError("empty date bound")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if len(s) == 10:
        dt = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        return dt + timedelta(days=1) if end_of_day else dt
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def utc_iso(ts: float | None) -> str | None:
    if ts is None or not np.isfinite(ts):
        return None
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def mask_delft_dry_velocity(a: np.ndarray) -> np.ndarray:
    """Mask large-magnitude sentinel values used for dry/inactive U/V in 3D exports."""
    a = np.asarray(a, dtype=np.float64)
    return np.where(np.abs(a) >= DELFT_DRY_VEL_ABS_MIN, np.nan, a)


def pick_u1_vertical_index(u1_full: np.ndarray) -> int:
    """Layer with the most non-dry U1 samples (summed over time and horizontal grid)."""
    bad = np.abs(u1_full) >= DELFT_DRY_VEL_ABS_MIN
    nz = u1_full.shape[1]
    counts = [(~bad[:, k]).sum() for k in range(nz)]
    return int(np.argmax(counts))


def stagger_u_to_cell(u: np.ndarray) -> np.ndarray:
    """Average U from staggered U-points to (M,N). NaN-aware (Delft dry cells).

    u shape: (T, MC, N) with MC == M.
    """
    u = np.asarray(u, dtype=np.float64)
    t, m, n = u.shape
    out = np.full((t, m, n), np.nan, dtype=np.float64)
    out[:, 0, :] = u[:, 0, :]
    a = u[:, 1:, :]
    b = u[:, :-1, :]
    both = np.isfinite(a) & np.isfinite(b)
    only_a = np.isfinite(a) & ~np.isfinite(b)
    only_b = ~np.isfinite(a) & np.isfinite(b)
    merged = np.where(both, 0.5 * (a + b), np.nan)
    merged = np.where(only_a, a, merged)
    merged = np.where(only_b, b, merged)
    out[:, 1:, :] = merged
    return out.astype(np.float32)


def stagger_v_to_cell(v: np.ndarray) -> np.ndarray:
    """Average V from staggered V-points to (M,N). NaN-aware."""
    v = np.asarray(v, dtype=np.float64)
    t, m, nc = v.shape
    out = np.full((t, m, nc), np.nan, dtype=np.float64)
    out[:, :, 0] = v[:, :, 0]
    a = v[:, :, 1:]
    b = v[:, :, :-1]
    both = np.isfinite(a) & np.isfinite(b)
    only_a = np.isfinite(a) & ~np.isfinite(b)
    only_b = ~np.isfinite(a) & np.isfinite(b)
    merged = np.where(both, 0.5 * (a + b), np.nan)
    merged = np.where(only_a, a, merged)
    merged = np.where(only_b, b, merged)
    out[:, :, 1:] = merged
    return out.astype(np.float32)


def rotate_to_east_north(
    u_cell: np.ndarray, v_cell: np.ndarray, alfas_deg: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Rotate grid-aligned (u,v) to approximate east/north using ALFAS (deg)."""
    rad = np.deg2rad(alfas_deg.astype(np.float32))
    c = np.cos(rad)[np.newaxis, :, :]
    s = np.sin(rad)[np.newaxis, :, :]
    u_e = u_cell * c - v_cell * s
    v_n = u_cell * s + v_cell * c
    return u_e.astype(np.float32), v_n.astype(np.float32)


def time_to_seconds_since_epoch(time_var) -> tuple[np.ndarray, str]:
    """Return Unix time in seconds (float64) when CF time units allow; else raw values."""
    tnum = np.asarray(time_var[:], dtype=np.float64)
    orig_shape = tnum.shape
    units = getattr(time_var, "units", "") or ""
    calendar = getattr(time_var, "calendar", "standard")
    if "since" in units.lower():
        try:
            from netCDF4 import num2date

            dates = np.atleast_1d(num2date(tnum.ravel(), units=units, calendar=calendar))
            epoch_cf = cftime.datetime(1970, 1, 1, 0, 0, 0, calendar=calendar)
            py_epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
            secs: list[float] = []
            for d in dates.ravel():
                if isinstance(d, datetime):
                    dd = d if d.tzinfo else d.replace(tzinfo=timezone.utc)
                    secs.append((dd - py_epoch).total_seconds())
                else:
                    secs.append((d - epoch_cf).total_seconds())
            return np.array(secs, dtype=np.float64).reshape(orig_shape), units
        except Exception:
            pass
    return tnum.astype(np.float64), units


def recommend_viewer_time_index(
    scalar_export: np.ndarray,
    time_s_export: np.ndarray,
    prefer_unix: float | None = WHALE_WINDOW_PREFER_UNIX_UTC,
    scalar_short_name: str = "primary scalar",
) -> tuple[int, str]:
    """Pick a timestep index in the *exported* series for frontend default."""
    nt = scalar_export.shape[0]
    if nt == 0:
        return 0, "No timesteps."
    fracs = np.array([np.mean(np.isfinite(scalar_export[i])) for i in range(nt)], dtype=np.float64)
    fmax = float(np.max(fracs))
    if fmax <= 0 and prefer_unix is not None and time_s_export.size == nt:
        i0 = int(np.argmin(np.abs(time_s_export - prefer_unix)))
        return i0, f"No finite {scalar_short_name} in this export; defaulted to nearest preferred UTC."
    if fmax <= 0:
        return 0, f"No finite {scalar_short_name}; defaulted to first step."
    thresh = max(0.002, 0.35 * fmax)
    cand = np.where(fracs >= thresh)[0]
    if prefer_unix is not None and cand.size > 0 and time_s_export.size == nt:
        i_sel = int(cand[np.argmin(np.abs(time_s_export[cand] - prefer_unix))])
        return (
            i_sel,
            f"Among steps with {scalar_short_name} coverage ≥{100 * thresh:.1f}% (max {100 * fmax:.1f}%), "
            f"closest to thesis whale-window UTC.",
        )
    return int(np.argmax(fracs)), f"Largest {scalar_short_name} coverage in export ({100 * fmax:.1f}% finite cells)."


def decimate_time_space(
    u: np.ndarray,
    v: np.ndarray,
    temp: np.ndarray,
    th: np.ndarray,
    xz: np.ndarray,
    yz: np.ndarray,
    time_stride: int,
    space_stride: int,
) -> tuple[np.ndarray, ...]:
    u = u[::time_stride, ::space_stride, ::space_stride]
    v = v[::time_stride, ::space_stride, ::space_stride]
    temp = temp[::time_stride, ::space_stride, ::space_stride]
    th = th[::time_stride, ::space_stride, ::space_stride]
    xz = xz[::space_stride, ::space_stride]
    yz = yz[::space_stride, ::space_stride]
    return u, v, temp, th, xz, yz


def decimate_time_depth_space(
    arr: np.ndarray,
    time_stride: int,
    space_stride: int,
) -> np.ndarray:
    """Decimate a (T,Z,M,N) array for browser map use."""
    return arr[::time_stride, :, ::space_stride, ::space_stride].astype(np.float32)


def build_meta(
    nc_path: Path,
    extra_sources: list[Path],
    nt: int,
    m: int,
    n: int,
    time_units: str,
    time_s: np.ndarray,
    u_units: str | None,
    th_units: str | None,
    xz_units: str | None,
    map_shapes: dict[str, Any],
    fiber_status: dict[str, Any],
    processing_notes: list[str],
) -> dict[str, Any]:
    t0_utc = None
    t1_utc = None
    if time_s.size:
        t0_utc = float(time_s.min())
        t1_utc = float(time_s.max())
    sources = [str(p.resolve()) for p in [nc_path, *extra_sources] if p]
    return {
        "schema_version": SCHEMA_VERSION,
        "source_files": sources,
        "variables": {
            "flow_u": {"netcdf": "UMNLDF", "export": "u_ms", "units_export": "m s-1"},
            "flow_v": {"netcdf": "VMNLDF", "export": "v_ms", "units_export": "m s-1"},
            "thermocline": {
                "netcdf": "THERMOCLINE",
                "export": "thermocline_m",
                "units_export": th_units or "unknown",
                "fill_value_masked": THERMOCLINE_FILL,
            },
        },
        "units_from_file": {
            "UMNLDF": u_units,
            "THERMOCLINE": th_units,
            "XZ": xz_units,
        },
        "dimensions": {
            "M": m,
            "N": n,
            "Nt_exported": map_shapes.get("Nt_exported", nt),
            "description": "Horizontal curvilinear grid; flow stagger averaged to cell (M,N).",
        },
        "time": {
            "n_steps_source": int(nt),
            "time_coordinate_units": time_units,
            "exported_time_axis": "unix_epoch_seconds_utc",
            "time_s_epoch_unix": {"min": t0_utc, "max": t1_utc},
        },
        "crs_and_alignment": {
            "status": "pending_verified_transform",
            "summary": (
                "Model horizontal coordinates XZ, YZ are in the Delft3D-FLOW horizontal plane "
                "(CF axis: XZ positive east, YZ positive north; see file attributes). "
                "Fiber geometry from Situation.h5 / situation.json is exported in CH1903+ / LV95 "
                "(large easting/northing, ~1e6 m). No verified affine or control-point mapping "
                "between these frames is stored in this repository."
            ),
            "model_frame": "XZ_YZ_meters_model_plane",
            "fiber_frame": "LV95_easting_northing_when_present",
            "overlay_feasibility": "Map rasters are written in model native XZ,YZ. "
            "Georeferenced overlay on LV95 bathymetry requires an external or future transform.",
        },
        "fiber_timeseries": fiber_status,
        "processing": processing_notes,
        "outputs": {
            "environmental_mvp_meta.json": "this file",
            "environmental_map_fields.npz": (
                "Keys: XZ, YZ (M,N), time_s (Nt,), u_face_t, v_face_t, temperature_t (Nt,M,N) primary scalar, "
                "thermocline_t secondary; model plane."
            ),
            "environmental_fiber_timeseries.npz": (
                "Keys: time_s (Nt,); along_m (0,); u_ms, v_ms, thermocline_m (Nt,0) until CRS resolved."
            ),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Export compact environmental MVP products from Delft3D NetCDF.")
    ap.add_argument(
        "--nc",
        type=Path,
        default=DEFAULT_NC,
        help="Primary NetCDF path (default: 20220123 snapshot).",
    )
    ap.add_argument(
        "--also-nc",
        type=Path,
        nargs="*",
        default=[],
        help="Additional source files to list in metadata only (not merged).",
    )
    ap.add_argument("--time-stride", type=int, default=1, help="Keep every k-th timestep in map export.")
    ap.add_argument("--space-stride", type=int, default=1, help="Spatial decimation factor for map export.")
    ap.add_argument(
        "--single-depth-only",
        action="store_true",
        help="Write only the legacy single-layer fields, without 3D depth stacks.",
    )
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR, help="Output directory.")
    ap.add_argument(
        "--start-date",
        default=DEFAULT_START_UTC,
        help="Inclusive UTC export start date/time (default: 2022-01-25).",
    )
    ap.add_argument(
        "--end-date",
        default=DEFAULT_END_UTC,
        help=(
            "Exclusive UTC export end date/time. Default 2022-01-28 covers "
            "2022-01-25 through 2022-01-27 for the whale shots."
        ),
    )
    args = ap.parse_args()

    nc_path = args.nc
    if not nc_path.is_file():
        print(f"Missing NetCDF: {nc_path}", file=sys.stderr)
        raise SystemExit(2)

    start_dt = parse_utc_bound(args.start_date)
    end_dt = parse_utc_bound(args.end_date)
    if end_dt <= start_dt:
        print("--end-date must be later than --start-date", file=sys.stderr)
        raise SystemExit(2)
    start_ts = start_dt.timestamp()
    end_ts = end_dt.timestamp()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    processing_notes = [
        "UMNLDF/VMNLDF: staggered components averaged to (M,N) per environmental_data_audit.md.",
        "Rotation to east/north via ALFAS when present; else grid-aligned u,v exported.",
        f"THERMOCLINE: values equal to {THERMOCLINE_FILL} masked to NaN (exported as thermocline_t; sparse).",
    ]

    flow_catalog_note = "UMNLDF/VMNLDF (filtered horizontal)"
    u1_layer_used: int | None = None
    r1_k: int | None = None
    r1_units_attr: str | None = None
    depth_m: np.ndarray | None = None
    temp_zt: np.ndarray | None = None
    u_zt: np.ndarray | None = None
    v_zt: np.ndarray | None = None

    with Dataset(nc_path, "r") as ds:
        u_raw = _read_var(ds, "UMNLDF")
        v_raw = _read_var(ds, "VMNLDF")
        u_abs_max = float(np.nanmax(np.abs(u_raw))) if u_raw.size else 0.0
        v_abs_max = float(np.nanmax(np.abs(v_raw))) if v_raw.size else 0.0
        if u_abs_max < 1e-12 and v_abs_max < 1e-12 and "U1" in ds.variables and "V1" in ds.variables:
            u1_raw_full = np.array(ds.variables["U1"][:], dtype=np.float64)
            v1_raw_full = np.array(ds.variables["V1"][:], dtype=np.float64)
            u1_layer_used = pick_u1_vertical_index(u1_raw_full)
            u1_full = mask_delft_dry_velocity(u1_raw_full)
            v1_full = mask_delft_dry_velocity(v1_raw_full)
            u_raw = u1_full[:, u1_layer_used, :, :]
            v_raw = v1_full[:, u1_layer_used, :, :]
            if not args.single_depth_only:
                u_zt = u1_full
                v_zt = v1_full
            processing_notes.append(
                f"UMNLDF/VMNLDF are all zero in this file; using U1/V1 at vertical index k={u1_layer_used} "
                f"(auto-picked wet layer; values with |U| or |V| ≥ {DELFT_DRY_VEL_ABS_MIN:g} masked as dry)."
            )
            flow_catalog_note = f"U1/V1 layer {u1_layer_used} (Eulerian; UMNLDF/VMNLDF empty here)"
        th_var = ds.variables["THERMOCLINE"]
        th_raw = np.array(th_var[:], dtype=np.float64)
        th_raw = np.where(th_raw == THERMOCLINE_FILL, np.nan, th_raw)
        if getattr(th_var, "_FillValue", None) is not None:
            th_raw = np.where(th_raw == float(th_var._FillValue), np.nan, th_raw)

        xz = np.array(ds.variables["XZ"][:], dtype=np.float32)
        yz = np.array(ds.variables["YZ"][:], dtype=np.float32)

        time_var = ds.variables["time"]
        time_s, time_units = time_to_seconds_since_epoch(time_var)
        nt_source, mc, n_u = u_raw.shape
        _, m_v, nc_v = v_raw.shape
        if (
            xz.shape != (m_v, nc_v)
            or u_raw.shape[1:] != (mc, n_u)
            or mc != m_v
            or n_u != nc_v
        ):
            print("Unexpected dimension layout in NetCDF.", file=sys.stderr)
            raise SystemExit(3)
        m, n = m_v, nc_v

        time_mask = (time_s >= start_ts) & (time_s < end_ts)
        selected_indices = np.where(time_mask)[0]
        if selected_indices.size == 0:
            print(
                f"No model timesteps in requested window {start_dt.isoformat()} to {end_dt.isoformat()}",
                file=sys.stderr,
            )
            raise SystemExit(6)
        processing_notes.append(
            f"Time window clipped to {start_dt.isoformat()} inclusive through {end_dt.isoformat()} exclusive; "
            f"kept source indices {int(selected_indices[0])}..{int(selected_indices[-1])} "
            f"({int(selected_indices.size)} of {int(nt_source)} timesteps)."
        )
        u_raw = u_raw[time_mask]
        v_raw = v_raw[time_mask]
        th_raw = th_raw[time_mask]
        time_s = time_s[time_mask]

        u_cell = stagger_u_to_cell(u_raw)
        v_cell = stagger_v_to_cell(v_raw)

        if "ALFAS" in ds.variables:
            alfas = np.array(ds.variables["ALFAS"][:], dtype=np.float32)
            u_e, v_n = rotate_to_east_north(u_cell, v_cell, alfas)
            processing_notes.append("ALFAS applied: exported u_ms/v_ms are east/north components.")
        else:
            u_e, v_n = u_cell, v_cell
            processing_notes.append("ALFAS missing: u_ms/v_ms are grid-aligned averaged components.")

        th = th_raw.astype(np.float32)

        if "R1" not in ds.variables:
            print("NetCDF missing R1; cannot export MVP primary scalar (temperature).", file=sys.stderr)
            raise SystemExit(4)
        if u1_layer_used is not None:
            r1_k = u1_layer_used
        else:
            u1_ref = np.array(ds.variables["U1"][:], dtype=np.float64)
            r1_k = pick_u1_vertical_index(u1_ref)
        r1_var = ds.variables["R1"]
        r1_units_attr = _read_scalar_attr(ds, "R1", "units")
        if r1_var.shape[1] < 1 or r1_var.shape[2] <= r1_k:
            print("R1 dimensions incompatible with chosen layer index.", file=sys.stderr)
            raise SystemExit(5)
        if not args.single_depth_only:
            if "ZK_LYR" in ds.variables:
                depth_m = np.abs(np.array(ds.variables["ZK_LYR"][:], dtype=np.float32))
            elif "KMAXOUT_RESTR" in ds.variables:
                depth_m = np.array(ds.variables["KMAXOUT_RESTR"][:], dtype=np.float32)
            else:
                depth_m = np.arange(r1_var.shape[2], dtype=np.float32)
            temp_zt_raw = np.array(r1_var[:, 0, :, :, :], dtype=np.float64)[time_mask]
            temp_zt_raw = np.where(temp_zt_raw == R1_DRY_SENTINEL, np.nan, temp_zt_raw)
            if getattr(r1_var, "_FillValue", None) is not None:
                temp_zt_raw = np.where(temp_zt_raw == float(r1_var._FillValue), np.nan, temp_zt_raw)
            temp_zt = temp_zt_raw.astype(np.float32)
            depth_order = np.argsort(depth_m)
            depth_m = depth_m[depth_order]
            temp_zt = temp_zt[:, depth_order, :, :]
            processing_notes.append(
                "Depth-enabled export: wrote R1 temperature for all available vertical layer centres "
                "(temperature_zt with depth_m from ZK_LYR, sorted shallow to deep)."
            )
            if u_zt is not None and v_zt is not None:
                u_zt = u_zt[time_mask].astype(np.float32)
                v_zt = v_zt[time_mask].astype(np.float32)
                u_zt = u_zt[:, depth_order, :, :]
                v_zt = v_zt[:, depth_order, :, :]
                if "ALFAS" in ds.variables:
                    alfas_4d = np.array(ds.variables["ALFAS"][:], dtype=np.float32)[np.newaxis, np.newaxis, :, :]
                    rad_4d = np.deg2rad(alfas_4d)
                    c_4d = np.cos(rad_4d)
                    s_4d = np.sin(rad_4d)
                    u_e_zt = u_zt * c_4d - v_zt * s_4d
                    v_n_zt = u_zt * s_4d + v_zt * c_4d
                    u_zt = u_e_zt.astype(np.float32)
                    v_zt = v_n_zt.astype(np.float32)
                processing_notes.append(
                    "Depth-enabled export: wrote U1/V1 currents for all available vertical layers "
                    "(u_face_zt/v_face_zt)."
                )
        temp_raw = np.array(r1_var[:, 0, r1_k, :, :], dtype=np.float64)[time_mask]
        temp_raw = np.where(temp_raw == R1_DRY_SENTINEL, np.nan, temp_raw)
        if getattr(r1_var, "_FillValue", None) is not None:
            temp_raw = np.where(temp_raw == float(r1_var._FillValue), np.nan, temp_raw)
        temp = temp_raw.astype(np.float32)
        processing_notes.append(
            f"Primary scalar: R1 (NAMCON=temperature) layer k={r1_k}, aligned with wet-layer heuristic used for U1/V1. "
            f"Dry/land masked at {R1_DRY_SENTINEL:g}. File attribute units are nominal; viewer labels °C."
        )

        u_units = _read_scalar_attr(ds, "UMNLDF" if u1_layer_used is None else "U1", "units")
        th_units = _read_scalar_attr(ds, "THERMOCLINE", "units")
        xz_units = _read_scalar_attr(ds, "XZ", "units")

    # Decimate for map bundle
    ts, ss = max(1, args.time_stride), max(1, args.space_stride)
    u_d, v_d, temp_d, th_d, xz_d, yz_d = decimate_time_space(
        u_e, v_n, temp, th, xz, yz, ts, ss
    )
    temp_zt_d = decimate_time_depth_space(temp_zt, ts, ss) if temp_zt is not None else None
    u_zt_d = decimate_time_depth_space(u_zt, ts, ss) if u_zt is not None else None
    v_zt_d = decimate_time_depth_space(v_zt, ts, ss) if v_zt is not None else None
    nt_exp = u_d.shape[0]
    m_exp, n_exp = xz_d.shape

    fiber_status = {
        "projection": "pending",
        "arrays": "time_s only; u_ms, v_ms, thermocline_m along fiber are shape (Nt, 0) until "
        "a verified model↔LV95 mapping exists.",
        "reason": "Interpolating environmental fields onto fiber requires shared coordinates. "
        "Repository does not yet contain a validated transform.",
    }

    meta = build_meta(
        nc_path.resolve(),
        [p.resolve() for p in args.also_nc],
        nt=nt_source,
        m=m_exp,
        n=n_exp,
        time_units=time_units,
        time_s=time_s,
        u_units=u_units,
        th_units=th_units,
        xz_units=xz_units,
        map_shapes={
            "Nt_exported": int(nt_exp),
            "M_exported": int(m_exp),
            "N_exported": int(n_exp),
            "time_stride": ts,
            "space_stride": ss,
        },
        fiber_status=fiber_status,
        processing_notes=processing_notes,
    )
    meta["dimensions"].update(
        {
            "M_exported": m_exp,
            "N_exported": n_exp,
            "time_stride": ts,
            "space_stride": ss,
        }
    )
    if depth_m is not None and temp_zt_d is not None:
        meta["dimensions"]["N_depth_exported"] = int(temp_zt_d.shape[1])
        meta["dimensions"]["depth_axis"] = "depth_m, derived as abs(ZK_LYR); use nearest layer for requested depth."
        meta["variables"]["temperature_3d"] = {
            "netcdf": "R1",
            "lstsci_index": 0,
            "export": "temperature_zt",
            "shape": ["time", "depth", "M", "N"],
            "depth_axis": "depth_m",
            "units_file": r1_units_attr,
            "units_interpretation": "Nominal NetCDF units; displayed as °C (typical lake T magnitude).",
        }
        if u_zt_d is not None and v_zt_d is not None:
            meta["variables"]["flow_u_3d"] = {
                "netcdf": "U1",
                "export": "u_face_zt",
                "shape": ["time", "depth", "M", "N"],
                "depth_axis": "depth_m",
                "units_export": "m s-1",
            }
            meta["variables"]["flow_v_3d"] = {
                "netcdf": "V1",
                "export": "v_face_zt",
                "shape": ["time", "depth", "M", "N"],
                "depth_axis": "depth_m",
                "units_export": "m s-1",
            }
    meta["variables"]["flow_u"]["description"] = flow_catalog_note
    meta["variables"]["flow_v"]["description"] = flow_catalog_note
    if u1_layer_used is not None:
        meta["variables"]["flow_u"]["netcdf_fallback"] = "U1"
        meta["variables"]["flow_v"]["netcdf_fallback"] = "V1"
        meta["variables"]["flow_u"]["vertical_index_k"] = u1_layer_used
        meta["variables"]["flow_v"]["vertical_index_k"] = u1_layer_used

    meta["variables"]["temperature"] = {
        "netcdf": "R1",
        "lstsci_index": 0,
        "vertical_index_k": r1_k,
        "export": "temperature_t",
        "units_file": r1_units_attr,
        "units_interpretation": "Nominal NetCDF units; displayed as °C (typical lake T magnitude).",
    }
    meta["mvp_scalar"] = {
        "primary": "temperature_t",
        "secondary": "thermocline_t",
        "rationale": (
            "R1 temperature at the wet vertical layer has much higher horizontal coverage than THERMOCLINE "
            "in the audited 20220123 file; thermocline remains exported as a secondary diagnostic."
        ),
    }
    meta["requested_time_window_utc"] = {
        "start_inclusive": start_dt.isoformat().replace("+00:00", "Z"),
        "end_exclusive": end_dt.isoformat().replace("+00:00", "Z"),
        "purpose": "Thesis dashboard focus window covering 2022-01-25 through 2022-01-27.",
    }
    meta["exported_time_window_utc"] = {
        "start": utc_iso(float(time_s.min())) if time_s.size else None,
        "end": utc_iso(float(time_s.max())) if time_s.size else None,
        "n_steps_before_stride": int(time_s.size),
    }

    th_time_s = time_s[::ts].astype(np.float64)
    if th_time_s.shape[0] == temp_d.shape[0]:
        def_idx, def_note = recommend_viewer_time_index(
            temp_d, th_time_s, scalar_short_name="R1 temperature coverage"
        )
        th_global_fin = float(np.mean(np.isfinite(th_d)))
        temp_global_fin = float(np.mean(np.isfinite(temp_d)))
        meta["viewer_hints"] = {
            "primary_scalar": "temperature_t",
            "default_time_index": int(def_idx),
            "default_time_index_note": def_note,
            "temperature_r1_layer_k": r1_k,
            "temperature_finite_fraction_global": temp_global_fin,
            "temperature_note": (
                "Map shows R1 (constituent index 0 = temperature per NAMCON) on the horizontal grid; "
                "dry/land (-999) masked. Not causal proof vs DAS; model-frame context only."
            ),
            "thermocline_finite_fraction_global": th_global_fin,
            "thermocline_note": (
                "thermocline_t is still exported but is mostly -999 in this run — use for specialist checks, "
                "not as the main viewer layer."
            ),
        }

    out_meta = args.out_dir / "environmental_mvp_meta.json"
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    map_npz = args.out_dir / "environmental_map_fields.npz"
    map_payload = {
        "XZ": xz_d,
        "YZ": yz_d,
        "time_s": time_s[::ts].astype(np.float64),
        "u_face_t": u_d,
        "v_face_t": v_d,
        "temperature_t": temp_d,
        "thermocline_t": th_d,
    }
    if depth_m is not None and temp_zt_d is not None:
        map_payload["depth_m"] = depth_m.astype(np.float32)
        map_payload["temperature_zt"] = temp_zt_d
        if u_zt_d is not None and v_zt_d is not None:
            map_payload["u_face_zt"] = u_zt_d
            map_payload["v_face_zt"] = v_zt_d
    np.savez_compressed(map_npz, **map_payload)

    # Fiber bundle: honest empty second dimension
    fiber_npz = args.out_dir / "environmental_fiber_timeseries.npz"
    empty = np.zeros((nt_exp, 0), dtype=np.float32)
    np.savez_compressed(
        fiber_npz,
        time_s=time_s[::ts].astype(np.float64),
        along_m=np.zeros((0,), dtype=np.float32),
        u_ms=empty,
        v_ms=empty,
        thermocline_m=empty,
    )

    print(f"Wrote {out_meta}")
    print(f"Wrote {map_npz}")
    print(f"Wrote {fiber_npz}")


if __name__ == "__main__":
    main()
