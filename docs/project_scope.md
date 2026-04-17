# Project Scope

## Project title
Multiscale data visualization and event analysis for a distributed underwater acoustic monitoring system

## Scope statement
This project is a dataset-specific visual analysis prototype built for the Lake Zurich underwater DAS dataset. The goal is not to create a universal platform for arbitrary DAS datasets, but to design a clear and interpretable workflow for exploring this particular dataset.

## Target user
The primary target user is a domain-oriented researcher, such as:
- a marine biologist,
- an underwater acoustics researcher,
- or another subject-matter expert interested in this dataset,

who may not have a strong computer science or signal-processing engineering background and does not want to work directly with raw HDF5 files and preprocessing code.

## Main value of the project
The main value of the project is to make this complex dataset easier to interpret.

In particular, the system should help the user:
- explore selected recordings without directly reading raw `.h5` files,
- identify interesting time intervals,
- understand how acoustic activity develops over time,
- relate hydrophone observations to DAS activity along the cable,
- view the data together with spatial context such as bathymetry and fiber track.

The project is therefore not only about detecting candidate events, but also about presenting them in a synchronized and interpretable visual form.

## Main project focus
The core focus of the project is DAS-centered visualization.

Hydrophone data are still important, but mainly as:
- a reference signal,
- a supporting timing layer,
- and an aid for event interpretation.

The main contribution of the project should be the visual interpretation of DAS data in time and space.

## What the MVP should provide
The MVP should allow the user to:
- select a shot or a time interval,
- inspect a synchronized view of the data,
- see hydrophone-based event-related activity over time,
- see DAS activity along the fiber,
- view the event in spatial context,
- and navigate to interesting intervals identified by a baseline event score.

## What the MVP is not
The MVP is not intended to be:
- a universal DAS framework,
- a full production-ready software platform,
- a real-time analytics system,
- or a fully trained whale-species classification model.

## Expected output
The expected result is an interactive visual analysis prototype that combines:
- time-based event interpretation,
- DAS activity visualization,
- hydrophone support views,
- and map-based spatial context

for a selected subset of the Lake Zurich dataset.

## Transferability
The current implementation is dataset-specific. Some design ideas may later be reusable for similar DAS datasets, but generalization is not the primary goal of this project.
