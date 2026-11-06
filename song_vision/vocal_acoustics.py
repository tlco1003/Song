"""Measured acoustic dynamics for SONG's AUDIO -> FACE model, not audio synthesis.

All cues are computed from the already recorded and aligned 16 kHz
singer-only voice. They are acoustic observations, NOT phoneme labels,
vocal-muscle measurements or instructions to open the mouth on every peak.

1 level: linear dBFS mapped from -80..0 dBFS to [0,1]
2 loudnessDelta: 40-ms local level slope, clipped [-1,1]
3 positiveSpectralFlux: spectral-onset proxy, NOT syllable label
4 centroid: frequency brightness normalized by Nyquist
5 lowBand: proportion of magnitude below 1 kHz
6 midBand: proportion 1..3 kHz
7 highBand: proportion above 3 kHz
8 spectralFlatness: noise-like vs tonal spectral shape; not voicing ground truth

Frames align with the existing 80-mel 10-ms hop and 25fps face timeline.
Each model input includes a 610-ms acoustic context, so long vowels and
neighbouring articulation can affect motion even at constant loudness.
"""
from __future__ import annotations

import numpy as np
import torch

from .core import SAMPLE_RATE, HOP, NUM_MELS

CUE_VERSION = "song-vision-singer-acoustic-cues-v1"
CUE_NAMES = (
    "dBFSRelativeLevel", "dBFSSlope40ms", "positiveSpectralFlux",
    "spectralCentroid", "lowBandFraction", "midBandFraction",
    "highBandFraction", "spectralFlatness",
)
CUE_COUNT = len(CUE_NAMES)
CUE_CONTEXT = 61
FFT = 512
WINDOW = 400


def analyze_vocal_cues(waveform: np.ndarray) -> np.ndarray:
    """Return [8, 10-ms frames] from synchronized, isolated singer waveform.

    No hidden model, no generated sound, no invented phone transcript.
    Output is an auxiliary condition and is NOT an acoustic classifier.
    """
    w = np.asarray(waveform, dtype=np.float32)
    if w.ndim != 1 or len(w) < WINDOW or not np.isfinite(w).all():
        raise ValueError("Expected finite mono 16-kHz voice, at least 25 ms")
    if float(np.max(np.abs(w))) > 1.05:
        raise ValueError("Expected calibrated waveform samples between -1 and 1")
    samples = torch.from_numpy(w.copy())
    stft = torch.stft(samples, n_fft=FFT, hop_length=HOP, win_length=WINDOW,
                      window=torch.hann_window(WINDOW), center=True, return_complex=True)
    spectrum = stft.abs().numpy().astype(np.float32)
    t = spectrum.shape[1]
    # Time-domain dBFS, not integrated loudness (LUFS).
    padded = np.pad(w, (WINDOW // 2, WINDOW // 2), mode="constant")
    frames = np.lib.stride_tricks.sliding_window_view(padded, WINDOW)[::HOP]
    frames = frames[:t]
    if len(frames) != t:
        raise ValueError("Audio/STFT timestamp mismatch")
    rms = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1))
    dbfs = np.clip(20.0 * np.log10(np.maximum(rms, 1e-8)), -80.0, 0.)
    level = ((dbfs + 80.0) / 80.0).astype(np.float32)
    # Use 40-ms slope; expressive volume change can be positive or negative.
    older = np.maximum(np.arange(t) - 4, 0)
    slope = np.clip((dbfs - dbfs[older]) / 40.0, -1.0, 1.0).astype(np.float32)
    magnitudes = np.maximum(spectrum, 1e-9)
    norm = magnitudes / np.maximum(magnitudes.sum(axis=0, keepdims=True), 1e-8)
    diff = np.diff(norm, axis=1, prepend=norm[:, :1])
    flux = np.maximum(diff, 0.).sum(axis=0).clip(0., 1.)
    f = np.fft.rfftfreq(FFT, 1. / SAMPLE_RATE).astype(np.float32)
    center = (f[:, None] * norm).sum(axis=0) / (SAMPLE_RATE / 2.)
    low = norm[f < 1000].sum(axis=0)
    mid = norm[(f >= 1000) & (f < 3000)].sum(axis=0)
    high = norm[f >= 3000].sum(axis=0)
    flatness = np.exp(np.mean(np.log(magnitudes), axis=0)) / magnitudes.mean(axis=0)
    cues = np.stack((level, slope, flux, center, low, mid, high, flatness)).astype(np.float32)
    if cues.shape != (CUE_COUNT, t) or not np.isfinite(cues).all():
        raise ValueError("Invalid vocal acoustic cue frame layout")
    if not np.all((cues[[0, 2, 3, 4, 5, 6, 7]] >= -1e-5) &
                  (cues[[0, 2, 3, 4, 5, 6, 7]] <= 1.00001)):
        raise ValueError("Acoustic dynamics outside normalized domain")
    return cues


def cue_window(cues: np.ndarray, seconds: float) -> np.ndarray:
    if (not isinstance(cues, np.ndarray) or cues.ndim != 2 or
            cues.shape[0] != CUE_COUNT or cues.shape[1] == 0 or
            not np.isfinite(cues).all() or not np.isfinite(seconds)):
        raise ValueError("Expected valid acoustic cues [8,T] and timestamp")
    center = round(float(seconds) * SAMPLE_RATE / HOP)
    indexes = np.clip(
        np.arange(center - CUE_CONTEXT // 2, center + CUE_CONTEXT // 2 + 1),
        0, cues.shape[1] - 1,
    )
    return cues[:, indexes].astype(np.float32)
