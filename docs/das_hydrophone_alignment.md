# DAS and hydrophone time alignment (Backend Task 2)

## What was wrong

For `whales_orca`, **candidate hydrophone events** (from `spectrogram.json` / `extract_events_baseline.py`) appeared near **45.9 s** and **51.1 s**, while **DAS preprocessed preview** and **DAS activity map** only covered about **0–44 s**. Event overlays on DAS were therefore **not interpretable**: the timelines did not overlap.

This was **not** a clock offset between recorders. Hydrophone `t_s` and DAS `t_s` both use **seconds from the start of the exported DAS / hydrophone segment** in the usual ingest pipeline. The gap came from **truncating DAS** earlier than the hydrophone analysis window.

## Root cause

In `src/preprocess_das.py`, the selected DAS interval was limited by defaults:

1. **`--duration-s`** defaulted to **45 s** → target end index `45 × 5000 = 225000` samples.
2. **`--max-samples`** defaulted to **220000** → the interval was **further clipped** to 220000 samples.
3. At **5000 Hz**, **220000 samples = 44 s** of DAS, so exports ended near **44 s** even though the Orca HDF5 `DAS` dataset contains **511009** samples (~**102.2 s**).

Hydrophone spectrogram/score uses the **full** recorder timeline available in ingest (longer than 44 s for Orca), so events after 44 s were valid on the hydrophone axis but **outside** the truncated DAS export.

## Fix applied (minimal)

Defaults were changed so that, **unless explicitly clipped**, preprocessing uses the **full DAS trace stored in the shot HDF5**:

| Argument | Old default | New default |
| --- | --- | --- |
| `--duration-s` | `45` | **`0`** → if `<= 0`, use from `--start-s` through **end of `DAS` dataset** |
| `--max-samples` | `220000` | **`0`** → **no** extra sample cap |

Optional dev clipping is still available, e.g. `--duration-s 45 --max-samples 220000`.

**Orca:** DAS preview/activity now span the **full ~102 s** available in the file, covering the candidate events near 46 s and 51 s.

**Humpback:** DAS in the HDF5 is shorter (**166369** samples ≈ **33.27 s**); “full file” mode simply uses that entire segment (unchanged interpretability, slightly clearer semantics).

## Valid synchronization range (after fix)

- **DAS preview (`t_s` in `das_preprocessed_preview.npz`):** `[0, T_das_preview]` with `T_das_preview ≈ (n_selected_samples / fs) / preview_downsample` on the preview grid; the **underlying** interval end is `end_time_s` in `das_preprocessing_metadata.json`.
- **DAS activity map (`t_windows_s` in `das_activity_map.npz`):** rolling window centers inside that interval (slightly inset from edges depending on window/hop).
- **Hydrophone score (`t_s` in `hydrophone_event_score.npz`):** full STFT frame times from `spectrogram.json` (often **longer** than DAS for Orca).

**Overlap:** Hydrophone and DAS share a **common overlap interval** `[0, min(T_hydro, T_das)]`. For Orca, **candidate events** should lie in **`[0, T_das]`** so DAS overlays are meaningful. Any hydrophone content **after** the last DAS sample still has **no** DAS counterpart (physical recording length limit, not a bug).

Alignment metadata in `hydrophone_event_score_metadata.json` (`time_alignment_with_das_activity`) is updated when you re-run `extract_events_baseline.py` after rebuilding `das_activity_map.npz`.

## Validation figure

```bash
python3 src/plot_das_hydrophone_alignment.py --shot whales_orca
```

Writes `figures/shots/whales_orca/orca_alignment_check.png` (and `das_hydrophone_alignment.png` for Humpback).

## Remaining shot-specific limits

- **`whales_humpback`:** The HDF5 `DAS` trace is **shorter** (~33.3 s) than the hydrophone STFT timeline (~41 s). At least one candidate event can extend **slightly past** the last DAS sample (e.g. an interval ending near **34 s** while DAS ends near **33.3 s**). That is a **recording coverage** limit, not clipping from `preprocess_das.py`. `check_viewer_ready.py` reports `candidate_events_fully_inside_das_preview: false` when any event is not fully contained.
- **`whales_orca`:** With full-file DAS, candidate events near **46 s** and **51 s** lie **inside** the DAS preview; hydrophone still runs ~**5 s longer** than DAS at the tail (~107 s vs ~102 s).

## Frontend implications

- Use **`das_preprocessing_metadata.json`** / NPZ `t_s` as the **authoritative DAS time extent**.
- Treat hydrophone score as **support** on its own `t_s`, intersecting with DAS for synchronized views.
- Do not assume DAS and hydrophone durations are equal; **clip** or **gray-out** hydrophone-only tail when DAS ends earlier.

## How to reproduce the fix

```bash
python3 src/preprocess_das.py --shot whales_humpback
python3 src/preprocess_das.py --shot whales_orca
python3 src/build_das_activity_map.py --shot whales_humpback
python3 src/build_das_activity_map.py --shot whales_orca
python3 src/extract_events_baseline.py --shot-dir output/shots/whales_humpback
python3 src/extract_events_baseline.py --shot-dir output/shots/whales_orca
python3 src/plot_das_hydrophone_alignment.py --shot whales_orca
python3 src/check_viewer_ready.py
```
