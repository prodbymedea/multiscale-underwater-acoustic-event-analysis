# Baseline candidate event definition

Implemented in **`src/extract_events_baseline.py`**. This is a **candidate** generator for MVP exploration, not validated ground truth.

## Philosophy

- **Primary signal:** Hydrophone **STFT** already exported as `spectrogram.json` (Recorder **C**, preview channel **Tetra-Top**—same as ingest).
- **DAS:** Not used for detection. Optional **`das_support`** per event: distance bin with largest variability in `das_preview.json` over the event interval (supporting view only).

<!-- I suggest that we actually use both hydrophone and DAS data for detection of whales. Event detected on hydrophone may be or may be not detected on the DAS channels.  -->

## Score (per STFT time frame)

1. Restrict frequencies to **[fmin, fmax]** Hz (default **30–1500** Hz).
<!-- why this range? Humpback whales produce a wide range of sounds, generally vocalizing between 40 Hz and 6 kHz, though some sounds can extend beyond 24 kHz.  listen to their songs: https://dosits.org/galleries/audio-gallery/marine-mammals/baleen-whales/humpback-whale/?vimeography_gallery=12&vimeography_video=226917123 -->
3. **Score** = mean `Sxx_db` over retained frequency bins for that frame.
 <!-- why this score?  -->

## Threshold

\[
\text{threshold} = \mathrm{median}(\text{scores}) + k \cdot 1.4826 \cdot \mathrm{MAD}(\text{scores})
\]

Default **k = 3**. MAD provides a robust spread estimate under heavy-tailed noise.
<!-- discussion needed, there can be better score/threshold pairs even on hydrophone data   -->
## Event formation

- Mark frames with **score > threshold** as active.
- **Merge** runs separated by ≤ **max_gap_frames** (default **2** ≈ 0.2 s).
- Discard segments shorter than **min_duration_s** (default **0.25** s).

## Output fields (per event)

See `output_samples/shots/whales_humpback/events.json` for examples: `event_id`, `shot_id`, `start_time_s`, `end_time_s`, `duration_s`, `score`, `detection_basis`, `notes`, optional `das_support`.

## Limitations

- Single hydrophone channel in spectrogram export. 
- Time resolution limited by STFT hop (~0.1 s in current ingest settings).
- No species or vessel discrimination.

## Possible improvements (still without ML)

- Multi-channel consensus (export more channels in ingest).
- Adaptive threshold per time window.
- Refine boundaries with time-domain envelope on full-rate data (requires reading HDF5 or longer waveform export).

<!-- Overall suggestion: 
0. Questions to ask about this project. What is the main value and impact of this work? Who is the user? What user wants to do with your work, and what kind of information they want to see?  (e.g. marine biologist with little to no bg in computer science, they want to see what is das data and how they can use it for their research. Or DAS data collector, who wants to visualize their own dataset and reuse your pipeline? If instead of humpback whale they want to work on other species/ships, which part of pipeline they need to change? 
1. Create some summary of the dataset. What is in there (coordinates of the cable, what are the data (DAS + hydrophones), metadata (sampling frequency, how many channels etc) 
2. lit review shall be extended. Make a folder with literature, add relevant projects and papers. For each paper/project create a short summary and why it is relevant to this project. Save reference in bibtex for further injection to your latex thesis and most of your "SOTA & Methods" section. 
ideas to look for: https://github.com/hetinghong/DASView https://pubs.geoscienceworld.org/ssa/srl/article/95/5/3055/645865/DASPy-A-Python-Toolbox-for-DAS-Seismology https://dasdae.org etc. 
ML humpback whale detectors https://www.kaggle.com/models/google/humpback-whale - it will work on hydrophones, I think.  will it work on DAS? let's try, perhaps some extra processing is needed. I'll help here! 
If you don't want to use ML (why?) we can create a different pipeline based on spectrogram/MFCC features. 
2. Put  stress on DAS data visualization. 
3. Event definition: if we choose whales or humpback whales in particular, event is "whale call detection probability" from 0 to 1 or 0-100%. Should we have threshold at all?  In the paper the authors say that the cable had sensitivity issues. SHall we add that to visualization? What else can we visualize from this dataset? Ground truth position of emitted signal? predicted position of the emitted signal? MVP definition: ok maybe I was not clear enough, but DAS data is the key data source in this project. Hydrophones may be or may be not used for visualization, on MVP (why? because there is a lot of tools for hydrophone data visualization, no research gap and no MSc work is needed for that)
4. Will the result of this visualization tool be transferable to other DAS datasets? Ask yourself questions, what will be different for different datasets (position of the cable? distance between channels etc). And this should lead you to the answer "what is our inputs and what are our outputs". 
-->
