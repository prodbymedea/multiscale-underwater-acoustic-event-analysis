# Static site (Sprint 2 - Frontend Step 6 synchronized views)

This directory contains the frontend synchronized viewer for the thesis MVP scope.

## Current contents

- `index.html`: existing layout with synchronized render containers.
- `styles.css`: dark scientific UI theme and panel/component styling.
- `app.js`: synchronized interval handling, panel rendering, playback, and event navigation.

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

## Synchronization behavior

- Shot selector updates all panels and metadata.
- Interval input updates all panels immediately.
- Playback controls are intentionally de-emphasized in Step 6; the viewer keeps a static shared cursor and defers full playback behavior to later steps.
- Candidate events are shown as navigation chips in the sidebar.
- Clicking an event chip snaps interval and cursor to that event.

## Data loading behavior

### Full bundle mode (preferred)

For each selected shot, frontend attempts to load:

- `../output/shots/<shot_id>/viewer_manifest.json`
- files listed in manifest (`shot_metadata`, `recorders_summary`, `events`, `hydrophone_activity`, `das_activity`, `situation`)

### Fallback mode

If full viewer manifest is missing, frontend attempts:

- `../output_samples/shots/<shot_id>/shot_metadata.json`
- `../output_samples/shots/<shot_id>/recorders_summary.json`
- `../output_samples/shots/<shot_id>/events.json`

Fallback mode keeps synchronized interval/events but uses metadata-driven placeholders for unavailable full exports.

## Known simplifications

- Browser-side `.npz` parsing is not used in this step.
- DAS and hydro panels depend on JSON viewer exports (`viewer/das_activity.json`, `hydrophone_activity.json`).
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
