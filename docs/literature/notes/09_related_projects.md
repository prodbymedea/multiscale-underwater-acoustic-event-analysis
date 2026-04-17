# 09 — Related Projects and Systems for DAS Acoustic Analysis

## DAS4Whales

Link  
https://github.com/das4whales

Summary  
DAS4Whales is an open-source toolkit for detecting and analyzing whale vocalizations using Distributed Acoustic Sensing (DAS) data.

The project focuses on marine bioacoustics and provides tools for processing DAS signals, extracting features, and detecting whale calls. It is built around real-world DAS datasets and supports practical workflows for underwater acoustic monitoring.

The system demonstrates how DAS can be used as a large-scale sensing platform for biological signal detection.

Key Features
- whale call detection using DAS  
- signal preprocessing and filtering  
- integration with real DAS datasets  
- open-source ecosystem for marine monitoring  

Relevance to Our Project  
Directly related to our domain (marine bioacoustics + DAS).  
Shows how DAS can be used for real event detection pipelines.  
Useful reference for integrating DAS analysis with detection logic.  

Personal Notes  
- very close to our use case  
- good reference for DAS-based detection workflows  
- connects to multispectral/ML approaches  

---

## DASCore

Link  
https://github.com/DASDAE/dascore

Summary  
DASCore is a Python library for processing and analyzing Distributed Acoustic Sensing data.

It provides tools for reading, transforming, and visualizing DAS datasets, as well as performing signal processing operations. The library is designed to standardize workflows for DAS data handling and make analysis reproducible.

Key Features
- data loading and format handling  
- signal processing utilities  
- transformation and filtering  
- scalable DAS data workflows  

Relevance to Our Project  
Forms part of the DAS ecosystem used in our project.  
Supports data preprocessing and pipeline development.  

Personal Notes  
- useful backend tool  
- not focused on visualization/UI  
- complements higher-level systems  

---

## DASPy

Link  
https://github.com/HMZ-03/DASPy

Summary  
DASPy is a lightweight Python toolbox for Distributed Acoustic Sensing data processing.

It provides basic functionality for working with DAS signals, including filtering, visualization, and simple analysis operations.

Key Features
- basic DAS signal processing  
- lightweight and easy to use  
- visualization support  

Relevance to Our Project  
Useful for prototyping and simple processing steps.  
Can be used as a baseline toolkit for DAS data handling.  

Personal Notes  
- simpler than DASCore  
- good for quick experiments  
- limited advanced features  

---

## General Insight

These projects show that current DAS ecosystems are mainly focused on:

- signal processing  
- detection pipelines  
- backend data handling  

However, there is limited focus on:

- interactive visualization  
- synchronized multi-view interfaces  
- user-centered analysis workflows  

This highlights a gap that our project aims to address.
