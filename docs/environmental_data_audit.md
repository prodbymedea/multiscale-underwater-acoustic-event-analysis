# Environmental / lake-model data audit (thesis branch)

**Status (updated):** **Delft3D-FLOW** NetCDF files are present locally under `data/raw/environment/`. This document records **actual** variable names, dimensions, and **final MVP choices**. A machine-readable listing is in **`docs/environmental_nc_inventory.md`** (regenerate with `src/summarize_env_netcdf.py`).

**Goal:** Select **1–2 MVP environmental products** (compact exports) to relate **lake hydrodynamics / stratification** to **cable-wide, wave-like DAS structure** without implying every DAS feature is whale-related.

---

## 1. Files inspected

| File | Size (order) | Role |
|------|----------------|------|
| `data/raw/environment/Models.delft3dflow_zurich_20220123.nc` | ~1.6 GB | Delft3D map output; **covers ~7 days** starting ~2022-01-23 (see time axis below) |
| `data/raw/environment/Models.delft3dflow_zurich_20220130.nc` | ~1.6 GB | Same grid/variables; **abutting window** ~2022-01-30 onward |

**Model metadata (from file):** `institution=Deltares`, `LAYER_MODEL=Z-MODEL`, **75 vertical layer centres** (`K_LYR=75`), **curvilinear horizontal grid** `M=212`, `N=34` (cell centres at `XZ`, `YZ`). **Time:** `56` steps per file, **~3 h** spacing (`Δt ≈ 3.004 h`). Units: `seconds since 2008-03-01 00:00:00`.

**Whales experiment context:** Shots on **2022-01-26** fall in the **20220123** file’s window (not the 20220130-only file). Use **`Models.delft3dflow_zurich_20220123.nc`** as the primary source for aligning with `whales_humpback` / `whales_orca`; keep the second file for continuity or sensitivity checks.

**Constituent:** `NAMCON` → **`Temperature`** — so `R1[:, 0, ...]` is **temperature** (NetCDF `units='1'` is uninformative; interpret via `NAMCON`).

**Coordinates caveat:** `XZ`, `YZ` span **~0–714 km** and **~0–247 km** in the inspected file. **Shot / source positions** in project exports are **CH1903+ / LV95** (e.g. E ≈ 2.68×10⁶ m). The model grid is almost certainly a **projected metric system** (local or national), **not** raw LV95. **Do not** overlay fiber on the model map until a **CRS / affine mapping** is confirmed from documentation or project metadata. Feasibility below assumes a **known transform** or **manual control-point** registration.

---

## 2. Candidate variables (curated from actual file)

Only variables **most useful** for thesis + viewer are listed; the full list is in `docs/environmental_nc_inventory.md`.

| Name | Units | Dims | Meaning | Spatial / fiber | Thesis use |
|------|-------|------|---------|-----------------|------------|
| **`UMNLDF`** | m s⁻¹ | `(time, MC, N)` | **Filtered U-velocity** (UGRID `location=edge1`) | Staggered; interpolate to cell face `(M,N)` for fiber | **Mechanical** forcing / circulation context |
| **`VMNLDF`** | m s⁻¹ | `(time, M, NC)` | **Filtered V-velocity** (`edge2`) | Same | Pair with `UMNLDF` for horizontal flow |
| **`THERMOCLINE`** | m | `(time, M, N)` | Thermocline depth (`description`: PyLake); `_FillValue=-999` | **Native on cell centres** — **best match to `XZ,YZ`** | **Stratification / internal-wave** narrative |
| **`S1`** | m | `(time, M, N)` | Water level (free surface at zeta point) | Face `(M,N)` | Barotropic setup / seiche-like motion |
| **`R1`** (index `LSTSCI=0`) | 1 (Temperature) | `(time, 1, K_LYR, M, N)` | **Temperature** per layer | 3D — pick one `k` for 2D slice | Familiar scalar; heavier export than `THERMOCLINE` |
| **`U1`, `V1`** | m s⁻¹ | `(time, K_LYR, …)` | Full 3D Eulerian u, v | Layer-dependent | **Deferred** for MVP (large; use `UMNLDF`/`VMNLDF` first) |
| **`RHO`** | kg m⁻³ | `(time, K_LYR, M, N)` | Density | 3D | Useful later; redundant with T for storytelling if T available |

