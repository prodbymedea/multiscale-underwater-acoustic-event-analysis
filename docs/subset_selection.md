# Subset selection

Visual screening compared three shots (see `src/screen_shots.py` and local `output/shots/SCREENING_METRICS.txt` if generated).

## Primary: **Humpback** (`whales_humpback`)

- **File:** `2022-01-26--04-46-16--Humpback.h5` in `2022-01-26--04--Whales`.
- **Why:** ~41 s duration—manageable JSON size and UI timeline; clear “whale playback” narrative; DAS preview shows interpretable structure after robust normalization; spectrogram has usable time resolution (~403 STFT frames).
- **Role:** Default for MVP figures, baseline `events.json`, and thesis demos.

## Secondary: **Orca** (`whales_orca`)

- **File:** `2022-01-26--04-47-42--Orca.h5`.
- **Why:** Longer record (~107 s) and richer time axis for exploring multiple candidate intervals; same experimental run folder as Humpback.
- **Trade-off:** Larger exports and figures; spectrogram PNG omitted from Git by default (see `.gitignore`).

## Reserve: **Morning** (`morning_00`)

- **File:** `2022-01-26--03-57-10--00.h5` in `2022-01-26--03--Morning`.
- **Why:** Different experimental context (non-Whales run); higher hydrophone RMS—useful as a **contrast / stress** case, not the main story.
- **Figures:** `figures/shots/morning_00/` is gitignored to keep the repo small.

## 2 m / 4 m Zenodo zips

Planned comparison to **`2022-01-27--2m`** was blocked in one workspace by **corrupt ZIPs** (`2m` and `4m`). Screening used **Morning** instead. Re-download from Zenodo if those subsets are required.
