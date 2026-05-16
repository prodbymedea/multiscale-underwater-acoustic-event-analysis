# Sample pipeline outputs (small files only)

This folder holds **tiny JSON excerpts** so the repository stays lightweight without raw HDF5 or multi‑MB exports.

| Path | Contents |
|------|----------|
| `shots/whales_humpback/` | `shot_metadata.json`, `recorders_summary.json`, `events.json` (baseline detector output) |
| `shots/whales_orca/` | Same trio for the secondary shot |

**Not included here (too large for Git):** `das_preview.json`, `spectrogram.json`, `waveform.json`, `situation.json`. Generate them with `src/ingest_prototype.py` after downloading the Zenodo dataset (see `data/README.md`).

To **re-run** `src/extract_events_baseline.py`, you need a full export directory that includes **`spectrogram.json`** (e.g. `output/shots/whales_humpback/` after ingest).
