"""SONG-Vision v21 music loudness is an optional *amplitude modifier* only.

Actual Hangul text and externally reviewed phoneme times are required to claim
song lip sync. This module NEVER infers lyrics, phones, or time boundaries
from amplitude, and NEVER alters the vowel chosen by the text engine.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import math
import subprocess
import numpy as np

SAMPLE_RATE=16000
HOP_SECONDS=.02

@dataclass(frozen=True)
class Loudness:
    hop_seconds:float
    values:np.ndarray
    kind:str='RMS_20MS_NORMALIZED_NOT_PHONEME_ALIGNMENT'

    def at(self,second:float)->float:
        if not math.isfinite(second) or second<0:raise ValueError('Invalid audio clock time')
        if not len(self.values):raise ValueError('Empty audio loudness profile')
        index=min(len(self.values)-1,max(0,int(round(second/self.hop_seconds))))
        return float(self.values[index])


def mono_from_audio(audio_path:str|Path)->np.ndarray:
    path=Path(audio_path)
    if not path.is_file():raise FileNotFoundError(path)
    completed=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-i',str(path),
         '-vn','-ac','1','-ar',str(SAMPLE_RATE),'-f','f32le','-'],
         capture_output=True,check=True)
    samples=np.frombuffer(completed.stdout,dtype='<f4').astype(np.float32)
    if len(samples)<SAMPLE_RATE or not np.isfinite(samples).all():
        raise ValueError('Need at least one second of finite original audio')
    return samples


def rms_envelope(samples:np.ndarray,hop_seconds:float=HOP_SECONDS)->Loudness:
    x=np.asarray(samples,dtype=np.float32)
    if x.ndim!=1 or len(x)<SAMPLE_RATE or not np.isfinite(x).all():
        raise ValueError('Finite mono audio for >=1 second required')
    if not (.01<=hop_seconds<=.08):raise ValueError('Audio window hop must be 10-80ms')
    hop=int(round(hop_seconds*SAMPLE_RATE));window=max(hop,round(.04*SAMPLE_RATE))
    # Windowed RMS tracks magnitude, not the sound's actual phoneme identity.
    power=x.astype(np.float64)**2
    cumulative=np.r_[0.,np.cumsum(power)]
    starts=np.arange(0,len(x),hop,dtype=np.int64)
    ends=np.minimum(starts+window,len(x))
    rms=np.sqrt((cumulative[ends]-cumulative[starts])/(ends-starts)).astype(np.float32)
    # 100ms smoothing suppresses 50Hz periodic envelope flicker.
    smooth_frames=max(1,round(.10/hop_seconds))
    if smooth_frames>1:
        padded=np.pad(rms,(smooth_frames//2,smooth_frames-1-smooth_frames//2),mode='edge')
        rms=np.convolve(padded,np.ones(smooth_frames)/smooth_frames,mode='valid').astype(np.float32)
    p95=float(np.percentile(rms,95))
    if p95<1e-8:
        normal=np.zeros_like(rms)
    else:
        noise=float(np.percentile(rms,5))
        normal=np.clip((rms-noise)/max(p95-noise,1e-8),0,1)
    return Loudness(hop_seconds,np.asarray(normal,dtype=np.float32))


def audio_conditioned_text_pose(intervals,second:float,loudness:Loudness):
    """Only scales jaw/opening of a vowel already selected from user lyrics.

    The attached status remains PREVIEW_UNALIGNED if lyric timings weren't
    independently reviewed. Returning a pose does not certify sync.
    """
    try:
        from .owner_v21_text_viseme import pose_at
    except ImportError:
        from owner_v21_text_viseme import pose_at
    energy=loudness.at(second)
    pose,status=pose_at(intervals,second,energy=energy)
    return pose,dict(status,energy=round(energy,4),energySource=loudness.kind)