# Static site (Sprint 2 - Frontend Steps 6-7 synchronized views)

This directory contains the frontend synchronized viewer for the thesis MVP scope.

## Local serving — canonical launch

The frontend is **pure static**: no Vite, no npm, no backend. It only needs a
plain HTTP server (browsers refuse `fetch()` over `file://`).

### Mode A — recommended

```bash
# from the repository root
python -m http.server 8000 --directory site
# open http://localhost:8000/
```

This works because the repo commits two symlinks:

- `site/output -> ../output`
- `site/output_samples -> ../output_samples`

If your clone preserved them (default on macOS/Linux with `core.symlinks=true`),
the viewer can read generated local artifacts while the URL stays at the port
root.

### Mode B — repository root fallback

```bash
# from the repository root
python -m http.server 8000
# open http://localhost:8000/site/
```

In this mode the server's document root **is** the repository root, so the
viewer can read `output/`, `output_samples/`, `figures/`, etc. directly. **No
symlinks required.**
Use this fallback on Windows or any clone where the `site/output` symlinks are
missing.

### Required folder structure

Working copy must contain (next to the repo root):

```
output/                            # gitignored; create with the Python pipeline
  viewer_index.json
  shots/whales_humpback/...        # viewer_manifest.json + JSON/NPZ exports
  shots/whales_orca/...
output_samples/shots/.../*.json    # tiny fallback samples (committed)
site/                              # this directory (with the symlinks above)
```

If `output/` is missing the viewer falls back to the `output_samples/` JSONs and
shows a readable status; per-panel errors list the URLs that were tried.

### Asset resolver and diagnostics

`site/app.js` probes a small ordered list of base URLs for every asset kind
(`output`, `samples`, `env`) and **locks the first base that succeeds** for the
session, so subsequent loads are direct. Open DevTools → Console to see:

- `[asset:output] base locked → ../output (via viewer_index.json)`
- `[asset] locked bases { output, samples, env }`
- per-asset `OK` / `fail (...)` lines
- a final list of any unresolved assets

The resolver state is also live on `window.assetDiagnostics` for ad-hoc
inspection (e.g. `assetDiagnostics.summary()` in the console).

## Current contents

- `index.html`: existing layout with synchronized render containers.
- `styles.css`: dark scientific UI theme and panel/component styling.
- `app.js`: synchronized interval handling, panel rendering, playback, and event navigation.
- `vendor/fflate.min.js`: tiny unzip helper for NumPy `.npz` (ZIP) loads in the browser.

## Implemented synchronized views

The same selected interval (`start` / `end`) now drives all three panels:

- DAS context panel:
	- renders `viewer/das_activity.json` heatmap when available,
	- provides an **Activity / Waterfall** toggle,
	- **Activity** is the processed aggregated DAS activity map (`das_activity_map.npz` fallback),
	- **Waterfall** uses `das_waterfall_preview.npz` when available: teacher-style native raw DAS counts, first 30k raw samples by default, all channels, sample index on x, channel index on y, and diverging amplitude color; it falls back to `das_preprocessed_preview.npz` only when the raw waterfall artifact is missing,
	- shows shared interval and shared playback cursor,
	- falls back to metadata mode when DAS export is unavailable.
- Hydrophone support view:
	- renders score timeline from `hydrophone_activity.json` when available,
	- overlays selected interval and candidate event spans,
	- falls back to interval + event guidance mode when timeline is unavailable.
- Map/spatial context view:
	- renders source/recorder positions from `shot_metadata.json`, `recorders_summary.json`, and manifest source ground truth,
	- displays synchronized interval context,
	- falls back to metadata-only mode when spatial coordinates are unavailable.
- Selected-channel DAS panel:
	- loads `selected_channels_index.json` when present (multiple preview columns), otherwise the legacy single triple `selected_channel_*.npz`,
	- shows spectrogram, band-pass **support** score (with threshold and optional mask), and waveform; **Preview column** dropdown appears for multi-channel shots (Orca exports resolve NCC-related raw anchors including **~920** (second hotspot) and **859–862** neighborhood plus **861** / default **~860**; exact mapping is in `selected_channels_index.json` after `build_selected_channel_bundle.py`),
	- for single-channel shots, it loads the default selected channel without showing a selector.
	- shot-specific display-only spectrogram enhancements improve readability while preserving interaction behavior:
		- Orca: 1500–2500 Hz focus + robust clipping + stronger per-frequency background suppression
		- Humpback: 20–1400 Hz focus + robust clipping + lighter per-frequency background suppression
	- **Orca-only demo audio** (after rebuilding `build_selected_channel_bundle.py`): the selected-channel panel shows **Audio (demo / inspection)** controls. **Play DAS (band-pass)** uses `bandpass_waveform` from the signal NPZ (~5 kHz native rate) when present, else median-centered wideband `signal`. **Play source (reference)** loads `orca_source_segment.wav` (~50 kHz) via `orca_audio_compare.json` from the manifest. This is for comparing **dataset reference vs received DAS channel**, not for claiming natural underwater whale sound.

