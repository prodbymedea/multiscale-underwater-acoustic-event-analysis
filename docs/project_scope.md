# Project Scope

## Project title
Multiscale data visualization and event analysis for a distributed underwater acoustic monitoring system

## Scope statement
This project is a dataset-specific visual analysis prototype built for the Lake Zurich underwater DAS dataset. The goal is not to create a universal platform for arbitrary DAS datasets, but to design a clear and interpretable workflow for exploring this particular dataset **as it is**: including limited acoustic sensitivity, sparse whale-related coupling on DAS, and the need for careful, channel-focused interpretation.

## Target user
The primary target user is a domain-oriented researcher, such as:
- a marine biologist,
- an underwater acoustics researcher,
- or another subject-matter expert interested in this dataset,

who may not have a strong computer science or signal-processing engineering background and does not want to work directly with raw HDF5 files and preprocessing code.

## Main value of the project
The main value of the project is to make this complex dataset easier to interpret **without overstating what the DAS modality can show**.

In particular, the system should help the user:
- explore selected recordings without directly reading raw `.h5` files,
- identify interesting time intervals (with hydrophone-based guidance where appropriate),
- inspect **selected-channel DAS traces** (waveform, spectrogram, band-focused support) as the primary way to relate sparse acoustic evidence to the fiber,
- use the **aggregated DAS activity heatmap as a secondary context layer** along the cable—not as a precise, cable-wide event detector,
- relate hydrophone observations to **localized** DAS response where channels are informative,
- view the data together with spatial context such as bathymetry and fiber track, and with **source/context metadata** when available.

The project is therefore not only about listing candidate events, but about presenting **synchronized, map-first exploration** with honest limits on localization and cable-wide whale inference.

## Main project focus
The core focus remains **DAS-centered visualization for this dataset**, with two complementary analytical branches:

1. **Sparse whale-related acoustic evidence on DAS**, examined through **selected-channel inspection** and band-focused views (especially for Orca-class recordings where response is concentrated on a narrow subset of channels). Humpback-related DAS response in current data is weaker and noisier; interpretation stays tentative and support-level.
2. **Environmental and cable-along-track context**, as an emerging second branch: patterns along the fiber may reflect non-whale structure (environment, coupling, geometry) that matters for interpreting the same recordings.

Hydrophone data remain essential as:
- a reference signal,
- a **support layer** for timing and navigation,
- and a contrast to what is (and is not) visible on DAS.

**Broad whale localization or reliable cable-wide detection on DAS alone is not a framing goal** for this thesis: prior localization attempts were unreliable and are not treated as a central deliverable.

## What the MVP should provide
The MVP should allow the user to:
- work **map-first** (spatial context, fiber/recorder/source cues),
- select a shot or a time interval,
- inspect a synchronized view of the data,
- use hydrophone-based **support** (score, events) over time for navigation and timing,
- see DAS activity along the fiber as a **context layer** (normalized activity map),
- drill into **selected-channel** DAS inspection (including multi-channel where exported),
- and navigate to candidate intervals identified by a baseline hydrophone-derived score.

## What the MVP is not
The MVP is not intended to be:
- a universal DAS framework,
- a full production-ready software platform,
- a real-time analytics system,
- a validated cable-wide whale detector or localization system,
- or a fully trained whale-species classification model.

## Expected output
The expected result is an interactive visual analysis prototype that combines:
- **map-first** spatial context and map-linked channel selection where implemented,
- **selected-channel** DAS interpretation as the primary explanatory path for sparse whale-related evidence,
- hydrophone **support** views,
- DAS heatmap as **secondary** cable-wide context,
- and baseline candidate-event navigation,

for a selected subset of the Lake Zurich dataset.

## Technical interpretation of the expected output

The core output of the project is an interactive visual analysis viewer.

In practical terms, this means that the user should be able to:
- select a shot,
- select a time interval,
- inspect DAS activity over time (heatmap as context),
- inspect hydrophone-based **support** score over time,
- inspect **selected-channel** waveform, spectrogram, and optional band-pass **support** score (not whale probability),
- view spatial context on the map,
- and navigate to candidate events.

A meaningful part of the thesis contribution is **methodological and interpretive**: demonstrating how to explore low-sensitivity, difficult DAS data honestly, rather than presenting the dataset as cleaner or more definitive than the evidence supports.

## Transferability
The current implementation is dataset-specific. Some design ideas (map-linked exploration, selected-channel bundles, synchronized multi-panel views) may later be reusable for similar DAS datasets, but generalization is not the primary goal of this project.
