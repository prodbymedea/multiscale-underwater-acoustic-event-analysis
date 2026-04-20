# System Inputs and Outputs

## Purpose
This document defines the main inputs and outputs of the current project pipeline.

Its purpose is to clarify:
- what data enter the system,
- what intermediate artifacts are produced,
- what will later be consumed by the interactive viewer,
- and what the final project output is expected to be.

## System inputs

### 1. Selected shot file
A selected shot-based `.h5` file from the DASLakeZurich dataset.

This is the main raw input for the current pipeline.

Examples:
- `whales_humpback`
- `whales_orca`
- `morning_00`

These files contain:
- DAS data,
- hydrophone data,
- source-related data,
- and metadata attributes.

### 2. Spatial context file
`Situation.h5`

This file provides the map-related and geometry-related context needed for visualization, including:
- bathymetry,
- fiber track,
- boat tracks,
- and related spatial metadata.

### 3. Optional preprocessing parameters
The system may also use configurable preprocessing parameters, for example:
- selected frequency range,
- downsampling factors,
- filtering parameters,
- event score parameters,
- thresholding parameters,
- selected channel or recorder.

These are not separate dataset files, but they act as input settings for the processing pipeline.

### 4. Optional selected time interval
For future interactive viewing, the user may select a specific time interval from a shot.

This interval acts as a user-level input for focused inspection and visualization.

## Intermediate outputs

The current pipeline already produces several intermediate structured outputs.

### Metadata and summaries
- `shot_metadata.json`
- `recorders_summary.json`

These describe shot-level properties, available sensors, and basic metadata.

### Signal-based outputs
- `spectrogram.json`
- `waveform.json`
- `das_preview.json`
- `das_preprocessed_preview.npz`
- `das_activity_map.npz`

These provide compact visual-analysis-friendly representations of the raw data.

### Spatial output
- `situation.json`

This contains map-ready spatial context derived from `Situation.h5`.

### Event output
- `events.json`

This contains baseline candidate event intervals and associated fields such as timing, score, and support information.

## Planned viewer inputs

For the next MVP stage, the viewer is expected to consume a more explicit set of visualization-oriented inputs.

These may include:

### 1. Time-based DAS activity export
A DAS-centered representation that shows activity along the cable over time, for example:
- normalized DAS activity,
- rolling DAS intensity,
- or another interpretable DAS activity map.

### 2. Hydrophone event score over time
A time-aligned support signal that indicates when event-related acoustic activity is stronger.

This is not intended to replace DAS, but to support temporal interpretation.

### 3. Map-ready spatial context
Map-compatible geometry and metadata, including:
- bathymetry,
- cable track,
- source-related context where available.

### 4. Event interval boundaries
Binary candidate intervals that can be used for:
- navigation,
- jumping to interesting regions,
- and summarizing recordings.

## Final output of the system

The final output of the project is not a raw file or a single figure.

The intended final output is an:

**interactive DAS-centered visual analysis prototype**

This viewer should allow the user to:
- choose a shot,
- choose a time interval,
- inspect DAS activity over time,
- inspect hydrophone support score,
- view map-based spatial context,
- and navigate to candidate events.

## Input / output summary

### Inputs
- selected shot `.h5` file
- `Situation.h5`
- optional preprocessing parameters
- optional selected time interval

### Intermediate outputs
- `shot_metadata.json`
- `recorders_summary.json`
- `spectrogram.json`
- `waveform.json`
- `das_preview.json`
- `situation.json`
- `events.json`

### Future viewer inputs
- time-based DAS activity export
- hydrophone event score over time
- map-ready context
- event interval boundaries

### Final output
- interactive DAS-centered visual analysis prototype

## Current note
At the current stage, the system already supports:
- ingest,
- export,
- quick inspection,
- shot screening,
- and baseline candidate-event generation.
- and normalized rolling-RMS DAS activity map generation for Whales shots.

The next implementation stage should focus on transforming these outputs into a synchronized time-based viewer.