**Deprioritized for MVP:** `TAUKSI`/`TAUETA` (bottom stress), `VICWW`/`DICWW` (eddy visc), `HYDPRES`, full `W`/`WPHY` — more specialized, larger, or harder to explain in a first environmental panel.

---

## 3. Final MVP selection (1–2 products)

### MVP product A — **Filtered horizontal flow: `UMNLDF` + `VMNLDF`**

Treat **one MVP “variable”** as the **paired** filtered velocities (2D + time, no vertical index).

- **Why:** Strongest **mechanical** link to **large-scale motion** (wind, circulation, setup) that may correlate with **low-frequency, cable-coherent** DAS appearance. “Filtered” fields are **smoother** and better matched to **hours-scale** model output than raw turbulent fluctuations.
- **Thesis story:** Environmental branch: “background hydrodynamics may structure part of the cable-wide response.”
- **Viewer (later):** **Map:** quiver or speed raster after interpolating both components to **`(M,N)`** cell centres; **fiber:** time series of u, v or speed along the cable.
- **Why not `U1`/`V1` first:** **75× larger** per timestep; vertical choice is an extra free parameter. Upgrade path: add **one layer** from `U1`/`V1` if depth-resolved flow is required.

### MVP product B — **`THERMOCLINE`**

- **Why:** **Scalar**, **2D + time**, already on **`(M,N)`** — **minimal preprocessing** for maps and fiber sampling. Directly supports **stratification / internal-wave** interpretations that are **distinct from whale** narratives. PyLake-derived field is **explicitly environmental**.
- **Thesis story:** “When / where the water column was stratified (thermocline depth) may relate to low-frequency coherent structure.”
- **Viewer (later):** **Map** (depth in m, mask `_FillValue`); **fiber** time series; optional **sync** with DAS cursor.
- **Why not `R1` temperature as MVP B:** **3D** storage; need a **layer rule** and units cleanup. **`THERMOCLINE`** is **one layerless field** with clear meaning. **`S1`** is a good **alternate** if thermocline is noisy — barotropic **water level** is very intuitive but overlaps somewhat with flow-driven setup; still only **one** scalar map.

---

## 4. Compact backend export design (exact names)

All paths under `output/environmental/` (gitignored if `/output/` ignored). Use **`float32`**, **decimate time** if merged runs exceed viewer needs.

### `environmental_mvp_meta.json`

```json
{
  "schema_version": "environmental_mvp_v1",
  "source_nc": ["Models.delft3dflow_zurich_20220123.nc"],
  "model": "Delft3D-FLOW Z-model",
  "time_units": "seconds since 2008-03-01 00:00:00",
  "grid": { "M": 212, "N": 34, "n_time": 56, "dt_h_approx": 3.0 },
  "horizontal_coords_ref": "XZ_YZ_metres_model_frame",
  "crs_alignment_status": "pending_transform_to_CH1903_LV95",
  "mvp_variables": {
    "u_filtered": { "nc_name": "UMNLDF", "units": "m/s", "stagger": "MC_N_to_MN_average" },
    "v_filtered": { "nc_name": "VMNLDF", "units": "m/s", "stagger": "M_NC_to_MN_average" },
    "thermocline_depth": { "nc_name": "THERMOCLINE", "units": "m", "fill_value": -999 }
  }
}
```

### `environmental_fiber_timeseries.npz` (primary deliverable)

| Array | Shape | Description |
|-------|-------|-------------|
| `time_s` | `(Nt,)` | Model time (seconds since same epoch as NC) |
| `along_m` | `(Nf,)` | Cumulative distance along fiber polyline (after CRS fix) |
| `u_face` | `(Nt, Nf)` | U at face after stagger interpolation |
| `v_face` | `(Nt, Nf)` | V at face |
| `thermocline_m` | `(Nt, Nf)` | Thermocline depth; NaN where fill/mask |

