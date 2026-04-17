# 03 — Bouffaut et al. (2022): Distributed Acoustic Sensing of Baleen Whales in the Arctic

## Citation
Bouffaut, L., Taweesintananon, K., Kriesell, H. J., Rørstadbotnen, R. A., Potter, J. R., Landrø, M., Johansen, S. E., Brenne, J. K., Haukanes, A., Schjelderup, O., & Storvik, F. (2022).  
*Eavesdropping at the speed of light: Distributed acoustic sensing of baleen whales in the Arctic.*  
Frontiers in Marine Science, 9, 901348.  
https://doi.org/10.3389/fmars.2022.901348

---

## Summary
This paper presents the first demonstration of wildlife monitoring using Distributed Acoustic Sensing (DAS). The authors repurposed an existing 120 km submarine fiber-optic cable in Svalbard, Norway, and used it as a distributed acoustic array for detecting baleen whale vocalizations in the Arctic marine environment. The study shows that DAS can record whale sounds over a very long cable with dense spatial sampling, enabling continuous observations from a protected fjord area to the open ocean.

The experiment used a dark fiber within an existing telecommunication cable. The interrogator converted the cable into a DAS array with a spatial sampling interval of 4.08 m and a sampling frequency of 645.16 Hz. This resulted in approximately 30,000 sensing channels distributed along the cable. The cable was trenched into the seafloor and followed bathymetric variations, which made it possible to observe the spatial behavior of underwater acoustic arrivals along the array.

The authors identified multiple types of baleen whale vocalizations, including stereotyped North Atlantic blue whale calls and various non-stereotyped downsweeps that may correspond to blue, fin, humpback, or sei whales. A major contribution of the paper is that it moves beyond single-point passive acoustic monitoring and demonstrates the value of distributed sensing. The study introduces spatio-temporal and spatio-spectral visualizations that reveal how whale calls propagate along the cable and how multiple vocalizing individuals can be separated in space.

The paper also shows that DAS can be used not only for detection but also for localization and tracking. By analyzing time differences of arrival across the cable, the authors estimate the position of vocalizing whales and track their movement along the array. In one example, they estimate the motion of a blue whale and beamform its signal to improve signal-to-noise ratio and reconstruct higher-quality audio. In addition, the study explores an unusual application in which whale calls are used as passive sources for subsurface exploration, producing interpretable seismic profiles from naturally occurring marine mammal vocalizations.

Overall, this paper is a foundational reference for DAS-based whale monitoring. It demonstrates that DAS can provide continuous spatial acoustic sensing at scales and resolutions that are difficult to achieve with conventional hydrophone deployments, and it highlights the potential of DAS for real-time, large-scale, and cost-effective marine mammal monitoring.

---

## Key Concepts

### Distributed Acoustic Sensing for Marine Wildlife
Use of existing submarine fiber-optic cables as dense sensor arrays for recording and analyzing marine animal vocalizations.

### Spatio-Temporal Representation
A time-versus-distance representation of DAS data showing how acoustic arrivals propagate along the cable.

### Spatio-Spectral Representation
A frequency-versus-distance view that helps distinguish whale call types and examine their spatial distribution.

### Localization and Tracking
Estimating whale position and movement along the cable using time differences of arrival and beamforming.

### Passive Acoustic Monitoring at Scale
Monitoring marine mammals over tens or hundreds of kilometers with continuous spatial coverage rather than isolated recording points.

---

## Experimental Setup
- Location: Svalbard, Norway  
- Existing submarine telecommunication fiber-optic cable  
- Cable length used for DAS: 120 km  
- Spatial sampling: 4.08 m  
- Sampling frequency: 645.16 Hz  
- Approximate number of sensing channels: 30,000  
- Recording duration: 44 days  

The fiber followed the bathymetry and connected Longyearbyen to Ny-Ålesund, crossing both fjord and open-ocean environments.

---

## Main Findings

### Whale Vocalizations Were Successfully Recorded
The DAS array captured multiple baleen whale vocalizations, including stereotyped blue whale calls and a range of non-stereotyped downsweeps.

### DAS Enabled Spatially Distributed Monitoring
Unlike hydrophones at isolated locations, DAS provided continuous sensing along the entire cable, allowing the authors to observe where signals were strongest and how they propagated along the array.

### Multiple Individuals Could Be Distinguished
The distributed measurements revealed situations where several vocalizing whales were present at different positions along the cable.

### Whale Positions Could Be Estimated
Using time-difference information, the authors localized and tracked vocalizing whales along the fiber-optic cable.

### Whale Calls Could Be Used for Passive Seismic Imaging
The study explored the possibility of using whale vocalizations as natural acoustic sources for subsurface exploration, producing correlated seismic profiles.

---

## Limitations
- DAS generated extremely large data volumes, around several terabytes per day  
- Species identification remained difficult for heterogeneous call types such as downsweeps  
- System calibration was not performed, so results were presented in strain units rather than acoustic pressure  
- DAS response depends on gauge length, wave frequency, grazing angle, and local coupling between cable and seafloor  
- Practical large-scale use requires automated detection and big-data processing workflows  

---

## Relevance to Our Project
This paper is one of the most important references for our project because it provides a real and highly relevant example of whale monitoring with DAS in a marine environment. It is especially valuable because it keeps DAS itself as the central sensing modality rather than using hydrophones as the primary source of logic. The paper shows how DAS data can be visualized through spatio-temporal and spatio-spectral plots, how vocalizing whales can be localized along the cable, and how multiple individuals can be separated in space.

This is directly relevant to our project’s shift toward DAS-centered visualization and event-oriented interpretation. It also supports the idea that DAS can be used not only for detecting an event, but for understanding where along the cable activity occurs, how it evolves over time, and how it can be represented visually in a meaningful way.

---

## How We May Use It in the Thesis
- State of the Art section for whale monitoring with DAS  
- Motivation for DAS as an alternative or complement to sparse hydrophone deployments  
- Reference for spatio-temporal and spatio-spectral visualization design  
- Support for discussing per-channel or distributed event representation  
- Discussion of localization and tracking possibilities in DAS-based marine monitoring  
- Reference for big-data challenges and the need for automated processing  

---

## Personal Notes
- Foundational whale DAS paper  
- Very strong support for DAS-centered project framing  
- Particularly useful for visualization ideas, not just detection  
- Important reference when explaining why distributed sensing offers more than single-point monitoring  
