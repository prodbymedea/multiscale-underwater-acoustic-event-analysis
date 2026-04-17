# Event Definition

## Current status
This document describes the **current baseline event definition** used in the project.

It should not be treated as the final conceptual definition of an event. The current implementation is a practical starting point for MVP exploration and will evolve toward a score-based and more DAS-centered representation.

## Current baseline philosophy
At the current stage, candidate event timing is derived primarily from **hydrophone spectrogram activity**.

This choice was made because hydrophone spectrograms currently provide the most stable and interpretable baseline for identifying interesting time intervals in the selected dataset.

However, the long-term focus of the project is **DAS-centered visualization**, not hydrophone-only detection. Hydrophone data are therefore treated mainly as:
- a reference timing source,
- a supporting signal for interpretation,
- and a synchronized secondary view.

DAS should remain the main visual modality of the project.

## Current baseline score
The current baseline detector uses the exported hydrophone spectrogram (`spectrogram.json`) and computes a frame-wise score.

### Frequency range
The current working frequency range is **30–1500 Hz**.

This range should be treated as a **baseline MVP choice**, not as a final biologically optimized band. It was selected as a practical starting point for exploring low- to mid-frequency acoustic activity, but it may need further adjustment depending on the target signal and domain interpretation.

### Score definition
For each STFT time frame, the current score is defined as the mean `Sxx_db` over the retained frequency bins.

This should be understood as a **simple baseline score**, chosen for reproducibility and interpretability during early MVP development. It is not assumed to be the only or best possible event score.

Other feature definitions may later be explored, including:
- alternative band-based energy measures,
- weighted frequency aggregation,
- MFCC-based features,
- or combined DAS + hydrophone evidence.

## Thresholding
The current detector uses a robust threshold:

threshold = median(scores) + k × 1.4826 × MAD(scores)

with default k = 3.

This threshold is currently used to convert a continuous score into candidate event intervals.

At the same time, the project should move beyond purely threshold-based interpretation. In future iterations, the continuous score itself should also be visualized and used as an interpretable layer, rather than only showing thresholded event intervals.

## Event formation
The current baseline event formation is:

- mark frames with **score > threshold** as active,
- merge runs separated by up to **max_gap_frames**,
- discard very short segments.

This produces candidate event intervals for navigation and exploration.

## Binary event vs score-based representation
The project should distinguish between two related but different concepts:

### 1. Event interval
A binary interval is still useful because it allows:
- event listing,
- navigation,
- jumping to interesting time regions,
- and summarizing a shot.

### 2. Event score / confidence over time
A continuous score is more useful for interpretation because it shows:
- how strong the event evidence is,
- how it changes over time,
- and where thresholding may hide gradual transitions.

For this reason, the recommended direction is to keep **binary intervals for navigation**, but also expose a **continuous score or confidence-like representation**.

At the current stage, it is safer to describe this value as:
- activity score,
- detection score,
- or confidence-like score,

rather than a strict calibrated probability.

If later the score is normalized into a bounded range such as 0–1, it can be presented in the interface as a whale-call confidence-like value, but that would still require careful interpretation.

## Role of hydrophone
Hydrophone data should remain in the project, but mainly as:
- a reference timing source,
- a support signal for event interpretation,
- and a synchronized secondary view.

Hydrophone-based scoring is useful because it is currently the most stable and interpretable baseline for identifying interesting intervals.

However, hydrophone data should not become the main focus of the whole project.

## Role of DAS
DAS is the central visual modality of the project.

At the moment, DAS is not yet used as the primary baseline detector. Instead, it is used as a supporting view linked to detected time intervals.

This should evolve further. In the intended MVP direction, DAS should not only show raw amplitude, but also a more interpretable representation such as:
- normalized DAS activity score,
- rolling DAS intensity,
- channel-wise activity map,
- or confidence-like DAS heatmap.

The purpose is to show how event-related activity appears and evolves along the cable over time.

## Combined hydrophone and DAS evidence
The long-term direction of the project should be to combine **hydrophone and DAS evidence** rather than relying on hydrophone alone.

This does not necessarily mean a hard joint detector in the first MVP. A more realistic immediate approach is:

- use hydrophone as the baseline timing and support layer,
- use DAS as the main visual evidence layer,
- and later move toward a combined event confidence based on both modalities.

This is important because an event may be visible on the hydrophone signal but weak or absent on DAS channels, or vice versa. Such differences are themselves informative and should not be hidden.