**Frontend:** Sparklines, DAS-aligned time slider (after time mapping).

### `environmental_map_fields.npz` (optional, same `Nt`)

| Array | Shape | Description |
|-------|-------|-------------|
| `XZ`, `YZ` | `(M, N)` | `float32` cell centres |
| `u_face_t`, `v_face_t` | `(Nt, M, N)` or **subset** `t_indices` + `(K, M, N)` | If too large, store **every 6th** timestep only |
| `thermocline_t` | `(Nt, M, N)` | Same decimation |

**Frontend:** Raster under/over `situation.json` bathymetry **after** CRS alignment.

### `environmental_notes.json`

Plain-text bullets: model vs observations, **no causal claim** DAS band = current, thermocline definition (PyLake), fill values.

---

## 5. Interpolation / feasibility

| Task | Feasibility | Notes |
|------|-------------|--------|
| **Stagger → face `(M,N)`** | **Required** | Average neighbouring `UMNLDF` onto `M,N` (standard Arakawa C practice); same for `VMNLDF`. Optionally rotate to **east/north** using **`ALFAS`** at cell centre for map arrows. |
| **Fiber ↔ model plane** | **Pending CRS** | Once fiber **E,N** and model **X,Y** are in one frame: **nearest** or **bilinear** in `(M,N)` index space after **KDTree** on `XZ,YZ`. |
| **Time ↔ DAS shot** | **Feasible** | Map model `time` + epoch to **UTC**; interpolate or **nearest** model step to DAS `t_s`. |
| **`THERMOCLINE` on fiber** | **Straightforward** | Same `(M,N)` sampling as any face field; mask `_FillValue`. |

**Observed in `Models.delft3dflow_zurich_20220123.nc`:** `UMNLDF` / `VMNLDF` are **all zero** in this export, while **`U1` / `V1`** carry physical horizontal velocities (dry/inactive points use **|U|,|V| ≈ 999** sentinels without a CF `_FillValue`). **`THERMOCLINE`** is **mostly -999** on many timesteps (often under **5%** finite cells), so 2D maps are **patchy** by nature -- not a frontend bug. The MVP exporter falls back to **`U1`/`V1`** on an auto-picked wet layer when filtered fields are empty; see `environmental_mvp_meta.json` `viewer_hints` for a reasonable default timestep.

**Primary viewer scalar (current exporter):** Because **`THERMOCLINE`** is too sparse for a first map, exports include **`temperature_t`** from **`R1[:,0,k,:,:]`** (NAMCON temperature) at the **same vertical index k** as the wet-layer rule used for **`U1`/`V1`** (~**39%** finite horizontal coverage after masking **−999**). **`thermocline_t`** remains in the bundle as a **secondary** diagnostic. **`S1`** (water level) has **~100%** grid coverage but only **~centimetre** range in the inspected window — poor visual signal compared to **R1** for the static viewer.

**Best first views:** **Hybrid** — **fiber time series** (tight coupling to DAS heatmap) + **one** coarsened **map** frame or small animation for defense / demo.

---

## 6. Next implementation step

1. **Resolve CRS:** Obtain model-LV95 mapping (or affine) from Delft3D project metadata.  
2. **Implement `export_environmental_mvp.py`:** Read chosen NC → compute `u_face`, `v_face` on `(M,N)` → sample along fiber → write `environmental_mvp_meta.json` + `environmental_fiber_timeseries.npz`.  
3. **Validate** one timestep visually (model thermocline vs rough expectation) before viewer wiring.

---

## References in-repo

- Full variable list: `docs/environmental_nc_inventory.md`
- Summarizer: `src/summarize_env_netcdf.py`
- Fiber / bathymetry export: `src/ingest_prototype.py` → `extract_situation`
