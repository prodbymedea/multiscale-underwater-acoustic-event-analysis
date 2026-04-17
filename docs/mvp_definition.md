# MVP definition

## Goal

**Multiscale, DAS-centered visualization and event-oriented exploration** for a distributed underwater acoustic monitoring scenario (DAS + hydrophones), using the public **DASLakeZurich** dataset. The focus is a reproducible pipeline and a clear, thesis-appropriate MVP scope for this specific dataset—not operational deployment.

The MVP is no longer defined as a collection of static plots only. Its intended direction is an **interactive visual analysis prototype**, where the user can inspect how event-related activity develops over time, along the fiber, and in spatial context.

## In scope (current MVP)

- **Ingest / export:** HDF5 → compact JSON-friendly summaries (`src/ingest_prototype.py`).
- **Quick plots:** Matplotlib inspection of exports, including improved DAS scaling (`src/visualize_export.py`).
- **Shot screening:** Compare a few shots; write per-shot figures under `figures/shots/<slug>/` (`src/screen_shots.py`).
- **Baseline events:** Simple hydrophone-spectrogram activity detector with MAD thresholding; optional DAS hint only (`src/extract_events_baseline.py`).
- **Documentation:** Subset choice, event definition, project scope, dataset overview, and data policy (`docs/`, `data/README.md`).

## Updated MVP direction

The MVP should now move toward:

- **DAS-centered visualization** as the main product focus.
- **Synchronized views** across DAS, hydrophone support data, and spatial context.
- **Time interval selection**, so the user can inspect a selected interval (for example, 30 seconds).
- **Event score / confidence-like representation** over time, rather than only binary event intervals.
- **Map + DAS + time-based exploration**, instead of relying only on static PNG outputs.

In this direction, hydrophone data remain useful, but mainly as:
- a reference timing source,
- a support signal for interpretation,
- and a synchronized secondary view.

The main visual contribution of the MVP should remain DAS-centered.

## In scope for the next MVP iteration

The next practical MVP iteration should include:

- selected-shot exploration rather than full-dataset processing;
- synchronized DAS + hydrophone + map views;
- interval-based navigation;
- baseline candidate events for navigation;
- continuous score/confidence-like event interpretation;
- DAS activity visualization that is more interpretable than raw amplitude alone.

## Out of scope (explicitly not MVP)

- Machine learning classification (species, vessel vs. whale, etc.).
- Full real-time analytics or streaming system.
- Production backend, database, authentication, or deployment infrastructure.
- A universal DAS visualization platform for arbitrary datasets.
- A fully validated whale-probability model.
- Committing raw HDF5, ZIPs, or large generated JSON to Git.

## Primary assets for demos

- **Shot:** `whales_humpback` (`2022-01-26--04-46-16--Humpback.h5`).
- **Illustrative outputs:** `figures/shots/whales_humpback/`, `output_samples/shots/whales_humpback/`.

## Current interpretation of events

At the current stage:
- binary candidate events are still useful for navigation;
- hydrophone spectrogram activity is used as a baseline timing guide;
- DAS is the main target visual modality;
- future event representation should move toward **continuous score / confidence-like interpretation** and stronger DAS involvement.

## Future extension (not implemented)

- Static or lightweight interactive demo on **GitHub Pages** from `site/`.
- Synchronized interval-based viewer with:
  - DAS activity view,
  - hydrophone support view,
  - and map-based spatial context.
- More explicit DAS activity / confidence representation instead of static amplitude-only views.
