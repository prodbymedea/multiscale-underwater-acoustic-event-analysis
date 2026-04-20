# Static site (Sprint 2 - Frontend Step 5 skeleton)

This directory now contains the initial static website skeleton for the thesis demo viewer.

## Current contents

- `index.html`: viewer page structure and layout regions.
- `styles.css`: static responsive styling (DAS panel visually primary).
- `app.js`: lightweight metadata loading and UI state wiring.

## What the skeleton includes

- Header with project/demo title and Whales-subset MVP subtitle.
- Shot selector.
- Interval selector (`start` / `end` seconds).
- Playback controls (`Play` / `Pause`) with visible state text.
- Main layout panels:
	- DAS activity panel (primary, largest panel).
	- Hydrophone support panel (secondary).
	- Map/spatial context panel.
	- Sidebar metadata/event summary.

## Metadata loading behavior

The frontend tries to load viewer-oriented outputs in this order:

1. `../output/viewer_index.json` (preferred if present)
2. `./data/viewer_index.json`
3. `output/viewer_index.json`

If no viewer index is found, it falls back to shot IDs:

- `whales_humpback`
- `whales_orca`

For each selected shot, it tries to load:

- `../output/shots/<shot_id>/viewer_manifest.json` (and equivalent fallback bases)

When manifest data are available, the sidebar shows:

- selected shot id,
- available time range,
- recommended default interval,
- event count,
- source ground-truth availability,
- manifest file-key summary.

Event count is read from manifest if available, otherwise the app tries to read the `events.json` file referenced by `manifest.files.events`.

## Placeholders by design (deferred)

This step is a frontend scaffold only. The following are intentionally placeholders:

- DAS heatmap rendering pipeline.
- Hydrophone support plot rendering.
- Map rendering (fiber/source/bathymetry drawing).
- Full playback timeline animation and synchronized cursoring.
- Browser adapters for `.npz` assets.

## Local testing

Use a local static server from repository root (recommended, avoids `file://` fetch restrictions):

```bash
python -m http.server 8000
```

Then open:

- `http://localhost:8000/site/`

If opened directly via `file://`, browser security policies may block JSON fetches and the app will run in fallback/placeholder mode.

## Scope notes

- Frontend-only change for Sprint 2 Step 5.
- No backend script updates.
- No ML/classification logic.
- Whales subset focus for the viewer skeleton.
