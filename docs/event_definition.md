# Event Definition

## Current status
This document describes the **current baseline event definition** used in the project.

Events are **candidate intervals** for exploration and navigation. They are **not** presented as reliable, cable-wide ground truth for whale presence on DAS, and they do not substitute for **selected-channel** interpretation where whale-related response is **sparse** and channel-limited.

## Current baseline philosophy
At the current stage, candidate event timing is derived primarily from **hydrophone spectrogram activity**.

This choice was made because hydrophone spectrograms provide a relatively stable way to flag **intervals of increased acoustic energy** in the selected recordings—useful for **when** to look, not a full statement of **what** happened on every DAS channel.

The project remains **DAS-centered** in the sense that thesis value lies in visualizing and interpreting DAS together with context—but **interpretation of whale-related structure on DAS** must emphasize:

- **selected-channel** and band-focused views (especially for Orca-class data),
- **support layers** (hydrophone score, optional DAS band-pass **support** on the selected trace),
- and explicit limits on **localization** and cable-wide inference.

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
- or cautious use of **selected-channel** DAS features as **support** (not automatic whale labels).

## Thresholding
The current detector uses a robust threshold:

threshold = median(scores) + k × 1.4826 × MAD(scores)

with default k = 3.

This threshold converts a continuous score into candidate event intervals for **navigation**. The continuous score should remain visible as a **support** trace; thresholding should not be read as definitive biological detection.

## Event formation
The current baseline event formation is:

- mark frames with **score > threshold** as active,
- merge runs separated by up to **max_gap_frames**,
- discard very short segments.

This produces candidate event intervals for navigation and exploration.

## Binary event vs score-based representation
The project distinguishes between:

### 1. Event interval
A binary interval is useful for:
- event listing,
- navigation,
- jumping to interesting time regions,
- and summarizing a shot.

Intervals are **candidates**, not validated whale annotations on DAS.

### 2. Event score / activity over time
A continuous score is useful because it shows:
- how strong the hydrophone **activity** evidence is,
- how it changes over time,
- and where thresholding may hide gradual transitions.

Describe this value as:
- activity score,
- hydrophone **support** score,
- or detection **score**,

rather than a strict calibrated whale probability.

## Role of hydrophone
Hydrophone data should remain in the project as:
- a reference timing source,
- a **support layer** for event interpretation and navigation,
- and a synchronized view that often **contrasts** with weak or absent DAS response on many channels.

## Role of DAS (heatmap vs selected channel)
**Aggregated DAS activity (heatmap)** is a **context layer**: it helps visualize coarse structure along the cable over time under preprocessing choices. It should **not** be oversold as a precise event detector or as evidence of uniform acoustic coupling along the full array.

**Selected-channel inspection** is the primary interpretive path for relating **sparse** whale-related evidence to the fiber:

- **Orca:** stronger, more localized response on a **narrow subset** of channels; band-limited / spectrogram views are central.
- **Humpback:** in current DAS data, response tends to be **weaker and noisier**; claims stay **support-level** and tentative.

DAS is **not** used as a standalone, validated baseline detector for whale events across the whole cable.

## Combined hydrophone and DAS evidence
A realistic approach for this dataset is:

- use hydrophone as the baseline **timing/support** layer,
- use **selected-channel** DAS (and optional band-pass **support** score) as **localized** visual evidence,
- use the **heatmap** as **secondary** cable-wide context,
- avoid implying a single joint probability that merges modalities without a justified model.

Disagreement between hydrophone activity and DAS response on many channels is **expected** given sensitivity limits and is analytically meaningful.

## Linking detection score to DAS view
The project does not rely on one combined formula that merges hydrophone and full-cable DAS into a final whale probability. The connection is **synchronized interpretation** in the viewer.

### Hydrophone score
The hydrophone-derived score is used as:
- a time-based guidance signal,
- a **support** score over time,
- and a practical way to identify intervals of increased acoustic activity on the recorder.

### DAS views
- **Heatmap:** **context** for **where** preprocessing shows elevated activity along the cable—not a uniform whale detector.
- **Selected-channel:** primary place to ask whether sparse, band-limited structure is consistent with biological or environmental hypotheses.

### Relationship between the two
Linked through **shared time alignment** and shared interval/cursor: the user inspects the same time window across modalities and channels.

## Localization and cable-wide claims
**Localization** attempts on this dataset have **not** produced reliable results suitable as a thesis centerpiece. The documentation and MVP do **not** treat localization as a core deliverable.

Do not infer precise animal positions from the heatmap alone or from unsupported geometric reasoning without validated methods.

## DAS-centered event representation (honest framing)
The final visual story should combine:

- binary intervals for **navigation**,
- continuous hydrophone **support** over time,
- DAS **heatmap** as **context**,
- **selected-channel** DAS as the main explanatory path for **sparse** whale-related evidence,
- map and **source/context metadata** where available.

The main cable-wide DAS representation remains a **normalized rolling RMS activity map** (or equivalent export); it is appropriate for **context**, not for fine-grained, cable-wide whale event confirmation.

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

These fields support baseline navigation; they do not imply validated DAS ground truth for every channel.

## Current limitations
The current baseline has several limitations:

- it uses a single hydrophone preview channel,
- the score is based on a simple mean over selected spectrogram bins,
- the selected frequency range is only a working baseline,
- time resolution is limited by the STFT configuration,
- there is no species classification,
- there is no calibrated probability model,
- DAS is not a validated, cable-wide event detector; **selected-channel** views matter more than aggregate heatmap peaks for whale-related claims.

## Cable sensitivity limitations
The deployment and processing context imply **limited acoustic sensitivity** on DAS for much of the array. Weak or absent DAS response does **not** prove absence of sound in the water column.

Visualization and thesis narrative should treat low sensitivity as a **known property of the data**, not as a failure to “find whales everywhere.”

## Source ground truth in the interface
When **source** position and related metadata are available and loaded from exports, they provide valuable **context** for synchronized map views. Such fields should be labeled as dataset-provided **context**, not as proof that every hydrophone interval corresponds to a localized DAS signature.

Predicted or estimated animal positions should only appear if a justified estimation pipeline exists; that is **not** a current MVP commitment.

## Open questions
The following questions remain open and should be addressed in the next project stage:

- Is the current hydrophone frequency range sufficient for humpback-related exploration, or should it be expanded?
- Should the score remain a simple spectrogram mean, or should alternative features be tested?
- Should the interface emphasize normalized vs. raw hydrophone score scaling?
- How should **environmental** and coupling-related structure along the cable be surfaced alongside whale-focused views?
- What is the best practical way to combine hydrophone **support** and **selected-channel** DAS without overclaiming?

## Recommended next direction
The current recommendation is:

- keep the baseline detector as a practical **navigation** aid,
- keep binary intervals for jumping in time,
- expose continuous hydrophone **support** over time,
- treat hydrophone as a **support layer**,
- treat DAS **heatmap** as **secondary context**,
- make **selected-channel** inspection central for **sparse** whale-related interpretation,
- expand the **environmental branch** where it clarifies non-whale structure,
- avoid centering the thesis on **localization** or cable-wide DAS whale detection.