## Synchronization behavior

- Shot selector updates all panels and metadata.
- Interval input supports explicit apply/reset controls and clamps to valid shot bounds.
- Playback controls are intentionally de-emphasized in Step 6; the viewer keeps a static shared cursor and defers full playback behavior to later steps.
- Candidate events are shown as navigation chips in the sidebar.
- Clicking an event chip snaps interval and cursor to that event.

## Step 7 interval interaction workflow

- Interval selection:
	- set start/end seconds in controls,
	- click "Apply interval" (or press Enter in either input),
	- values are clamped to available time range and synchronized across DAS/hydro/map/sidebar.
- Candidate event navigation:
	- event chips are clickable,
	- clicking a chip updates interval around the event and moves shared cursor to event center,
	- active event (at cursor time) is shown in the sidebar.
- Synchronized cursor movement:
	- click inside DAS heatmap to move shared cursor,
	- click inside hydrophone view to move shared cursor,
	- click or drag inside selected-channel canvases to move the shared cursor,
	- lightweight drag-to-seek is supported in DAS and hydro views.
- Map-assisted selected-channel switching:
	- for multi-channel selected-channel shots, click near the fiber on the map to snap to the nearest available exported selected channel,
	- this reuses the same selected-channel state as the dropdown selector and updates the dropdown value.
- Interactive feedback:
	- current interval and cursor time are always visible,
	- active event updates as cursor moves,
	- all panels re-render immediately when interval/cursor changes.

## Data loading behavior

### Full bundle mode (preferred)

For each selected shot, frontend attempts to load:

- `../output/shots/<shot_id>/viewer_manifest.json`
- files listed in manifest (`shot_metadata`, `recorders_summary`, `events`, `hydrophone_activity`, `das_activity`, `situation`)
- if `viewer/das_activity.json` / `hydrophone_activity.json` are absent, the viewer falls back to `das_activity_map.npz` and `hydrophone_event_score.npz` in the shot directory (plus optional `hydrophone_event_score_metadata.json` for the threshold line)
- `files.das_waterfall_preview` when present, currently `das_waterfall_preview.npz`; if it is missing, Waterfall mode falls back to `das_preprocessed_preview.npz` and otherwise shows “Waterfall preview not available. Run backend export.”
- optional selected-channel NPZs when present (see `selected_channel_demo` in the manifest)

### Fallback mode

If full viewer manifest is missing, frontend attempts:

- `../output_samples/shots/<shot_id>/shot_metadata.json`
- `../output_samples/shots/<shot_id>/recorders_summary.json`
- `../output_samples/shots/<shot_id>/events.json`

Fallback mode keeps synchronized interval/events but uses metadata-driven placeholders for unavailable full exports.

## Known simplifications

- Selected-channel `.npz` parsing supports the dtypes used in current exports (`float32` time series, `uint8` mask, etc.); exotic dtypes may require extending `parseNpyArrayBuffer`.
- DAS activity and hydro **main** panels can use JSON compatibility exports when present, with NPZ fallback (`das_activity_map.npz`, `hydrophone_event_score.npz`) when JSON is absent.
- DAS Waterfall mode is an interpretable cable-wide context view, not whale detection. It uses symmetric robust clipping (2nd/98th percentile by visible interval) so broad channel structure and red/blue amplitude deviations remain visible without letting outliers dominate.
- Map panel currently renders lightweight source/recorder context, not full bathymetry/fiber-track geometry rendering.

## Local testing

Run a static server from repository root:

```bash
python -m http.server 8000 --directory site
```

Open:

- `http://localhost:8000/`

Avoid `file://` opening because browser fetch restrictions can block local JSON loading.

## Scope notes

- Frontend-only update for Sprint 2 Step 6.
- Backend scripts and output generation are unchanged.
- No ML, no whale classification logic.
- Whales subset focus (`whales_humpback`, `whales_orca`).
