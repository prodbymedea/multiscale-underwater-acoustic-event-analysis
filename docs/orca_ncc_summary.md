# Orca 2000–2490 Hz band: NCC channel summary

_Regenerate:_ `python3 src/summarize_orca_ncc_band.py` (see `--help`; optional env `ORCA_NCC_NPY` or default `data/raw/corr_band_Orca_2000_2490Hz.npy`).

- **Input:** local `corr_band_Orca_2000_2490Hz.npy`
- **Array shape:** `[496162, 946]` (channel axis=1)
- **Generated UTC:** 2026-05-06T19:37:06.799536+00:00

## Finding (thesis-safe wording)

Per-channel **max |NCC|** in this externally processed band is **concentrated** on a **small**
subset of raw channel indices. This **supports** interpreting Orca-related DAS response as
**sparse** and **channel-localized**, not uniformly distributed along the full cable. It **does not**
by itself prove species identity or a unique physical source mechanism.

## Top channels (max |NCC|)

| rank | channel | max |NCC| |
|------|---------|-----------|
| 1 | 859 | 0.815528 |
| 2 | 860 | 0.814714 |
| 3 | 861 | 0.814656 |
| 4 | 862 | 0.812514 |
| 5 | 858 | 0.810888 |
| 6 | 920 | 0.801842 |
| 7 | 857 | 0.797320 |
| 8 | 919 | 0.794417 |
| 9 | 863 | 0.786770 |
| 10 | 921 | 0.781978 |

## Hotspot zones

**Grouping rule:** Hotspot mode=threshold: channels with max|NCC| >= 0.35×global peak, then cluster along channel index with max_gap=3.

- **Zone 1:** channels 854–868 (15 ch), peak max |NCC| = 0.815528
- **Zone 2:** channels 908–925 (18 ch), peak max |NCC| = 0.801842
- **Zone 3:** channels 873–887 (15 ch), peak max |NCC| = 0.728609
- **Zone 4:** channels 124–141 (18 ch), peak max |NCC| = 0.499057
- **Zone 5:** channels 836–846 (11 ch), peak max |NCC| = 0.485454
- **Zone 6:** channels 937–945 (9 ch), peak max |NCC| = 0.434045

## Relation to selected-channel exports

- Viewer default raw channel 860 is 1 indices from NCC rank-1 channel 859 (same neighborhood if d is small).
- Exported selected-channel raw indices [945, 60, 250, 130, 730, 860] overlap the top-NCC neighborhood: True.

## Second hotspot / viewer exports

- Second zone channels 908–925 peak at 0.98× the first zone peak; gap after zone 1 = 40 indices.
- `src/build_selected_channel_bundle.py` now resolves raw **920** (with **859, 861, 862** for the primary hotspot neighborhood) to the nearest preview-grid columns in the Orca bundle; rebuild exports to refresh `selected_channels_index.json`. Default preview column remains **172** / raw **~860** unless you change the builder defaults.
