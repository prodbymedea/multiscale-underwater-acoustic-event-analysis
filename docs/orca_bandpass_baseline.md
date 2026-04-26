# Orca-focused DAS band-pass baseline (Backend Task 3)

## Why this was done

Supervisor feedback asked for a **simple DAS-side** view: pick a channel, apply a **narrow band-pass** in an Orca-relevant frequency region, derive a **short-time energy / envelope** trace, and optionally **threshold** it for a coarse “signal present / absent” style display—**without ML** and **not** labeled as whale probability.

This is an **additional diagnostic layer**. It does **not** replace:

- the hydrophone baseline detector,
- the rolling-RMS DAS activity map,
- or any future frontend architecture wholesale.

## Frequency support (critical)

- **`das_preprocessed_preview.npz`** is temporally downsampled (~**500 Hz** effective; Nyquist ~**250 Hz**). It **cannot** represent **2–3 kHz** content; any spectrogram of the preview trace in that range would be meaningless.
- This experiment therefore reads **native DAS** from the Orca HDF5 at **5000 Hz** (Nyquist **2500 Hz**).

**Supervisor example bands:**

- **2000–2500 Hz** — upper edge sits at Nyquist; filters are marginal; we use **2000–2350 Hz** as a safer proxy.
- **2300–2900 Hz** — **not fully observable** on 5 kHz DAS (2900 Hz > Nyquist). We use **2200–2450 Hz** as an upper-band proxy still below Nyquist.

## Channels tested

Taken from the latest `channel_inspection_summary.json` **rank order** (top three preview columns):

- **189** (raw DAS ch **945**, ~fiber end),
- **12** (raw ch **60**),
- **50** (raw ch **250**).

Override with `--preview-cols` if needed.

## Bands and score

| Band (Hz) | Role |
| --- | --- |
| 2000–2350 | Lower-mid “high band” within Nyquist margin |
| 2200–2450 | Upper proxy (not the full 2300–2900 request) |

**Score (explicit name: smoothed envelope energy):**

1. Per-channel: median-centered native-rate trace, Butterworth **band-pass**, zero-phase `sosfiltfilt`.
2. **Envelope:** `|hilbert(filtered)|`.
3. **Short-time RMS** of the envelope (**40 ms** default window) → `bandpass_support_score` scale for thresholding.
4. **Threshold:** median + `k`×MAD (default `k=3`) on that score → descriptive only.
5. **Plot normalization:** robust percentile map to **[0, 1]** for the bottom comparison panel (hydrophone support overlaid).

Outputs are described as **band-limited energy / bandpass_support_score / signal_present_mask** semantics—not probability.

## Findings (automated heuristic + visual review expected)

A simple **event vs. background contrast** was computed (mean score in hydrophone-marked event intervals minus mean outside a ±2 s guard). It is a **ranking hint**, not validation of biology.

On the current Orca export:

- **Best heuristic combination:** preview column **189**, band **2000–2350 Hz** (highest contrast in `orca_bandpass_summary.json`).
- **Column 50** can show **negative** contrast for **2000–2350 Hz** (score not higher on events than background by this crude metric)—still inspect the PNGs; geology / propagation may dominate.
- **2200–2450 Hz** is generally **less** favorable than **2000–2350 Hz** for col **189** in this run, but remains a useful comparison.

**Compared to untuned diagnostics:** the high-frequency band-pass **can** make short energetic bursts near the hydrophone-guided times **more localized** on **col 189**, but it is **not** automatically “better” than the full-band preprocessed preview for every channel; treat as an **optional analysis mode** / **debug / supervisor overlay** rather than the sole default viewer layer.

## Frontend implications

- **Treat as:** optional **selected-channel** “high-band energy” mode or **supervisor/debug** overlay, not the primary DAS heatmap.
- **Default channel for Orca demo (this sprint):** **preview col 189** / raw **945** is a strong candidate **for this high-band view**; keep hydrophone as **timing reference**.
- **Implementation note:** this path needs **native-rate** (or at least **> ~6 kHz**) DAS for true 2–3 kHz bands; the MVP preview NPZ alone is insufficient for that frequency range.

## Artifacts

- **Figures:** `figures/shots/whales_orca/orca_bandpass_col<col>_<fLo>_<fHi>.png`
- **Summary JSON:** `output/shots/whales_orca/orca_bandpass_summary.json`

## Stage 1: frontend bundle (no HDF5)

`src/build_selected_channel_bundle.py` packages the default channel (from `orca_bandpass_summary.json` / inspection), native-rate **waveform**, **spectrogram**, and **band-pass support score** into `output/shots/whales_orca/selected_channel_*` plus `selected_channel_bundle.json`, and merges pointers into `viewer_manifest.json` under `selected_channel_demo`.

## How to run

```bash
python3 src/test_orca_bandpass_baseline.py
python3 src/test_orca_bandpass_baseline.py --preview-cols 189,12,50 --bands 2000-2350,2200-2450
```

Requires local Orca `.h5` at the path resolved by `src/_repo_paths.py`.
