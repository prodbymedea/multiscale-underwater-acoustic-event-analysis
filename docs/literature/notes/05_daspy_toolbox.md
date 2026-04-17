# 05 — DASPy: A Python Toolbox for DAS Seismology

## Citation
Hu, M., & Li, Z. (2024).  
DASPy: A Python Toolbox for DAS Seismology.  
Seismological Research Letters, 95(5), 3055–3066.  
https://hmz-03.github.io/files/Hu,%20Li%20-%202024%20-%20DASPy%20A%20Python%20Toolbox%20for%20DAS%20Seismology.pdf

---

## Summary
This paper presents **DASPy**, an open-source Python toolbox designed specifically for processing and analyzing Distributed Acoustic Sensing (DAS) data. The motivation of the work is that DAS data differ significantly from traditional seismic recordings: they are extremely large in volume, spatially dense, based on axial strain or strain-rate measurements, and often contain complex noise patterns. These properties make DAS data difficult to process for researchers who are new to the field.

To address this problem, the authors introduce DASPy as a practical and user-friendly software package that combines both standard seismic processing routines and DAS-specific algorithms. The toolbox includes modules for preprocessing, filtering, frequency analysis, visualization, denoising, waveform decomposition, channel analysis, and conversion from strain to ground-motion quantities such as velocity.

The article is not only a software description but also a tutorial-style overview of how DASPy can be used in practice. The authors demonstrate the toolbox on multiple openly available DAS datasets, including earthquake, traffic, and ocean-bottom recordings. These examples show that DASPy supports real data analysis workflows rather than being only a theoretical or experimental codebase.

One of the important contributions of the paper is that it organizes DAS data processing into two groups of tools: **basic tools** and **advanced tools**. The basic tools include standard operations such as trimming, filtering, downsampling, spectrum analysis, spectrogram generation, and f-k transforms. The advanced tools focus on DAS-specific problems such as spike removal, common-mode noise suppression, curvelet denoising, waveform decomposition, channel location interpolation, low-quality channel detection, and strain-to-velocity conversion.

The paper also emphasizes interoperability. DASPy supports multiple file formats and can interact with other software ecosystems such as ObsPy and DASCore. This makes it useful not only as a standalone processing package but also as part of broader DAS workflows.

Overall, the paper positions DASPy as an important practical resource for researchers working with DAS data, especially those who need accessible tools for visualization, preprocessing, denoising, and interpretation.

---

## Key Concepts

### DAS-Specific Data Processing
DAS data require specialized processing because they are based on axial strain or strain rate, have very dense spatial sampling, and often contain large data volumes and complex noise.

### Basic Tools
The toolbox includes standard seismic processing routines such as filtering, spectrogram generation, f-k transforms, trimming, stacking, tapering, detrending, and plotting.

### Advanced Tools
DASPy also includes DAS-specific functions such as spike removal, common-mode noise removal, stochastic noise suppression, waveform decomposition, channel quality analysis, and strain-to-velocity conversion.

### Channel Analysis
The toolbox provides utilities for estimating channel locations, detecting turning points in fiber geometry, and identifying low-quality channels caused by poor coupling or installation issues.

### DAS Visualization
The package supports waveform plots, spectrograms, spectra, and f-k representations, which are especially important for interpreting DAS events and comparing patterns across channels.

### Noise Removal
The paper discusses multiple kinds of DAS noise, including spike noise, common-mode noise, stochastic noise, and coherent noise, and provides dedicated methods for reducing them.

### Wavefield Decomposition
DASPy can separate signals with different apparent velocities using f-k filtering and curvelet-based methods, which helps distinguish meaningful signals from unwanted coherent noise.

### Strain-to-Velocity Conversion
Because DAS measures strain or strain rate rather than direct particle velocity, the toolbox includes methods for converting DAS measurements into ground-motion velocity estimates.

---

## Toolbox Structure

The paper divides DASPy into two main groups:

### Basic Tools
- preprocessing
- trimming
- tapering
- downsampling
- detrending
- stacking
- normalization
- filtering
- spectrum analysis
- spectrogram generation
- f-k transform
- visualization

### Advanced Tools
- spike removal
- common-mode noise removal
- curvelet denoising
- waveform decomposition
- channel location interpolation
- turning point detection
- low-quality channel checking
- f-k rescaling
- curvelet conversion
- slowness-based strain-to-velocity conversion

---

## Data and Demonstration
The authors demonstrate DASPy on several public DAS datasets, including:

- RAPID ocean-bottom DAS data
- Ridgecrest earthquake DAS data
- Stanford DAS array data
- Brady geothermal field DAS and geophone data

These examples are used to show how the toolbox performs on real recordings of earthquakes, whale-related ocean data, traffic signals, and other distributed sensing scenarios.

---

## Main Findings

### DASPy Provides a Practical DAS Processing Workflow
The paper shows that DASPy is not just a collection of isolated functions but a coherent processing framework for real DAS analysis tasks.

### The Toolbox Covers Both Standard and DAS-Specific Operations
A major strength of DASPy is that it combines familiar seismic analysis routines with methods tailored specifically to DAS data characteristics.

### Visualization Is a Core Part of DAS Analysis
The article makes clear that spectrograms, waveform plots, and f-k representations are essential tools for understanding DAS recordings and interpreting events.

### Noise Handling Is Especially Important for DAS
The toolbox devotes substantial attention to denoising because DAS data commonly contain spike noise, common-mode noise, stochastic noise, and coherent noise.

### DASPy Supports Open and Reproducible Research
Because the package is open source and demonstrated on public datasets, it supports reproducible workflows and lowers the entry barrier for new DAS researchers.

### Interoperability Increases Its Practical Value
Its compatibility with tools such as ObsPy and DASCore makes DASPy useful within larger Python-based data analysis pipelines.

---

## Limitations

- The toolbox is mainly focused on DAS seismology, even though some methods are useful beyond seismology
- Some processing operations may be computationally expensive for very large DAS datasets
- Pure Python implementation may reduce speed for heavy workloads
- Some advanced functions depend on assumptions that may not hold equally well for every DAS dataset
- The paper focuses more on processing infrastructure than on machine learning or end-to-end event classification

---

## Relevance to Our Project
This paper is highly relevant to our project because it directly addresses **practical processing and visualization of DAS data**. Unlike purely theoretical DAS papers, this work provides a concrete toolbox that can be used for filtering, spectrogram generation, f-k analysis, denoising, channel inspection, and waveform interpretation.

It is especially useful for our project because our literature review is not only about DAS applications, but also about the **software and methodological ecosystem** around DAS. DASPy fits exactly into that category. It helps us justify the software side of the project and gives us a strong reference for how DAS data can be visualized and processed in Python.

The paper is also important because it connects DAS with tools and workflows that are close to what we may need in our own work: preprocessing pipelines, channel quality control, noise removal, event-oriented visualization, and compatibility with other open-source tools.

---

## How We May Use It in the Thesis

- Literature review section on DAS software and toolboxes
- State of the Art section on practical DAS data processing
- Methods section when discussing preprocessing and visualization workflows
- Reference for spectrogram, f-k, and denoising methods in DAS
- Motivation for using Python-based open-source DAS tools
- Background for discussing reproducible DAS research workflows

---

## Personal Notes

- Very useful not as an application paper, but as a methodology and tooling paper
- Strong reference for the “DAS toolboxes / projects” part suggested by the supervisor
- Especially relevant for visualization, denoising, and preprocessing
- Good bridge between raw DAS signals and usable analysis workflows
- Should definitely remain in the literature review because it strengthens the technical side of the project
