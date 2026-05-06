# Research findings and dataset characteristics

This note summarizes **empirical findings** from working with the Lake Zurich underwater DAS dataset in this project. It is written for a thesis context: precise, honest, and framed as **analytical results** rather than as shortcomings to be hidden.

The list reflects the current understanding that informed the **reframing** of scope (map-first exploration, **selected-channel** emphasis, heatmap as **context**, localization de-emphasized).

## Acoustic sensitivity and coupling

- **Low acoustic sensitivity on DAS** is a defining property of these recordings for much of the array. The DAS response to underwater sound is often weak relative to hydrophone observations and is **not** uniform along the cable.
- Consequently, **absence of a strong DAS signature** in many channels or time windows does **not** prove absence of acoustic energy in the environment; it may reflect sensitivity, geometry, or processing choices.

## Whale-related response is sparse and channel-limited

- Only a **relatively small subset of DAS channels** carries interpretable whale-related structure in the current exports.
- **Teacher-processed Orca band evidence:** normalized cross-correlation (NCC) on a **2000–2490 Hz** band (`corr_band_Orca_2000_2490Hz.npy`, kept locally—not in Git) shows **strongest** per-channel responses concentrated around **~859–862** (primary hotspot) and a **second strong band around ~908–925**, rather than spread uniformly along the cable. Summary tables: `docs/orca_ncc_summary.md` and `output/analysis/orca_ncc_summary.json` (from `src/summarize_orca_ncc_band.py`). The Orca selected-channel export builder resolves raw anchors **859, 861, 862, 920** to the nearest preview-grid columns so the viewer can represent both major zones without claiming extra cable-wide sensitivity.
- **Orca-associated** recordings show **sparse** but **real** DAS evidence when viewed on the **right channels**, often with **band-focused** or spectrogram detail that does not read clearly from a full-cable aggregate alone. A small **viewer demo** can play band-limited **received DAS** audio next to the dataset **source reference** segment for illustration of distortion and sparsity—not a validated reconstruction of “what the whale sounded like” in situ.
- **Humpback-associated** recordings appear **weaker and noisier** on DAS under current preprocessing; interpretation remains **support-level** and should not be equated with Orca-class clarity.

These points motivate **selected-channel inspection** as the primary explanatory path for whale-related claims, and the **activity heatmap** as a **secondary context layer** rather than a definitive cable-wide detector.

## Localization

- **Localization attempts** using this dataset have **not** yielded reliable results that should be presented as a core thesis deliverable.
- The project therefore does **not** center on mapped animal positions inferred from DAS. Spatial work emphasizes **context** (fiber, recorders, bathymetry where shown, **source/metadata** when available), not validated bioacoustic localization.

## Interpretive layers: heatmap vs selected channel

- The **normalized activity map** along time and channel remains useful to see **coarse** structure and to relate preprocessing choices to wide-area patterns.
- It should **not** be oversold: it is **not** a precise event detector along the full cable and **not** a substitute for reading **selected-channel** traces (waveform, spectrogram, optional band-pass **support** score).

## Environmental and non-whale structure

- **Patterns along the cable**—including variability that may relate to **environment**, coupling, or non-target sources—are plausibly an important part of the story for this dataset.
- Treating an **environmental / cable-along-track** interpretation branch as **in scope** acknowledges that not every feature in DAS–time–channel space is whale-related, and that explaining such structure can be a **meaningful analytical contribution**.
- **Lake-model / environmental variables:** Delft3D-FLOW NetCDF under `data/raw/environment/` has been inspected; **`docs/environmental_nc_inventory.md`** lists dimensions/variables, and **`docs/environmental_data_audit.md`** describes exports and file-specific behavior. The MVP exporter **`src/export_environmental_mvp.py`** writes **`temperature_t`** ( **`R1`** temperature at a wet vertical layer aligned with **`U1`/`V1`** when filtered flow is zero) as the **primary** map scalar, keeps **`thermocline_t`** as a **secondary** diagnostic (often very sparse in the audited file), and exports horizontal flow on **`(M,N)`**. Fiber-aligned time series remain **empty** until CRS alignment is validated; model `XZ`/`YZ` vs **LV95** overlay is still pending.

## Thesis framing

These findings do **not** invalidate the project. They define **what honest visualization and analysis should claim** for this modality:

- The thesis can contribute **methods and interfaces** for exploring difficult, low-sensitivity DAS data **together with** hydrophone **support** and spatial **context**.
- The contribution includes making **sparse**, **localized** evidence visible and interpretable—**without** asserting cable-wide detection or reliable localization that the data do not support.

For operational definitions of events, scores, and exports, see `docs/event_definition.md` and `docs/system_io.md`.
