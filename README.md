# DASLakeZurich — Multiscale MVP (thesis)

**Multiscale data visualization and baseline candidate-event analysis** for a distributed underwater acoustic monitoring scenario, built on the public **DASLakeZurich** dataset (distributed acoustic sensing + hydrophone arrays, Lake Zurich).

## Data source

- **Dataset:** [Zenodo DOI 10.5281/zenodo.7886409](https://doi.org/10.5281/zenodo.7886409) — landing page [zenodo.org/records/7886409](https://zenodo.org/records/7886409).
- **Reference:** ETH Zurich data publication; see Zenodo metadata and bundled PDF for the canonical description. **Raw HDF5 and ZIP archives are not stored in this Git repository** (see `data/README.md`).

## Current MVP scope

- HDF5 → JSON **ingest/export** for previews and summaries.
- **Matplotlib** quick-look plots (including robust / normalized DAS scaling).
- **Shot screening** (Humpback, Orca; Morning kept as historical reserve) with per-shot figures.
- **Baseline candidate events** from hydrophone spectrogram activity (MAD thresholding), with optional DAS hints — **no ML**.
- **Sprint 2 backend:** Whales-subset DAS preprocessing prototype for cleaner DAS activity representations before rolling-RMS maps.

Details: `docs/mvp_definition.md`, `docs/subset_selection.md`, `docs/event_definition.md`, `docs/das_preprocessing_decision.md`.

## Repository layout

| Path | Purpose |
|------|---------|
| `src/` | All Python tools (`ingest_prototype.py`, `visualize_export.py`, `screen_shots.py`, `extract_events_baseline.py`, `_repo_paths.py`) |
| `docs/` | MVP, subset, and event definitions |
| `data/` | `README.md` only in Git; place raw files under `data/raw/` locally (gitignored) |
| `figures/shots/whales_humpback/` | Committed demo PNGs (primary shot) |
| `figures/shots/whales_orca/` | Committed demo PNGs (secondary; large spectrogram PNG excluded via `.gitignore`) |
| `output_samples/shots/` | Small JSON samples (`shot_metadata`, `recorders_summary`, `events`) — **no** multi‑MB exports |
| `site/` | Placeholder for a future **GitHub Pages** static demo |
| `output/` | Full ingest outputs (**gitignored**; create locally after download) |

## Scripts (implemented)

| Script | Role |
|--------|------|
| `src/ingest_prototype.py` | Read one shot `.h5` + optional `Situation.h5` → JSON in chosen output directory |
| `src/visualize_export.py` | Plot exports (DAS linear/robust/normalized, waveform, spectrogram, map) |
| `src/screen_shots.py` | Batch ingest + plots for configured shots → `output/shots/<slug>/`, `figures/shots/<slug>/` |
| `src/extract_events_baseline.py` | Baseline `events.json` from `spectrogram.json` (+ optional `das_preview.json`) |
| `src/preprocess_das.py` | Whales-only DAS preprocessing preview (`.npz` + metadata + raw/preprocessed comparison figures) |
| `src/build_das_activity_map.py` | Build normalized rolling RMS DAS activity map (`das_activity_map.npz` + metadata + quick-look PNGs) |

## Notes on data

- Obtain **`Situation.h5`** and shot files from Zenodo; place under `data/raw/` (mirroring subset folders) **or** next to the repo root as in the original Zenodo layout — scripts check both (`src/_repo_paths.py`).
- **`2022-01-27--2m.zip` / `4m.zip`:** in one local copy these archives were **corrupt**; this project used **`2022-01-26--03--Morning`** as a non-Whales comparison instead (`data/README.md`).

## Current subset choice

- **Primary MVP shot:** `whales_humpback` — `2022-01-26--04-46-16--Humpback.h5`.
- **Secondary:** `whales_orca` — `2022-01-26--04-47-42--Orca.h5`.
- **Reserve (documented only):** `morning_00` — `2022-01-26--03-57-10--00.h5`.
- **Current Sprint 2 implementation focus:** Whales subset only (`whales_humpback`, `whales_orca`).

## Project status

- Ingest/export, visualization, screening, and baseline event JSON: **working** (Python 3.10+ recommended; tested with 3.13).
- Frontend / GitHub Pages demo: **not started** (`site/` placeholder only).

## How to run

From the **repository root** (after `python -m venv .venv && source .venv/bin/activate`):

```bash
pip install -r requirements.txt
```

**Ingest one shot** (paths depend on where you stored the HDF5 files):

```bash
python src/ingest_prototype.py path/to/2022-01-26--04-46-16--Humpback.h5 output/shots/whales_humpback \
  --situation path/to/Situation.h5
```

**Plots** for that export:

```bash
python src/visualize_export.py output/shots/whales_humpback figures/shots/whales_humpback
```

**Screening** (all configured shots; requires local `.h5` / `.zip` as in `src/screen_shots.py`):

```bash
python src/screen_shots.py
```

**Baseline events** (needs `spectrogram.json` next to other exports):

```bash
python src/extract_events_baseline.py --shot-dir output/shots/whales_humpback
```

The baseline detector also exports a compact support-score bundle:

- `hydrophone_event_score.npz`
- `hydrophone_event_score_metadata.json`
- `viewer_event_guidance.json`
- score diagnostics under `figures/shots/<slug>/`

**DAS preprocessing preview (Sprint 2 backend, Whales shots):**

```bash
python src/preprocess_das.py --shot whales_humpback
python src/preprocess_das.py --shot whales_orca
```

**DAS activity representation (rolling RMS map from preprocessed DAS):**

```bash
python src/build_das_activity_map.py --shot whales_humpback
python src/build_das_activity_map.py --shot whales_orca
```

**Viewer-readiness check (Whales shots):**

```bash
python src/check_viewer_ready.py
python src/check_viewer_ready.py --shot whales_humpback
```

**Viewer bundle manifests (Whales shots):**

```bash
python src/build_viewer_bundle.py
python src/build_viewer_bundle.py --shot whales_humpback
```

## Planned GitHub Pages deployment

- **Target:** publish the static content under **`site/`** (e.g. `index.html` and future assets) via [GitHub Pages](https://pages.github.com/) (branch/folder settings in the repo **Settings → Pages**).
- **Not enabled in this repo yet** — only the folder structure and placeholder are prepared.
- After adding a real demo, typical steps are: push to GitHub → enable Pages from `/site` or `/docs` → optional custom domain.

## License / attribution

Dataset license and attribution are defined on **Zenodo** (e.g. CC-BY where applicable). Cite the dataset DOI in thesis work.