## Linking detection score to DAS view
At the current stage, the project does not use a single combined detection formula that merges hydrophone and DAS into one final probability value. Instead, the connection between detection score and DAS view is defined through **synchronized interpretation**.

### Hydrophone score
The hydrophone-derived score is used as:
- a time-based guidance signal,
- a support score over time,
- and a practical way to identify intervals of increased acoustic activity.

This score helps indicate **when** an event-like interval is likely to occur.

### DAS view
The DAS view is used as the **main visual layer** of the project.

Its role is to show:
- how activity appears along the cable,
- how it evolves over time,
- and how different parts of the fiber respond during the selected interval.

This view helps indicate **where and how** the event-related activity is visible in DAS.

### Relationship between the two
The hydrophone score and the DAS view are linked through **shared time alignment**.

In practice, this means:
- the user inspects the same time interval across both modalities;
- the hydrophone panel shows event score over time;
- the DAS panel shows DAS activity along the cable over time;
- when the hydrophone score increases, the user can immediately inspect how that interval is reflected in DAS.

This allows the system to support event interpretation without requiring a hard combined detector at the current stage.

### Why this approach is used
This synchronized approach is appropriate for the current MVP because:
- hydrophone data currently provide the most stable baseline timing cue;
- DAS is the main target modality for visualization;
- a hard combined detector would add unnecessary complexity at this stage;
- the synchronized representation is already informative for event-oriented exploration.

### Planned future direction
A more explicit combination of hydrophone and DAS evidence may be added later.

Possible future directions include:
- DAS activity score over time,
- comparison between hydrophone score and DAS score,
- or a combined confidence-like representation.

However, this is not required for the current MVP.

## DAS-centered event representation
The final visual interpretation should therefore not be based only on hydrophone-derived event intervals.

Instead, the project should aim for a representation in which:
- binary event intervals remain useful for navigation,
- continuous score over time shows event strength,
- DAS activity becomes the main visual object,
- and hydrophone helps anchor and support interpretation.

For the current MVP, the main DAS representation will be a **normalized rolling RMS activity map**.

In this representation, each cell of the DAS view reflects the relative signal activity of a given channel within a short time window, rather than raw amplitude alone.

This choice was made because it is:
- more stable than raw amplitude,
- easier to interpret,
- suitable for time-based visualization,
- and appropriate for synchronized viewing together with hydrophone score and map context.

## Current output fields
The current `events.json` output contains fields such as:
- `event_id`
- `shot_id`
- `start_time_s`
- `end_time_s`
- `duration_s`
- `score`
- `detection_basis`
- `notes`
- optional `das_support`

These fields are sufficient for baseline event navigation, but likely not sufficient for the final event representation in the future MVP.

## Current limitations
The current baseline has several limitations:

- it uses a single hydrophone preview channel,
- the score is based on a simple mean over selected spectrogram bins,
- the selected frequency range is only a working baseline,
- time resolution is limited by the STFT configuration,
- there is no species classification,
- there is no calibrated probability model,
- DAS is not yet used as a full event evidence source.

## Cable sensitivity limitations
The paper indicates that the cable had sensitivity limitations in some parts of the system.

This is relevant for interpretation because weak DAS response does not always imply absence of an acoustic event. For this reason, cable sensitivity issues should ideally be reflected in the visualization at least as:
- contextual information,
- annotation,
- or an interpretive note for the user.

This does not have to become a full subsystem in the MVP, but it should not be ignored.

## Source ground truth in the interface
If source metadata and emitted signal location are available and reliable, the interface should display source ground-truth position.

This would improve:
- spatial interpretability,
- relation between emission and observed activity,
- and the overall clarity of the synchronized map-based view.

Predicted source position should only be shown if the project later includes a justified estimation method. Ground-truth display is more realistic for the current scope.

## Open questions
The following questions remain open and should be addressed in the next project stage:

- Is the current frequency range sufficient for humpback-related exploration, or should it be expanded?
- Should the score remain a simple spectrogram mean, or should alternative features be tested?
- Should the final interface show score in raw form, normalized form, or bounded confidence form?
- How should DAS activity be aggregated into the most interpretable visual representation?
- What is the best practical way to combine hydrophone and DAS evidence in the MVP?

## Recommended next direction
The current recommendation is:

- keep the current baseline detector as a practical candidate generator,
- keep binary intervals for navigation,
- expose a continuous event score over time,
- treat hydrophone as a support layer,
- make DAS the central visual layer,
- move toward combined hydrophone + DAS evidence,
- include source ground-truth position if possible,
- and reflect cable sensitivity issues at least as contextual information in the visualization.
