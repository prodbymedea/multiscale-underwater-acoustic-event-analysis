# Hydrophone event score export (Sprint 2, Step 3)

## Purpose

This step keeps the existing hydrophone baseline detector and extends it with a
continuous score export for synchronized interpretation with DAS activity maps.

Important interpretation:

- The hydrophone score is a **support/timing layer**.
- It is **not** whale probability.
- It is **not** species classification.
- Candidate intervals are navigation guidance, not validated ground truth labels.

## Detector baseline (unchanged concept)

- Input: `spectrogram.json` (Recorder-C preview channel from ingest export).
- Frame score: mean `Sxx_db` over selected frequency band (default 30–1500 Hz).
- Threshold: `median + k * 1.4826 * MAD`, default `k=3`.
- Event formation:
  - active if `score > threshold`,
  - merge short gaps,
  - remove short intervals.

This remains a conservative candidate-event generator.

## New exported files

For each Whales shot (`whales_humpback`, `whales_orca`):

- `output/shots/<slug>/events.json`
- `output/shots/<slug>/hydrophone_event_score.npz`
- `output/shots/<slug>/hydrophone_event_score_metadata.json`
- `output/shots/<slug>/viewer_event_guidance.json`
- `figures/shots/<slug>/hydrophone_event_score.png`
- `figures/shots/<slug>/score_with_events.png`

## Score content

`hydrophone_event_score.npz` contains:

- `t_s`
- `raw_score` (mean dB score in selected band)
- `normalized_event_score` (robust percentile normalization to `[0, 1]`)
- `active_mask` (`raw_score > threshold`)

`hydrophone_event_score_metadata.json` contains:

- detector parameters and threshold,
- frequency band and channel/recorder info,
- normalization parameters,
- alignment metadata with `das_activity_map.npz`,
- explicit note that score is support guidance, not probability.

## Alignment with DAS activity map

The score metadata includes:

- hydrophone score time range,
- DAS activity time range (if available),
- overlap interval,
- nominal time resolution (`dt`) for both layers.

This prepares synchronized interpretation in the future viewer:

- hydrophone score indicates **when** to inspect;
- DAS activity map indicates **where/how** activity appears along the cable.

## Relation to DAS-first MVP direction

This export does not replace DAS as the main visual modality.
It strengthens the support layer needed for synchronized navigation and
interpretation while keeping DAS activity maps as the primary visual evidence.
