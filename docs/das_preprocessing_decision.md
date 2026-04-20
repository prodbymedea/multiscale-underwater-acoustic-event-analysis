# DAS preprocessing decision (Sprint 2, Step 1)

## Scope update for current backend task

Current Sprint 2 backend work is focused on the **Whales subset only**:

- `2022-01-26--04--Whales/2022-01-26--04-46-16--Humpback.h5` (`whales_humpback`)
- `2022-01-26--04--Whales/2022-01-26--04-47-42--Orca.h5` (`whales_orca`)

`morning_00` remains documented as a previous comparison case, but it is **not** part of the active Sprint 2 preprocessing implementation.

## External reference reviewed

Reference repository: [DAS4Whales/DAS4Whales](https://github.com/DAS4Whales/DAS4Whales)

Reviewed material:

- package README / docs overview
- `src/das4whales/dsp.py`
- `Example.py`

Methods highlighted there:

- high-pass / band-pass filtering,
- frequency-wavenumber (f-k) filtering,
- spatio-temporal and spatio-spectral visualization primitives.

## Candidate methods considered for this project

### 1) Per-channel robust centering (median removal)

- **What it does:** removes static channel bias and long-term offset.
- **Why useful:** DAS t-x previews become more comparable across channels.
- **Complexity:** easy.
- **MVP fit:** very good.

### 2) Temporal high-pass / band-pass filter

- **What it does:** suppresses very low-frequency drift and out-of-band components.
- **Why useful:** improves contrast of dynamic whale-related structures before building activity maps.
- **Complexity:** easy/medium (SciPy Butterworth + `sosfiltfilt`).
- **MVP fit:** very good (parameterized, no biological claim).

### 3) Channel-wise robust normalization (MAD-based)

- **What it does:** scales channels to comparable dynamic range.
- **Why useful:** stabilizes visualization and prepares input for normalized rolling RMS.
- **Complexity:** easy.
- **MVP fit:** very good.

### 4) f-k filtering

- **What it does:** directional/velocity-domain suppression of unwanted wave components.
- **Why useful:** potentially strong denoising in some DAS settings.
- **Complexity:** medium/high (parameter tuning, physics assumptions, higher risk of over-filtering).
- **MVP fit:** deferred (future work after baseline activity map is validated).

## Selected preprocessing for MVP (implemented)

Implemented chain in `src/preprocess_das.py`:

1. per-channel median removal (selected time interval),
2. optional temporal Butterworth filter (high-pass / band-pass / low-pass),
3. per-channel robust normalization using MAD (`1.4826 * MAD`),
4. clipping for stable plotting.

This is intentionally simple, reproducible, and interpretable for a DAS-centered visualization pipeline.

## Outputs produced

For each shot (`whales_humpback`, `whales_orca`):

- `output/shots/<shot>/das_preprocessed_preview.npz`
- `output/shots/<shot>/das_preprocessing_metadata.json`
- `figures/shots/<shot>/das_preprocessed_preview.png`
- `figures/shots/<shot>/das_raw_vs_preprocessed.png`

The NPZ output is designed as input to the next step: normalized rolling RMS DAS activity map.

## What this is **not**

- not whale classification,
- not ML training/inference,
- not a universal DAS framework.

This step is purely backend preprocessing for clearer DAS-centered visual analysis in the Whales subset.

## Future work (post-Step 1)

- implement normalized rolling RMS DAS activity map on top of preprocessed previews,
- compare activity-map quality across parameter settings,
- optionally evaluate constrained f-k filtering after baseline activity map stabilization.
