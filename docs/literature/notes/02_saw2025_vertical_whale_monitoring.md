# 02 — Saw et al. (2025): Distributed Acoustic Sensing for Whale Vocalization Monitoring

## Citation
Saw, J., Luo, L., Chu, K., Ryan, J., Soga, K., & Wu, Y. (2025).  
*Distributed acoustic sensing for whale vocalization monitoring: A vertical deployment field test.*  
Seismological Research Letters, 96(2A), 801–815.  
https://escholarship.org/uc/item/3cg9t6fz


---

## Summary
This paper presents a field study of Distributed Acoustic Sensing (DAS) for monitoring whale vocalizations using a vertically deployed fiber-optic cable in Monterey Bay, California. The study is motivated by the need for acoustic monitoring in the context of floating offshore wind turbine (FOWT) development, where both environmental impact assessment and structural monitoring are important.

Unlike most previous underwater DAS studies based on relatively stable seafloor cable deployments, this work investigates DAS performance in a dynamic and non-stationary environment. The DAS cable was deployed vertically from a research vessel using a weighted mooring line, while the interrogator remained on board the vessel. This setup introduced substantial noise from boat motion, wave action, turbulence, cable vibration, and strain, making the experiment particularly relevant for real-world engineered offshore settings.

The authors show that humpback whale vocalizations can be captured and identified in DAS data despite these challenging conditions. DAS recordings were compared with two hydrophone-based references: a standalone hydrophone attached to the mooring line and a nearby hydrophone from the MARS cabled observatory. This comparison demonstrated that DAS is capable of recording biologically meaningful acoustic signals, although signal quality is affected by environmental noise and deployment conditions.

A particularly important contribution of the study is the use of looped sections of the fiber to reduce the noise floor and mitigate excessive cable vibrations and strain. The authors show that these looped sections improved signal quality and increased the signal-to-noise ratio compared to the linear cable configuration. The study also describes practical processing steps, including frequency band extraction, spectrogram analysis, spectral baseline subtraction, channel averaging, and conversion of denoised DAS signals into audio for interpretation.

Overall, the paper demonstrates that DAS can be used for underwater acoustic monitoring of whales in challenging deployment conditions and suggests that vertically deployed DAS systems may become useful for future monitoring near floating offshore wind infrastructure.

---

## Key Concepts

### Vertical DAS Deployment
A deployment geometry in which the sensing fiber is suspended vertically in the water column rather than laid horizontally on the seafloor.

### Dynamic and Non-Stationary DAS Environment
A DAS configuration in which the interrogator and cable are affected by moving-platform conditions, wave motion, and cable strain, unlike more stable conventional DAS deployments.

### Looped Cable Sections
Sections of the sensing cable intentionally shaped into loops to reduce vibration transfer, lower the noise floor, and improve signal quality.

### Spectral Baseline Subtraction
A denoising method in which the median spectral power is subtracted from each time frame of the spectrogram to suppress persistent background noise while preserving transient signals such as whale calls.

### DAS-Hydrophone Comparison
A validation strategy in which DAS observations are compared with conventional hydrophone recordings to assess signal quality and interpretability.

---

## Experimental Setup
- Location: Monterey Bay, California  
- DAS cable deployed vertically from a research vessel  
- Maximum deployment depth: approximately 420 m  
- DAS interrogator located inside the boat cabin  
- Effective sampling rate: 10 kHz  
- Channel spacing: approximately 1 m  
- Gauge length: 4.08 m  

The system was tested under multiple cable configurations, including a linear weighted configuration and a configuration with three looped cable sections positioned at different depths.

---

## Data Processing and Analysis
The study used several signal analysis and enhancement steps:

- Frequency Band Extraction (FBE) to inspect energy within selected frequency bands  
- Waterfall plots to evaluate channel quality and spatial-temporal noise patterns  
- Spectrograms for time-frequency analysis of candidate signals  
- Spectral baseline subtraction using median frequency content to reduce persistent noise  
- Averaging across channels in looped sections to improve signal quality  
- Audio reconstruction from denoised DAS spectrograms for interpretation and comparison  

These steps helped identify channels with lower ambient noise and made whale vocalizations easier to detect.

---

## Main Findings

### Whale Vocalizations Were Detected in DAS Data
The study successfully captured humpback whale vocalizations in the vertically deployed DAS data, demonstrating that DAS can be used for marine mammal acoustic monitoring even in a noisy and dynamic environment.

### Looped Sections Improved Signal Quality
The looped cable configuration reduced noise and improved the signal-to-noise ratio compared with the linear configuration. These sections effectively acted as more stable sensing regions.

### DAS Was Comparable to Hydrophones for This Use Case
DAS recordings were compared with a standalone hydrophone and the MARS hydrophone. Although hydrophones still provided better signal quality in some cases, DAS was able to capture comparable acoustic events and meaningful spectral patterns.

### Noise Was a Major Practical Challenge
The dataset was strongly affected by multiple noise sources, including engine noise, wave motion, water currents, cable vibration, and strain-induced artifacts. This makes the paper especially useful for understanding the limitations of DAS in engineered offshore settings.

---

## Limitations
- High sensitivity to deployment-related noise  
- Strong influence of cable motion and strain on signal quality  
- Lower-frequency whale species may be harder to detect when low-frequency noise is dominant  
- Interpretation of DAS data requires careful channel selection and denoising  
- DAS performance in such environments still requires further validation against conventional hydrophones  

---

## Relevance to Our Project
This paper is highly relevant because it demonstrates DAS-based whale vocalization monitoring in a challenging underwater environment and keeps DAS itself as the main sensing modality. It is particularly useful for our project because it shows how DAS can be used beyond standard seafloor cable deployments, discusses signal quality issues in detail, and presents practical processing and visualization strategies such as waterfall plots, spectrograms, channel selection, denoising, and DAS-hydrophone comparison.

The paper is also valuable because it helps us think about DAS not only as a signal source but also as a system with spatial structure, deployment constraints, and noise behavior. This is closely aligned with our project’s shift toward DAS-centered visualization and event-oriented interpretation.

---

## How We May Use It in the Thesis
- State of the Art section for underwater DAS whale monitoring  
- Motivation for DAS-based marine bioacoustic applications  
- Discussion of practical DAS limitations and noise sources  
- Methods discussion for visualization and signal enhancement ideas  
- Justification for using hydrophones as a supporting reference rather than the primary modality  

---

## Personal Notes
- Very useful paper for showing that DAS can work in non-ideal marine conditions  
- Strong link between monitoring, visualization, and signal quality assessment  
- Looped fiber sections are a particularly interesting practical idea  
- Good reference for explaining why DAS data quality and deployment geometry matter  
