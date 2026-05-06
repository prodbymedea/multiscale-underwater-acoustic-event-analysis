# System Inputs and Outputs

## Purpose
This document defines the main inputs and outputs of the current project pipeline.

Its purpose is to clarify:
- what data enter the system,
- what intermediate artifacts are produced,
- what the **interactive viewer** consumes,
- and what the final project output is.

## System inputs

### 1. Selected shot file
A selected shot-based `.h5` file from the DASLakeZurich dataset.

This is the main raw input for the current pipeline.

Examples:
- `whales_humpback`
- `whales_orca`
- `morning_00`

These files contain:
- DAS data,
- hydrophone data,
- source-related data (where present in the file),
- and metadata attributes.

### 2. Spatial context file
`Situation.h5`

This file provides the map-related and geometry-related context needed for visualization, including:
- bathymetry,
- fiber track,
- boat tracks,
- and related spatial metadata.

### 3. Optional preprocessing parameters
The system may also use configurable preprocessing parameters, for example:
- selected frequency range,
- downsampling factors,
- filtering parameters,
- event score parameters,
- thresholding parameters,
- selected channel or recorder.

These are not separate dataset files, but they act as input settings for the processing pipeline.

### 4. Optional selected time interval
In the interactive viewer, the user selects a time interval within a shot.

This interval drives synchronized rendering across DAS, hydrophone, map, and selected-channel panels.

## Intermediate outputs

The pipeline produces structured outputs under `output/shots/<shot_id>/` (and sample copies under `output_samples/` where used).

### Metadata and summaries
- `shot_metadata.json` — shot-level properties; may include **source/context** fields (e.g. source position when exported from ingest)
- `recorders_summary.json` — recorder/channel summary for the viewer

### Signal-based outputs
- `spectrogram.json`
- `waveform.json`
- `das_preview.json`
- `das_preprocessed_preview.npz`
- `das_activity_map.npz` — time × channel activity used for the **DAS heatmap context layer** in the viewer (normalized rolling RMS or equivalent; see preprocessing docs)

By default, the preprocessed DAS preview spans the **full `DAS` time span** in the shot HDF5 (optional clipping via `src/preprocess_das.py`); see `docs/das_hydrophone_alignment.md` for synchronization with hydrophone exports.

### Spatial output
- `situation.json` — map-ready spatial context derived from `Situation.h5`

### Event and hydrophone support outputs
- `events.json` — baseline candidate intervals (hydrophone-driven; navigation)
- `hydrophone_event_score.npz`
- `hydrophone_event_score_metadata.json`
- `viewer_event_guidance.json` — optional compact guidance for the viewer

### Viewer manifest
- `viewer_manifest.json` — lists paths to assets the static viewer loads (`shot_metadata`, `recorders_summary`, `events`, DAS activity, hydrophone activity, `situation`, etc.)

### Selected-channel exports (Orca and Humpback)

Built by `src/build_selected_channel_bundle.py` and referenced from `viewer_manifest.json` (e.g. `selected_channel_demo`, `selected_channel_mode_available`).

**Per-channel NPZs** (compact; no HDF5 in the browser):
- `selected_channel_p<preview_col>_signal.npz` — native-rate median-centered waveform for that preview column; **Orca** exports also include **`bandpass_waveform`** (same band as the band-pass score) for browser demo audio
- `selected_channel_p<preview_col>_spectrogram.npz` — STFT PSD in dB (`Sxx_db`)
- `selected_channel_p<preview_col>_bandpass_score.npz` — optional band-pass **support** score (MAD threshold metadata; **not** whale probability)

**Legacy-compatible filenames** (duplicate the **default** preview column’s triple for backward compatibility):
- `selected_channel_signal.npz`
- `selected_channel_spectrogram.npz`
- `selected_channel_bandpass_score.npz`

**Metadata:**
- `selected_channel_bundle.json` — schema `selected_channel_bundle_v1`: default preview column, raw channel index, distance along cable, recommended band-pass band, links to events/hydrophone score files, **`source_ground_truth`** block when available from `shot_metadata.json`

**Multi-channel index (when more than one preview column is exported):**
- `selected_channels_index.json` — schema `selected_channels_index_v1`: `default_preview_col`, list of `channels` with `preview_col`, `raw_das_channel_index`, `distance_m`, labels, and per-column NPZ filenames

The manifest may include `files.selected_channels_index` pointing to that index. The frontend loads the index when present and exposes a **Preview column** selector; otherwise it uses the legacy single triple.

