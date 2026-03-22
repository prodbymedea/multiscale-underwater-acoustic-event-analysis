# Data layout

## Sources

- **Zenodo dataset:** [DOI 10.5281/zenodo.7886409](https://doi.org/10.5281/zenodo.7886409)  
  Landing page: [https://zenodo.org/records/7886409](https://zenodo.org/records/7886409)

- **Reference / publication repository:** see the Zenodo record and associated publication (PDF in the dataset) for the canonical **ETH Zurich** data publication layout. If a public GitLab mirror exists for the original code bundle, it is typically linked from Zenodo metadata.

## What is **not** in Git

The following **must not** be committed to this GitHub repository:

- `*.zip` archives from Zenodo  
- `*.h5` shot files and `Situation.h5`  
- Full `output/` exports (multi‑MB JSON)  
- Virtual environments (`.venv/`)

Place extracted or downloaded files under **`data/raw/`** (recommended) or keep the legacy layout at the repository root; the Python scripts resolve both (see `src/_repo_paths.py`).

## Subsets used in this project

| Role | Subset / file |
|------|----------------|
| **Primary MVP shot** | `2022-01-26--04--Whales` / `2022-01-26--04-46-16--Humpback.h5` |
| **Secondary** | Same run folder / `2022-01-26--04-47-42--Orca.h5` |
| **Reserve comparison** | `2022-01-26--03--Morning` / `2022-01-26--03-57-10--00.h5` |

## Note on damaged local archives

In one local copy of the dataset, **`2022-01-27--2m.zip`** and **`2022-01-27--4m.zip`** failed `unzip` (missing central directory). Those subsets were **not** used for screening here. Re-download from Zenodo if you need them.
