# Dataset Overview

## Dataset
This project uses the Lake Zurich underwater DAS dataset.

The dataset contains synchronized experimental recordings related to underwater acoustic monitoring. The main data are stored in shot-based HDF5 files, where each shot represents a separate recording segment.

## Main data components
The dataset includes several modalities:

### 1. DAS data
Distributed Acoustic Sensing (DAS) data represent acoustic activity measured along the fiber-optic cable.

These data are the main focus of the project because they provide spatially distributed observations along the cable.

### 2. Hydrophone data
Hydrophone recordings provide acoustic reference measurements.

These data are useful for:
- timing reference,
- spectrogram analysis,
- baseline event scoring,
- and comparison with DAS activity.

### 3. Source data
Shot files also include source-related data and metadata describing the emitted signal and experimental setup.

### 4. Spatial context
The file `Situation.h5` contains spatial information such as:
- bathymetry,
- fiber track,
- boat tracks,
- and related coordinate-based context.

This file is important for map-based visualization.

## Main files used in the project
The following files or subsets were considered during the current stage:

### Used for current MVP work
- `Situation.h5`
- `2022-01-26--04--Whales.zip`
- `2022-01-26--03--Morning.zip`

### Main selected shots
- `whales_humpback` — primary MVP shot
- `whales_orca` — secondary shot
- `morning_00` — reserve comparison shot

## Shot file structure
Each shot is stored as an `.h5` file. The project has already confirmed the presence of the following key groups/datasets in shot files:

- `DAS`
- `Source`
- `Recorder-*` (hydrophone recorders, depending on availability)

These contain both numerical data and metadata attributes.

## Observed practical parameters
Based on the current project exploration:

- DAS data are large and require downsampling for preview visualization.
- Hydrophone data are useful for waveform and spectrogram views.
- The dataset supports both temporal and spatial analysis.
- `Situation.h5` provides the context needed for map-based synchronized visualization.

## Current project use of modalities
At the current stage:

- hydrophone data are used mainly for baseline event timing and support views,
- DAS data are used as the main visual modality,
- spatial context is used for geographic interpretation of activity.

## Why this dataset is suitable
This dataset is suitable for the project because it allows:
- multiscale visualization,
- event-oriented exploration,
- synchronization between different sensing modalities,
- and spatial interpretation of underwater acoustic activity.

## Current limitations
The project currently works with a selected subset rather than the full dataset.

Also, in the local copy used during the project, the archives:
- `2022-01-27--2m.zip`
- `2022-01-27--4m.zip`

were found to be corrupted and were therefore not used in the current screening stage.
