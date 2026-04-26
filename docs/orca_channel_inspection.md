# Orca single-channel DAS inspection (Backend Task 1)

## Update (Backend Task 2)

The **0–44 s vs ~46–51 s hydrophone event** mismatch was caused by **default DAS clipping** in `preprocess_das.py` (`duration-s` + `max-samples`), not by inconsistent time axes. Defaults now use the **full DAS trace in the HDF5** so Orca events and DAS overlays align. See **`docs/das_hydrophone_alignment.md`**.

## Why this was done

Supervisor feedback noted that **orca** energy may be easier to interpret on a **single DAS channel** (time series + spectrogram / band energy) than on the **aggregated normalized activity heatmap**. This note documents a reproducible diagnostic for `whales_orca` only: it does **not** change preprocessing or activity-map code.

## Data window and alignment

**After Backend Task 2**, DAS preprocessing defaults load the **full Orca DAS segment** (~0–102 s in the HDF5), so candidate hydrophone events near **46 s** and **51 s** fall **inside** the DAS-supported window. See `docs/das_hydrophone_alignment.md`.

If you still see `events_outside_das_preview: true` in `channel_inspection_summary.json`, re-run `src/inspect_orca_channels.py` after regenerating `das_preprocessed_preview.npz`, or confirm you did not clip DAS with `--duration-s` / `--max-samples`.

## DAS preview structure confirmed

From `das_preprocessed_preview.npz` (`whales_orca`):

- **Keys:** `raw_preview`, `preprocessed_preview`, `t_s`, `channel_indices`, `distances_m`
- **Shape:** `[n_time, n_channels]` = `[22000, 190]` (10× temporal downsampling from 5 kHz → ~500 Hz preview)
- **Channels:** 190 subsampled physical channels (`channel_step=5` in preprocessing metadata); column `j` maps to raw index `channel_indices[j]` and distance `distances_m[j]`.

## Channels examined

Four **preview column indices** were chosen (deduplicated):

1. **Spatial:** near fiber start (`j=0`), middle (`j=95`), end (`j=189`).
2. **Activity-based:** `j` with highest **mean normalized** rolling-RMS activity (here **`j=50`**).
3. **Event hints:** `das_support.peak_std_channel_index` from `events.json`, mapped onto preview columns via `channel_indices` (for Orca both events pointed near the **start** of the fiber; nearest preview columns coincide with small indices).

## Rankings (heuristic)

The script ranks candidates using a **composite score** (not ML): weighted combination of mean normalized activity, correlation of smoothed `|x|` with interpolated hydrophone support score on the DAS time grid, event-interval energy fraction (zero here because events are outside the DAS window), and a simple contrast metric.

**Result (this workspace):**

| Rank | Preview col | Raw DAS ch | ~Distance (m) | Comment |
| --- | --- | --- | --- | --- |
| 1 | **50** | 250 | mid-cable | Strongest mean activity; default recommendation for a “selected channel” UI. |
| 2 | **189** | 945 | far end | Second by score; stronger hydro–DAS correlation on the shared DAS preview grid (re-rank after alignment fix if needed). |
| 3 | **0** | 0 | near start | Matches `das_support` hints for events (but events sit outside DAS window). |
| 4 | **95** | 475 | mid | Moderate activity. |

Exact metrics: `output/shots/whales_orca/channel_inspection_summary.json`.

## Figures

Per-channel combined diagnostics:

- `figures/shots/whales_orca/channel_<j>_diagnostic.png`

Each figure includes: raw vs preprocessed trace, band-limited energy, channel spectrogram at preview rate, hydrophone score interpolated to DAS time, per-channel activity trace, and a small activity-map thumbnail with the fiber distance marker.

## Answers to the supervision questions

1. **Is Orca more visible on a single channel than on the aggregated map?**  
   On the **DAS preview interval**, single-channel **spectrograms and traces** expose **time–frequency structure** that is **compressed** in the heatmap (per-channel normalization + coarse rolling window). Whether that structure is “Orca” is **not** asserted from DAS alone.

2. **Does the activity map obscure interpretable structure?**  
   **Partially yes:** the map is useful for **where** along the cable energy is elevated over ~0.5 s windows, but **fine-scale** patterns and **frequency content** are easier to see on **one channel**. Per-channel normalization can also make **relative** cross-channel comparison harder than a raw or z-scaled channel view.

3. **Reasonable frontend channel candidates?**  
   **Primary:** preview column **50** (strong mean activity). **Second:** **189** (good score correlation on the shared window). **Backup:** **0** (spatially consistent with `das_support` hints). Re-run `inspect_orca_channels.py` after pipeline changes to refresh rankings.

## Frontend implications

- **Primary:** “Selected channel” mode: waveform + spectrogram + optional band energy.
- **Map interaction:** click near fiber → jump to nearest preview column / raw channel index.
- **Aggregated heatmap:** keep as **context** (spatial overview), not the only Orca-facing view.

## Stale `channel_<n>_diagnostic.png` files

The inspection script only regenerates figures for its **current candidate set** (spatial samples, **current** activity-map argmax column, and event hints). After a full-range DAS rebuild, the **activity peak preview column can change** (e.g. from 50 to 12). Older PNGs such as `channel_50_diagnostic.png` are then **left on disk unchanged** and can still show the **pre-alignment ~44 s** window if they were last written before the fix.

To refresh a specific column (e.g. 50 for comparison to earlier notes):

```bash
python3 src/inspect_orca_channels.py --extra-preview-cols 50
```

Figures now pin the shared time axis to the DAS preview `t_s` range and print that range in the top panel title.

## How to reproduce

From the repository root (requires existing `output/shots/whales_orca` artifacts from preprocessing + activity map + events + hydrophone score):

```bash
python3 src/inspect_orca_channels.py
python3 src/inspect_orca_channels.py --shot-dir output/shots/whales_orca
python3 src/inspect_orca_channels.py --extra-preview-cols 50
```

## Recommended next backend step

**Orca channel-level exports** for the viewer (waveform + spectrogram for a default channel) and/or **band-pass tuning** for clearer call structure—now that DAS and hydrophone timelines **overlap** for candidate events (`docs/das_hydrophone_alignment.md`). Optionally add **raw-scale** or **shared-gain** panels alongside the normalized activity map for demos.
