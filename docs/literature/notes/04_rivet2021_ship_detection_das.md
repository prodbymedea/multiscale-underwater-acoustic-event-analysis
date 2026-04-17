# Rivet et al. (2021): Ship Detection Using Distributed Acoustic Sensing on Submarine Fiber Optic Cables

## Citation
Rivet, D., de Cacqueray, B., Sladen, A., Doisy, Y., Roques, A., & Calbris, G. (2021).  
Preliminary assessment of ship detection and trajectory evaluation using distributed acoustic sensing on an optical fiber telecom cable.  
Journal of the Acoustical Society of America, 149(4), 2615–2627.  
https://hal.science/hal-03209679v1

---

## Summary
This paper investigates the use of Distributed Acoustic Sensing (DAS) for detecting and tracking maritime vessels with a submarine telecommunication fiber optic cable. The study is based on measurements from a 41.5 km-long cable offshore Toulon, France, spanning both shallow and deep marine environments.

The authors show that ship-generated acoustic noise produces measurable strain-rate signals on the optical fiber laid on the seafloor. In the experiment, the same tanker was recorded in two situations: first in shallow water at about 85 m depth and about 5.8 km from the coast, and later in deep water at about 2000 m depth and about 20 km from the coast. This design allows the paper to compare how ship signals behave under different propagation conditions.

A central result of the paper is that tanker noise can be identified in DAS data through its spectral structure, Doppler shift, and apparent propagation velocity along the fiber. The study reports that the broadband sensitivity of DAS makes it possible to detect ship-related acoustic energy roughly in the 16–100 Hz range, even though the recorded DAS bandwidth extends much higher. In shallow water, the signal-to-noise ratio is strong enough to recover the ship trajectory using beamforming on densely sampled strain-rate measurements. In deep water, the signal becomes more attenuated, but narrowband components below 50 Hz remain detectable.

The paper also goes beyond simple detection and includes physical interpretation of the recorded patterns. The authors use a ray-based acoustic propagation model to explain the spatial and temporal intensity structure of the ship noise measured on the cable. In particular, they relate the observed patterns to multipath propagation in the water column, cable response, and directional sensitivity of DAS.

Overall, the paper demonstrates that DAS on existing submarine telecom cables can be used as a distributed sensing system for remote monitoring of maritime traffic and vessel tracking, especially in shallow-water settings, while still retaining some detection capability at great depth.

---

## Key Concepts

### DAS-Based Ship Detection
The use of distributed acoustic sensing on submarine fiber optic cables to detect vessel-generated acoustic signals through strain-rate measurements.

### Ship Noise Spectral Signature
Ship noise is described as a combination of broadband noise and narrowband spectral peaks associated with engines, propellers, and rotating mechanical elements.

### Frequency–Wavenumber (f–k) Analysis
A representation of DAS data in frequency and spatial wavenumber used to distinguish moving acoustic sources from environmental or instrumental noise.

### Doppler Shift
Frequency variation caused by source motion, used here to estimate vessel speed from DAS recordings.

### Beamforming
Array-processing applied to DAS measurements along a linear cable section to estimate ship bearing and reconstruct trajectory.

### Ray-Based Acoustic Modeling
A physical modeling approach used to explain the intensity patterns of ship noise measured on the cable in terms of acoustic wave propagation and multipath reflections.

---

## Experimental Setup
Location: Offshore Toulon, France  
Fiber length: 41.5 km  
Cable type: submarine telecom optical fiber  
Depth range: continental shelf to abyssal plain, including approximately 85 m and 2000 m water depth cases  

DAS parameters:
- Gauge length: 19.4 m
- Spatial sampling: 6.4 m
- Sampling frequency: 2 kHz

The study analyzes the passage of the same tanker in two different configurations:
- shallow-water passage at about 5.8 km from shore
- deep-water passage at about 20 km from shore

Ship positions and trajectories were validated with AIS (Automatic Identification System) data.

---

## Data Processing and Analysis

The study uses several analysis methods:

- Time-frequency spectrograms to identify ship-related spectral components
- Power spectral density analysis to compare signal strength and dominant frequencies
- Frequency–wavenumber (f–k) decomposition to isolate moving-source signatures
- Doppler shift analysis to estimate vessel velocity
- Beamforming to estimate ship bearing and trajectory
- Spatial mapping of signal intensity along the fiber
- Ray-based modeling of acoustic wave propagation to interpret observed intensity patterns

These methods are used not only to detect ships, but also to explain how ship noise is recorded by DAS under different environmental conditions.

---

## Main Findings

### Ships Can Be Detected with DAS
The study shows that ship-generated acoustic noise produces detectable strain-rate signals on a submarine telecom cable.

### Detection Is Stronger in Shallow Water
At about 85 m depth, the signal-to-noise ratio is high and the tanker trajectory can be recovered with beamforming. The study reports that the ship can be tracked up to about 2 km away from the cable in this shallow-water case.

### Detection Is Still Possible in Deep Water
At about 2000 m depth, the acoustic signal is more attenuated, but narrowband signals below 50 Hz remain detectable.

### Doppler and f–k Analysis Are Effective
The spectral structure, Doppler shift, and apparent propagation velocity on the fiber help distinguish ship noise from environmental background noise and DAS interrogator noise.

### Physical Modeling Supports Interpretation
The observed spatial and temporal intensity patterns are reasonably explained with a ray-based model of acoustic propagation and DAS cable response.

---

## Limitations

- Signal quality decreases significantly with increasing water depth
- Fiber coupling with the seafloor may vary and affect measurements
- Cable geometry and positioning influence beamforming accuracy
- DAS self-noise and environmental noise can complicate interpretation
- The study is focused on ship noise rather than biological signals such as whale vocalizations

---

## Relevance to Our Project

This paper is relevant because it demonstrates how DAS data can be used not only to detect underwater acoustic sources, but also to interpret their spatial, spectral, and temporal structure. It is especially useful for our project because it treats DAS as the main sensing modality and shows that acoustic events are distributed patterns across the cable rather than isolated one-dimensional signals.

The paper is also important methodologically. It provides examples of spectrogram-based inspection, f–k analysis, Doppler-based interpretation, beamforming, and physically informed modeling. These are valuable ideas for a DAS-centered workflow focused on event visualization, interpretation, and structured analysis.

---

## How We May Use It in the Thesis

- State of the Art section on underwater DAS applications
- Discussion of ship and event detection in DAS data
- Methods section for f–k analysis, Doppler estimation, and beamforming
- Motivation for using DAS as a distributed acoustic sensing system
- Reference for spatially structured visualization of DAS events

---

## Personal Notes

- Very useful as a methodological reference for event detection in DAS
- Strong example of combining signal processing and physical interpretation
- Helpful for understanding how moving acoustic sources appear in DAS
- Good support for treating DAS as a spatial sensing system rather than only a time series source
