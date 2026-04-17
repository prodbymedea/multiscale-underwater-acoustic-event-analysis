# 06 — DASCore: A Python Library for Distributed Fiber Optic Sensing (DASDAE Ecosystem)

## Citation
Chambers, D. et al. (2024).  
DASCore: A Python Library for Distributed Fiber Optic Sensing.  
(preprint, under review in Seismica)  
https://doi.org/10.31223/X5B978

---

## Summary
This paper introduces **DASCore**, an open-source Python library designed for processing, managing, and visualizing Distributed Acoustic Sensing (DAS) data. The motivation for this work lies in the current lack of mature and unified software tools for handling large-scale DAS datasets, which are often massive, complex, and stored in a variety of formats.

DASCore is not just a collection of signal processing functions, but a **data-centric framework** that provides a structured and scalable way to work with DAS data. It offers an object-oriented interface inspired by libraries such as ObsPy and Xarray, allowing users to perform common data transformations, filtering, querying, and visualization tasks in a consistent and reproducible way.

A key contribution of DASCore is its design around two central data structures: **Patch** and **Spool**. A Patch represents a chunk of DAS data along with its metadata, while a Spool provides a unified interface for accessing and querying collections of DAS data from files, archives, or remote sources. This abstraction allows DASCore to handle both small datasets and large-scale archives efficiently.

The library also supports multiple DAS file formats, provides basic visualization tools such as waterfall and wiggle plots, and integrates with parallel and cloud-based processing frameworks. These features make it suitable for large-scale data analysis workflows, including real-time monitoring and distributed computing.

Importantly, DASCore is positioned as the **foundational component of the DAS Data Analysis Ecosystem (DASDAE)**. Its primary goal is to enable the development of other tools, pipelines, and applications on top of a common infrastructure for DAS data handling.

---

## Key Concepts

### DAS Data Management
DASCore focuses on managing large and complex DAS datasets, including indexing, querying, chunking, and handling data stored across multiple files or archives.

### Patch Data Structure
A Patch represents a multi-dimensional DAS data object, including:
- raw data array
- coordinate information (e.g., time, distance)
- metadata attributes

It is immutable, meaning operations return new objects rather than modifying existing data.

### Spool Data Structure
A Spool acts as a unified interface for accessing collections of DAS data. It allows querying, selecting, and iterating over large datasets, regardless of whether they are stored locally or remotely.

### Processing and Transformations
DASCore provides methods for filtering, tapering, and transforming DAS data. These operations are implemented as methods applied to Patch objects.

### Visualization
The library supports basic visualization tools:
- waterfall plots (2D color maps of DAS data)
- wiggle plots (trace-based seismic-style visualization)

These are commonly used for interpreting DAS signals.

### File Format Support
DASCore supports reading, writing, and scanning multiple DAS file formats, including HDF5-based formats, SEG-Y, TDMS, and others.

### Parallel and Scalable Processing
The framework is designed to support parallel processing using tools like multiprocessing or Dask, enabling analysis of large datasets.

### DASDAE Ecosystem
DASCore serves as the foundation for the broader DAS Data Analysis Ecosystem (DASDAE), which aims to standardize and expand tools for DAS data analysis.

---

## Toolbox Structure

### Core Components
- Patch (data container)
- Spool (data access and querying)

### Functionalities
- data loading and saving
- metadata handling
- filtering and transformations
- data selection and slicing
- visualization (waterfall, wiggle)
- archive indexing and querying
- parallel processing support

---

## Main Contributions

### A Unified DAS Data Framework
DASCore provides a consistent structure for handling DAS data, which simplifies workflows and reduces the need for custom scripts.

### Scalable Data Processing
The framework is designed to handle large datasets efficiently through chunking, indexing, and parallelization.

### Interoperability
It integrates with Python tools such as ObsPy and supports multiple file formats, enabling flexible workflows.

### Foundation for DASDAE
The library acts as the base layer for a broader ecosystem of DAS tools and applications.

---

## Limitations

- The manuscript is currently a preprint and not yet peer-reviewed
- Visualization tools are basic compared to specialized plotting libraries
- Focus is more on data management and infrastructure than advanced signal processing
- Performance may be limited by Python for extremely large-scale computations
- The ecosystem (DASDAE) is still under development

---

## Relevance to Our Project
This paper is highly relevant because it represents the **infrastructure layer** of DAS data analysis. While other works focus on specific applications such as whale detection or signal processing, DASCore provides the underlying tools required to manage, process, and visualize DAS data at scale.

It complements DASPy by addressing a different aspect of DAS workflows: whereas DASPy focuses more on signal processing algorithms, DASCore focuses on data organization, scalability, and integration. Together, these tools form a comprehensive ecosystem for DAS-based research.

For our project, DASCore is particularly important for:
- handling large DAS datasets
- building reproducible processing pipelines
- integrating visualization and preprocessing steps
- supporting scalable workflows for event detection and analysis

---

## How We May Use It in the Thesis

- Literature review section on DAS tools and ecosystems
- State of the Art (software and data processing frameworks)
- Methods section (data handling and preprocessing pipelines)
- Justification for using Python-based DAS tools
- Background for scalable and reproducible DAS workflows

---

## Personal Notes

- Very important for the “tools and ecosystem” part of the literature review
- Complements DASPy rather than replacing it
- Strong argument for using structured pipelines instead of ad-hoc scripts
- Useful for understanding how large DAS datasets are handled in practice
- Should be cited together with DASPy when discussing software tools
