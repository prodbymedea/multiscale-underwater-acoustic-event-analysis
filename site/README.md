# Static site (Sprint 2 - Frontend Steps 6-7 synchronized views)

This directory contains the frontend synchronized viewer for the thesis MVP scope.

## Current contents

- `index.html`: existing layout with synchronized render containers.
- `styles.css`: dark scientific UI theme and panel/component styling.
- `app.js`: synchronized interval handling, panel rendering, playback, and event navigation.
- `vendor/fflate.min.js`: tiny unzip helper for NumPy `.npz` (ZIP) loads in the browser.

## Implemented synchronized views

The same selected interval (`start` / `end`) now drives all three panels:

- DAS activity view (primary panel):
	- renders `viewer/das_activity.json` heatmap when available,
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
- Map panel currently renders lightweight source/recorder context, not full bathymetry/fiber-track geometry rendering.

## Local testing

Run a static server from repository root:

```bash
python -m http.server 8000
```

Open:

- `http://localhost:8000/site/`

Avoid `file://` opening because browser fetch restrictions can block local JSON loading.

## Scope notes

- Frontend-only update for Sprint 2 Step 6.
- Backend scripts and output generation are unchanged.
- No ML, no whale classification logic.
- Whales subset focus (`whales_humpback`, `whales_orca`).
