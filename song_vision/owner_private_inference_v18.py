"""SONG-Vision opt-in inference bridge for privately trained owner v18 checkpoints.

Open-source MODEL ARCHITECTURE ONLY. Nothing here contains owner face data,
weights, biometric features, private media paths, or captured user recordings.
The frontend here reproduces owner-v18 training preprocessing exactly;
other SONG core frontends have different Mel scaling and are not compatible.
This bridge is research-only until owner tests verify actual Korean lip sync.
"""
from __future__ import annotations
import hashlib
import subprocess
from pathlib import Path
import numpy as np
import torch
from torch import nn

SAMPLE_RATE=16000
AUDIO_HOP=160
PHOTO_SIZE=96


class OwnerV18PhotoAudioNet(nn.Module):
    """Shape-compatible architecture for a user-owned private v18 state_dict."""
    def __init__(self):
        super().__init__()
        self.ref=nn.Sequential(
            nn.Conv2d(3,24,4,2,1),nn.GELU(),
            nn.Conv2d(24,48,4,2,1),nn.GELU(),
            nn.Conv2d(48,64,4,2,1),nn.GELU(),
            nn.Conv2d(64,96,4,2,1),nn.GELU())
        self.audio=nn.Sequential(
            nn.Conv1d(80,64,5,padding=2),nn.GELU(),
            nn.Conv1d(64,96,3,padding=1),nn.GELU(),
            nn.AdaptiveAvgPool1d(1),nn.Flatten())
        self.context=nn.Linear(96,96*6*6)
        self.decoder=nn.Sequential(
            nn.ConvTranspose2d(96,64,4,2,1),nn.GELU(),
            nn.ConvTranspose2d(64,48,4,2,1),nn.GELU(),
            nn.ConvTranspose2d(48,24,4,2,1),nn.GELU(),
            nn.ConvTranspose2d(24,3,4,2,1),nn.Tanh())
        axis=torch.linspace(0,1,PHOTO_SIZE)
        yy,xx=torch.meshgrid(axis,axis,indexing='ij')
        mouth=torch.exp(-(((xx-.50)/.38)**2+((yy-.75)/.27)**2)*2)
        cheeks=torch.exp(-(((xx-.50)/.50)**2+((yy-.58)/.35)**2)*2)
        eyes=torch.exp(-(((xx-.50)/.46)**2+((yy-.39)/.19)**2)*2)
        soft=(.88*mouth+.48*cheeks+.35*eyes).clamp(0,1)[None,None]
        self.register_buffer('mask',soft)
        self.register_buffer('mouth',mouth[None,None])

    def forward(self,reference,mel):
        b=reference.shape[0]
        if (reference.shape!=(b,3,PHOTO_SIZE,PHOTO_SIZE)
                or mel.shape!=(b,80,31)
                or not torch.isfinite(reference).all()
                or not torch.isfinite(mel).all()):
            raise ValueError('Private v18 model requires finite 96x96 reference and 80x31 measured Mel')
        conditioning=self.context(self.audio(mel)).reshape(b,96,6,6)
        pred=self.decoder(self.ref(reference)+conditioning)
        return (reference+pred*.50*self.mask).clamp(0,1)


def load_private_owner_v18(checkpoint_path: str | Path):
    """Explicit path only: never retrieve private photos/weights from public URLs."""
    path=Path(checkpoint_path)
    if not path.is_file() or path.suffix!='.pt':
        raise FileNotFoundError('Private user-v18 .pt research checkpoint required')
    payload=torch.load(path,map_location='cpu',weights_only=True)
    if (payload.get('modelVersion')!='SONG-Vision-v18-owner-audio-and-photo-research'
        or payload.get('RAVDESSTrainingWeightsUsed') is not False
        or payload.get('AM630LipSyncAccuracyValidated') is not False):
        raise ValueError('Unexpected checkpoint provenance or falsely certified lip-sync')
    model=OwnerV18PhotoAudioNet()
    model.load_state_dict(payload['soundToFaceStateDict'],strict=True)
    model.eval()
    return model,{
        'modelVersion':payload['modelVersion'],
        'researchOnly':True,
        'KoreanPhoneTimingValidated':False,
        'sourceCheckpointSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'referencePhotoCount':len(payload.get('referencePhotos',[])),
    }


def read_original_audio(audio_path: str | Path):
    """Audio is decoded locally, never uploaded to the assistant or any service."""
    proc=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error',
         '-nostdin','-i',str(audio_path),'-vn','-f','s16le','-ac','1','-ar',
         str(SAMPLE_RATE),'-'],capture_output=True,check=True)
    if len(proc.stdout)<SAMPLE_RATE*2:
        raise ValueError('Source sound shorter than 1 second or missing')
    return np.frombuffer(proc.stdout,dtype='<i2').astype(np.float32)/32768.


def training_compatible_mel(samples:np.ndarray)->np.ndarray:
    samples=np.asarray(samples,dtype=np.float32)
    if samples.ndim!=1 or len(samples)<SAMPLE_RATE or not np.isfinite(samples).all():
        raise ValueError('Finite mono 16-kHz audio with >1s duration required')
    hz=lambda mel:700*(10**(mel/2595)-1)
    mel=lambda h:2595*np.log10(1+h/700)
    edges=hz(np.linspace(mel(0),mel(SAMPLE_RATE/2),82))
    freqs=np.linspace(0,SAMPLE_RATE/2,257)
    filters=np.zeros((80,257),dtype=np.float32)
    for i in range(80):
        a,b,c=edges[i:i+3]
        filters[i]=np.maximum(0,np.minimum((freqs-a)/max(b-a,1e-6),
                                          (c-freqs)/max(c-b,1e-6)))
    spectrum=torch.stft(torch.from_numpy(samples.copy()),n_fft=512,
         hop_length=AUDIO_HOP,win_length=400,window=torch.hann_window(400),
         center=True,return_complex=True)
    return torch.log1p((torch.from_numpy(filters)@spectrum.abs().square())*100).numpy().astype(np.float32)


def frame_audio_window(full_mel:np.ndarray,second:float)->torch.Tensor:
    if (full_mel.ndim!=2 or full_mel.shape[0]!=80 or full_mel.shape[1]==0
            or not np.isfinite(full_mel).all() or not np.isfinite(second)
            or second<0):
        raise ValueError('Expected finite [80,n] Mel and nonnegative frame seconds')
    center=round(float(second)*SAMPLE_RATE/AUDIO_HOP)
    indices=np.clip(np.arange(center-15,center+16),0,full_mel.shape[1]-1)
    return torch.from_numpy(full_mel[:,indices].copy())[None]