**Default preview columns (builder + thesis-facing configuration):**
- **Orca:** `build_selected_channel_bundle.py` exports a Stage-2 multi-column set (e.g. preview columns **189, 12, 50**, plus configured extras) and appends **nearest preview-grid** columns for raw anchors **859, 861, 862, 920** (NCC hotspot coverage + legacy supervisor request for **861**; see `docs/orca_ncc_summary.md`). The **default** preview column is **172** when that index appears in the export list; otherwise the script falls back to a summary-driven recommendation or the first exported column. Confirm `default_preview_col` and per-channel `raw_das_channel_index` in the generated `selected_channels_index.json`.
- **Humpback:** default preview column **118** when present in the ranked export set (raw index **~590** in typical exports); additional columns come from event-aware ranking plus fixed extras in the builder.

Exact numeric mappings are always defined by the generated `selected_channel_bundle.json` / `selected_channels_index.json` for each shot build.

**Environmental Delft3D NetCDF (local `data/raw/environment/`, gitignored):** see `docs/environmental_nc_inventory.md` and `docs/environmental_data_audit.md`. After running `src/export_environmental_mvp.py`, compact MVP artifacts appear under **`output/environmental/`** (gitignored): `environmental_mvp_meta.json`, `environmental_map_fields.npz` (model-frame `XZ`/`YZ`, time, `u_face_t`/`v_face_t`, `thermocline_t`), and `environmental_fiber_timeseries.npz` (shared `time_s` plus **empty** fiber-aligned arrays until CRS alignment is validated).

**Orca source-vs-DAS demo audio (optional, after `build_selected_channel_bundle.py`):**
- `orca_source_segment.wav` — mono int16 WAV, experimental **Source** HDF5 segment aligned to `das_preprocessing_metadata.json` `selected_interval` (`start_time_s` / `end_time_s` on the DAS axis, resampled by sample index at source `Sample Rate (Hz)`).
- `orca_audio_compare.json` — schema `orca_audio_compare_v1`: paths, sample rate, interpretation notes; referenced from `viewer_manifest.json` as `files.orca_audio_compare`.

## Interactive viewer inputs

The static viewer (`site/`) loads, per shot:

1. **`viewer_manifest.json`** and files it references.
2. **DAS activity** — JSON (`viewer/das_activity.json`) or NPZ fallback (`das_activity_map.npz`).
3. **Hydrophone support** — JSON (`hydrophone_activity.json`) or NPZ fallback (`hydrophone_event_score.npz`, optional metadata for threshold display).
4. **Map/spatial context** — `situation.json` where available; map panel also uses `shot_metadata.json` / `recorders_summary.json` for recorder/source-style context (full bathymetry/fiber rendering may be partial; see `site/README.md`).
5. **Selected-channel assets** — `selected_channels_index.json` + per-column NPZs, or legacy `selected_channel_*.npz` triple.
6. **Orca demo audio** — when present, `orca_audio_compare.json` + `orca_source_segment.wav` for **inspection-only** playback in the selected-channel panel (Web Audio).
7. **Events** — `events.json` for navigation chips and interval snapping.

**Interaction:** For multi-channel selected-channel shots, **map click near the fiber** can snap the selected-channel panel to the nearest **exported** channel (same state as the dropdown), when implemented in `site/app.js`.

## Final output of the system

The final output of the project is an:

**interactive, map-first visual analysis prototype**

with synchronized panels: DAS **context** heatmap, hydrophone **support**, spatial/map context, **selected-channel** DAS inspection, and candidate-event navigation—aligned with the scoped claims in `docs/project_scope.md` and `docs/research_findings.md`.

## Input / output summary

### Inputs
- selected shot `.h5` file
- `Situation.h5`
- optional preprocessing parameters
- user-selected time interval (in viewer)

### Intermediate outputs (representative)
- `shot_metadata.json`, `recorders_summary.json`
- `spectrogram.json`, `waveform.json`, `das_preview.json`, `das_preprocessed_preview.npz`, `das_activity_map.npz`
- `situation.json`
- `events.json`, `hydrophone_event_score.npz`, `hydrophone_event_score_metadata.json`
- `viewer_manifest.json`
- `selected_channel_bundle.json`, optional `selected_channels_index.json`, `selected_channel_p*_*.npz`, legacy `selected_channel_*.npz`
- `orca_audio_compare.json`, `orca_source_segment.wav` (Orca, after selected-channel build)
- `output/environmental/environmental_mvp_meta.json`, `environmental_map_fields.npz`, `environmental_fiber_timeseries.npz` (optional; requires local `.nc`; fiber series intentionally empty pending CRS)

### Final output
- interactive viewer (`site/`) consuming the above exports

## Current note
The system supports:
- ingest,
- export,
- quick inspection,
- shot screening,
- baseline candidate-event generation,
- DAS activity map generation for viewer context,
- **selected-channel** multi-export bundles for **whales_orca** and **whales_humpback**,
- manifest-driven loading in the static viewer.

Future work may incorporate additional **environmental** or model-derived inputs **only** as real artifacts in this pipeline (no placeholder filenames in documentation).
