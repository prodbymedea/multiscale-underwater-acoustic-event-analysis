# Baseline candidate event definition

Implemented in **`src/extract_events_baseline.py`**. This is a **candidate** generator for MVP exploration, not validated ground truth.

## Philosophy

- **Primary signal:** Hydrophone **STFT** already exported as `spectrogram.json` (Recorder **C**, preview channel **Tetra-Top**—same as ingest).
- **DAS:** Not used for detection. Optional **`das_support`** per event: distance bin with largest variability in `das_preview.json` over the event interval (supporting view only).

## Score (per STFT time frame)

1. Restrict frequencies to **[fmin, fmax]** Hz (default **30–1500** Hz).
2. **Score** = mean `Sxx_db` over retained frequency bins for that frame.

## Threshold

\[
\text{threshold} = \mathrm{median}(\text{scores}) + k \cdot 1.4826 \cdot \mathrm{MAD}(\text{scores})
\]

Default **k = 3**. MAD provides a robust spread estimate under heavy-tailed noise.

## Event formation

- Mark frames with **score > threshold** as active.
- **Merge** runs separated by ≤ **max_gap_frames** (default **2** ≈ 0.2 s).
- Discard segments shorter than **min_duration_s** (default **0.25** s).

## Output fields (per event)

See `output_samples/shots/whales_humpback/events.json` for examples: `event_id`, `shot_id`, `start_time_s`, `end_time_s`, `duration_s`, `score`, `detection_basis`, `notes`, optional `das_support`.

## Limitations

- Single hydrophone channel in spectrogram export.
- Time resolution limited by STFT hop (~0.1 s in current ingest settings).
- No species or vessel discrimination.

## Possible improvements (still without ML)

- Multi-channel consensus (export more channels in ingest).
- Adaptive threshold per time window.
- Refine boundaries with time-domain envelope on full-rate data (requires reading HDF5 or longer waveform export).
