#!/usr/bin/env python3
"""
Compact MVP exporter for Delft3D-FLOW environmental NetCDF (Lake Zurich thesis).

Reads UMNLDF, VMNLDF, THERMOCLINE (+ XZ, YZ, time; optional ALFAS for east/north).
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
from datetime import datetime, timezone
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

SCHEMA_VERSION = "1.0"
DEFAULT_NC = REPO_ROOT / "data" / "raw" / "environment" / "Models.delft3dflow_zurich_20220123.nc"
OUT_DIR = REPO_ROOT / "output" / "environmental"
THERMOCLINE_FILL = -999.0


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


def stagger_u_to_cell(u: np.ndarray) -> np.ndarray:
    """Average UMNLDF from staggered U-points to (M,N) cell-aligned field.

    u shape: (T, MC, N) with MC == M. Convention: u_cell[m] = 0.5*(U[m] + U[m-1]) for m>=1.
    """
    t, m, n = u.shape
    out = np.zeros((t, m, n), dtype=np.float32)
    out[:, 0, :] = u[:, 0, :]
    out[:, 1:, :] = 0.5 * (u[:, 1:, :] + u[:, :-1, :])
    return out


def stagger_v_to_cell(v: np.ndarray) -> np.ndarray:
    """Average VMNLDF from staggered V-points to (M,N). v shape: (T, M, NC)."""
    t, m, nc = v.shape
    out = np.zeros((t, m, nc), dtype=np.float32)
    out[:, :, 0] = v[:, :, 0]
    out[:, :, 1:] = 0.5 * (v[:, :, 1:] + v[:, :, :-1])
    return out


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


def decimate_time_space(
    u: np.ndarray,
    v: np.ndarray,
    th: np.ndarray,
    xz: np.ndarray,
    yz: np.ndarray,
    time_stride: int,
    space_stride: int,
) -> tuple[np.ndarray, ...]:
    u = u[::time_stride, ::space_stride, ::space_stride]
    v = v[::time_stride, ::space_stride, ::space_stride]
    th = th[::time_stride, ::space_stride, ::space_stride]
    xz = xz[::space_stride, ::space_stride]
    yz = yz[::space_stride, ::space_stride]
    return u, v, th, xz, yz


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
                "Keys: XZ, YZ (M,N), time_s (Nt,), u_face_t, v_face_t, thermocline_t (Nt,M,N); "
                "coordinates in model plane."
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
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR, help="Output directory.")
    args = ap.parse_args()

    nc_path = args.nc
    if not nc_path.is_file():
        print(f"Missing NetCDF: {nc_path}", file=sys.stderr)
        raise SystemExit(2)

    args.out_dir.mkdir(parents=True, exist_ok=True)

    processing_notes = [
        "UMNLDF/VMNLDF: staggered components averaged to (M,N) per environmental_data_audit.md.",
        "Rotation to east/north via ALFAS when present; else grid-aligned u,v exported.",
        f"THERMOCLINE: values equal to {THERMOCLINE_FILL} masked to NaN.",
    ]

    with Dataset(nc_path, "r") as ds:
        u_raw = _read_var(ds, "UMNLDF")
        v_raw = _read_var(ds, "VMNLDF")
        th_var = ds.variables["THERMOCLINE"]
        th_raw = np.array(th_var[:], dtype=np.float64)
        th_raw = np.where(th_raw == THERMOCLINE_FILL, np.nan, th_raw)
        if getattr(th_var, "_FillValue", None) is not None:
            th_raw = np.where(th_raw == float(th_var._FillValue), np.nan, th_raw)

        xz = np.array(ds.variables["XZ"][:], dtype=np.float32)
        yz = np.array(ds.variables["YZ"][:], dtype=np.float32)

        time_var = ds.variables["time"]
        time_s, time_units = time_to_seconds_since_epoch(time_var)
        nt, mc, n_u = u_raw.shape
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

        u_cell = stagger_u_to_cell(u_raw.astype(np.float64))
        v_cell = stagger_v_to_cell(v_raw.astype(np.float64))

        if "ALFAS" in ds.variables:
            alfas = np.array(ds.variables["ALFAS"][:], dtype=np.float32)
            u_e, v_n = rotate_to_east_north(u_cell, v_cell, alfas)
            processing_notes.append("ALFAS applied: exported u_ms/v_ms are east/north components.")
        else:
            u_e, v_n = u_cell, v_cell
            processing_notes.append("ALFAS missing: u_ms/v_ms are grid-aligned averaged components.")

        th = th_raw.astype(np.float32)

        u_units = _read_scalar_attr(ds, "UMNLDF", "units")
        th_units = _read_scalar_attr(ds, "THERMOCLINE", "units")
        xz_units = _read_scalar_attr(ds, "XZ", "units")

    # Decimate for map bundle
    ts, ss = max(1, args.time_stride), max(1, args.space_stride)
    u_d, v_d, th_d, xz_d, yz_d = decimate_time_space(
        u_e, v_n, th, xz, yz, ts, ss
    )
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
        nt=nt,
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

    out_meta = args.out_dir / "environmental_mvp_meta.json"
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    map_npz = args.out_dir / "environmental_map_fields.npz"
    np.savez_compressed(
        map_npz,
        XZ=xz_d,
        YZ=yz_d,
        time_s=time_s[::ts].astype(np.float64),
        u_face_t=u_d,
        v_face_t=v_d,
        thermocline_t=th_d,
    )

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
