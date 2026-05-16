# MVP definition

## Goal

**Interactive, map-first visual analysis** of the public **DASLakeZurich** dataset, combining DAS, hydrophones, and spatial context for a **dataset-specific** thesis MVP—not operational deployment.

The MVP is an **interactive viewer** (static site under `site/`) backed by reproducible ingest/export scripts. The emphasis is on **interpretable exploration under known limitations**: low DAS acoustic sensitivity, **sparse** whale-related coupling limited to **selected channels**, and **no reliable cable-wide localization** as a core claim.

## In scope (current MVP)

- **Ingest / export:** HDF5 → compact JSON/NPZ summaries (`src/ingest_prototype.py`, preprocessing and activity exports).
- **Quick plots:** Matplotlib inspection of exports (`src/visualize_export.py`).
- **Shot screening:** Per-shot figures under `figures/shots/<slug>/` (`src/screen_shots.py`).
- **Baseline events:** Hydrophone-spectrogram activity score with MAD thresholding; intervals for navigation (`src/extract_events_baseline.py`).
- **Selected-channel bundles:** Per-preview-column NPZ exports and optional `selected_channels_index.json` for multi-channel shots (`src/build_selected_channel_bundle.py`).
- **Viewer bundle:** `viewer_manifest.json` and related paths (`src/build_viewer_bundle.py`).
- **Documentation:** Scope, events, system I/O, dataset notes, and research findings (`docs/`, `data/README.md`).

## Viewer direction (current and near-term)

The implemented and planned MVP behavior is aligned with:

- **Map-first interaction:** spatial panel for context; for multi-channel selected-channel shots, **map click near the fiber** can snap to the nearest **exported** selected channel (where implemented).
- **Selected-channel DAS inspection:** primary path for interpreting **sparse** whale-related evidence—waveform, spectrogram, and optional high-band **support** score (explicitly **not** whale probability).
- **Hydrophone as support/reference:** timeline score and candidate events for timing and navigation; not a claim of ground-truth whale labeling on DAS.
- **Source/context integration:** shot and recorder metadata and source ground-truth fields when present in exports (e.g. in `shot_metadata.json` / bundle metadata).
- **DAS activity heatmap as secondary context layer:** normalized rolling-RMS (or equivalent) **cable-wide** view for situational awareness; **not** oversold as a precise detector or as uniform sensitivity along the full cable.
- **Sparse whale-related visibility:** Orca-class shots may show clearer band-limited structure on **selected** channels; Humpback remains weaker/noisier on DAS in current processing—UI and docs stay consistent with that asymmetry.
- **Environmental / cable-along-track patterns:** treated as a **meaningful second branch** for future or parallel analysis (e.g. interpreting non-whale structure); not required to be fully implemented in the first viewer release, but within thesis scope as interpretive direction.

## Out of scope as core MVP deliverables

- **Reliable whale localization** or cable-wide whale **detection** validated on DAS.
- **Machine learning** classification (species, vessel vs. whale, etc.).
- Full real-time analytics or streaming.
- Production backend, database, authentication, or deployment infrastructure.
- A universal DAS visualization platform for arbitrary datasets.
- A fully calibrated whale-probability model.
- Committing raw HDF5, ZIPs, or large generated JSON to Git.

## Technical structure of the MVP output

The viewer synchronizes shot context, selected DAS channel, and (where available) event/navigation context across:

- DAS **context** panel (raw waterfall / fallback),
- hydrophone **support** panel,
- map/spatial panel,
- selected-channel panel (single or multi-preview-column via `selected_channels_index.json`).

Shot-specific **display-only** spectrogram enhancements in the selected-channel view improve readability without changing the underlying exported data.

## Primary assets for demos

- **Shots:** `whales_orca`, `whales_humpback` (and other exported shots as available).
- **Illustrative outputs:** `figures/shots/<slug>/`, `output/shots/<slug>/`, `output_samples/shots/<slug>/` as committed or generated locally.

## Current interpretation of events

- Binary candidate intervals remain useful for **navigation**.
- Hydrophone score is the main **baseline timing/support** layer.
- DAS **heatmap** supports context; **selected-channel** views carry the heavier interpretive weight for whale-related **sparse** evidence.
- Continuous scores should be read as **activity/support**, not species probability.

## Future extension (optional, not blocking MVP)

- Richer map layers (full bathymetry/fiber geometry rendering) if data and time allow.
- Stronger **environmental branch** tooling (auxiliary model inputs or derived fields) **only** when backed by real exports—no fictional artifacts in docs or manifest.
