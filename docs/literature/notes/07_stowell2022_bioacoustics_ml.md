# 07 — Stowell (2022): Deep Learning for Bioacoustics

## Citation
Stowell, D. (2022).  
Computational bioacoustics with deep learning: a review and roadmap.  
PeerJ, 10:e13152.  
https://doi.org/10.7717/peerj.13152

---

## Summary

This paper provides a comprehensive review of the application of deep learning methods in computational bioacoustics. It explains how modern machine learning techniques are used to analyze animal vocalizations and large-scale acoustic datasets.

A typical processing pipeline is described, where raw audio signals are transformed into spectrogram representations and then analyzed using deep neural networks such as convolutional neural networks (CNNs) and convolutional-recurrent neural networks (CRNNs).

The paper highlights that most bioacoustic ML systems follow a standard workflow:

- audio → spectrogram → neural network → detection/classification output

The authors discuss different types of tasks, including:

- classification (species or call type),
- detection (presence/absence of signals),
- sound event detection (temporal localization of events).

The review also covers important practical aspects such as:

- data augmentation,
- transfer learning,
- handling small datasets,
- and generalization across environments.

---

## Key Concepts

Deep Learning in Bioacoustics  
Application of neural networks (CNN, CRNN) to analyze animal sounds and acoustic environments.

Spectrogram-based Representation  
Transformation of audio signals into time-frequency images used as input to ML models.

Sound Event Detection (SED)  
Task of detecting and localizing acoustic events in time.

Data Augmentation  
Techniques to artificially increase dataset size (noise addition, time shift, mixing).

Transfer Learning  
Using pretrained models (e.g., AudioSet) to improve performance on smaller datasets.

---

## Relevance to Our Project

This paper is highly relevant because it provides a conceptual foundation for moving from simple signal-processing-based detection toward machine learning-based approaches.

The current project uses a baseline event detection method based on hydrophone spectrogram activity and thresholding. This corresponds to early-stage detection pipelines described in the literature.

The review shows how such pipelines can be extended using deep learning models to produce:

- more robust detection,
- continuous confidence scores,
- and improved generalization.

This directly supports the future direction of the project, where event detection may evolve from threshold-based logic toward learned models combining DAS and hydrophone data.

---

## Personal Notes

- ML pipeline = spectrogram + CNN → matches our current direction  
- Our method = simple baseline of this pipeline  
- Good bridge between signal processing and ML  
- Important for future extension (confidence score, ML detection)
