# MVP definition

## Goal

**Multiscale visualization and baseline candidate-event screening** for a distributed underwater acoustic monitoring scenario (DAS + hydrophones), using the public **DASLakeZurich** dataset. The focus is a reproducible pipeline and clear MVP scope for a thesis project—not operational deployment.

## In scope (current MVP)

- **Ingest / export:** HDF5 → compact JSON-friendly summaries (`src/ingest_prototype.py`).
- **Quick plots:** Matplotlib inspection of exports, including improved DAS scaling (`src/visualize_export.py`).
- **Shot screening:** Compare a few shots; write per-shot figures under `figures/shots/<slug>/` (`src/screen_shots.py`).
- **Baseline events:** Simple hydrophone-spectrogram activity detector with MAD thresholding; optional DAS hint only (`src/extract_events_baseline.py`).
- **Documentation:** Subset choice, event definition, and data policy (`docs/`, `data/README.md`).

## Out of scope (explicitly not MVP)

- Machine learning classification (species, vessel vs. whale, etc.).
- Full waveform-based or DAS-primary detectors.
- Real-time streaming, database backend, or production auth.
- Committing raw HDF5, ZIPs, or large generated JSON to Git.

## Primary assets for demos

- **Shot:** `whales_humpback` (`2022-01-26--04-46-16--Humpback.h5`).
- **Illustrative outputs:** `figures/shots/whales_humpback/`, `output_samples/shots/whales_humpback/`.

## Future extension (not implemented)

- Static demo on **GitHub Pages** from `site/` (placeholder only).
