"""SONG-Vision v14 trainable FULL 96x96 facial-region renderer + same-vocal audit.

This is a learned 96x96 image inpainting renderer covering mouth, chin,
cheeks, nasolabial region, eyes and brows, not merely a 64px lip crop.
It is an experimental low-resolution renderer, NOT verified photorealism.

Source face is an *earlier/different* reference frame, never the target
current video frame; acoustic inputs come from the matching original vocal
recording. All facial reference copying outside the dynamic region is
identified explicitly and excluded from quality claims.

Held-out paired evaluation contrasts EXACT SAME original vocal segment,
the ground-truth actor video frame, reference-copy baseline, and deliberately
MISALIGNED recorded vocal. It logs temporal and image reconstruction
metrics; it never declares perfect lip sync on a convenient low MAE alone.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import Dataset, DataLoader

from .core import FACE_SIZE, AUDIO_CONTEXT, NUM_MELS, tensor_patch
from .facial_articulation_v10 import _crop_mouth
from .staged_face_v13 import (
    StagedSingingFaceNet, MODEL_VERSION as MOTION_MODEL_VERSION,
)
from .voice_to_face_v11 import VoiceFaceFrames
from .vocal_acoustics import CUE_COUNT, CUE_CONTEXT

MODEL_VERSION="song-vision-full-visible-face-inpainting-v14"
ZONE_NAMES=("brows_eyes","cheeks_zygomatic","mouth_chin")


def dynamic_region_masks(device=None):
    """Conservative IMAGE layout masks, not annotated muscle anatomy."""
    regions=torch.zeros(3,1,FACE_SIZE,FACE_SIZE,device=device)
    # 96x96 face crops at standard consistent detector ROI orientation.
    regions[0,:,18:53,12:84]=1.  # brows and eyelids
    regions[1,:,47:77,9:87]=1.   # cheek tissue/zygomatic projected pixels
    regions[2,:,60:94,15:81]=1.  # mouth, nasolabial lower/upper chin
    whole=regions.amax(dim=0,keepdim=True)
    return whole,regions


class FullFaceVocalRenderer(nn.Module):
    """Masked-reference full face pixels conditioned on recorded singing.

    Inference inputs: static 96px reference, 80x21 Mel and 8x61 measured
    sound dynamics, 38D learned surface motion, 4D eye-center coordinates.
    Mouth pixels from stage-v13 are an *auxiliary* hint. No sound generated.
    """
    def __init__(self):
        super().__init__()
        self.image_encoder=nn.Sequential(
            nn.Conv2d(7,32,4,2,1),nn.GELU(),
            nn.Conv2d(32,64,4,2,1),nn.GELU(),
            nn.Conv2d(64,96,4,2,1),nn.GELU(),
            nn.Conv2d(96,128,4,2,1),nn.GELU(),
        )
        self.mel_encoder=nn.Sequential(
            nn.Conv1d(NUM_MELS,48,3,padding=1),nn.GELU(),
            nn.AdaptiveAvgPool1d(4),nn.Flatten(),nn.Linear(48*4,96),nn.GELU(),
        )
        self.cue_encoder=nn.Sequential(
            nn.Conv1d(CUE_COUNT,32,5,padding=2),nn.GELU(),
            nn.AdaptiveAvgPool1d(4),nn.Flatten(),nn.Linear(32*4,64),nn.GELU(),
        )
        # 38 observed face coefficients, 4 eye centre 2D proxies, and
        # 96 spectral+64 amplitude cues.
        self.condition=nn.Sequential(
            nn.Linear(38+4+96+64,256),nn.GELU(),
            nn.Linear(256,128*6*6),nn.Tanh(),
        )
        self.decoder=nn.Sequential(
            nn.ConvTranspose2d(128,96,4,2,1),nn.GELU(),
            nn.ConvTranspose2d(96,64,4,2,1),nn.GELU(),
            nn.ConvTranspose2d(64,32,4,2,1),nn.GELU(),
            nn.ConvTranspose2d(32,3,4,2,1),nn.Sigmoid(),
        )

    def forward(self, static_face, mel, cues, face_motion, eye_motion):
        if (static_face.ndim!=4 or static_face.shape[1:]!=(3,FACE_SIZE,FACE_SIZE)
                or mel.ndim!=3 or mel.shape[1:]!=(NUM_MELS,AUDIO_CONTEXT)
                or cues.ndim!=3 or cues.shape[1:]!=(CUE_COUNT,CUE_CONTEXT)
                or face_motion.ndim!=2 or face_motion.shape[1]!=38
                or eye_motion.ndim!=2 or eye_motion.shape[1]!=4
                or not len(static_face)==len(mel)==len(cues)==len(face_motion)==len(eye_motion)):
            raise ValueError("Full-face renderer inputs have wrong audio/face/time shapes")
        zone,_=dynamic_region_masks(static_face.device)
        # Identity and nondynamic background supplied by *reference* only.
        hidden=static_face*(1.-zone)+.5*zone
        blurred=F.avg_pool2d(static_face,kernel_size=13,stride=1,padding=6)
        image_input=torch.cat((hidden,blurred,zone.expand(len(static_face),-1,-1,-1)),dim=1)
        visual=self.image_encoder(image_input)
        fused=torch.cat((
            face_motion,eye_motion,
            self.mel_encoder(mel),
            self.cue_encoder(cues),
        ),dim=1)
        generated=self.decoder(visual+self.condition(fused).view(-1,128,6,6))
        # Non-dynamic regions are explicitly copied, not attributed to
        # learned reconstruction. Only masked regions are quality evaluated.
        return static_face*(1.-zone)+generated*zone


class FullFaceVideoFrames(VoiceFaceFrames):
    """Real video target SAME frame-time as the original singing recording."""
    def __getitem__(self,i):
        base=super().__getitem__(i)
        folder,current,*_=self.records[i]
        image=cv2.imread(str(folder/"frames"/current["file"]))
        if image is None or image.shape!=(FACE_SIZE,FACE_SIZE,3):
            raise FileNotFoundError("Actual heldout target face frame is missing")
        return (
            base[0],base[1],base[2],tensor_patch(image),
            base[3],base[4],base[8],base[9],
        )


def region_mae(generated: torch.Tensor, observed: torch.Tensor,
               roi: torch.Tensor) -> torch.Tensor:
    if generated.shape!=observed.shape or generated.ndim!=4 or generated.shape[1:]!=(3,96,96):
        raise ValueError("Face image dimensions wrong")
    if roi.ndim!=4 or roi.shape[1:]!=(1,96,96):
        raise ValueError("Region mask shape wrong")
    if roi.shape[0] not in (1,len(generated)) or float(roi.sum())<=0:
        raise ValueError("Nonempty region mask needed")
    return ((generated-observed).abs()*roi).sum() / (len(generated)*3*roi[0].sum())


def face_region_loss(pred,actual):
    whole,zones=dynamic_region_masks(pred.device)
    base=region_mae(pred,actual,whole)
    edge_x=(pred[:,:,:,1:]-pred[:,:,:,:-1]-
            actual[:,:,:,1:]+actual[:,:,:,:-1]).abs()
    edge_y=(pred[:,:,1:,:]-pred[:,:,:-1,:]-
            actual[:,:,1:,:]+actual[:,:,:-1,:]).abs()
    dx=(whole[:,:,:,1:]*whole[:,:,:,:-1])
    dy=(whole[:,:,1:,:]*whole[:,:,:-1,:])
    edge= (edge_x*dx).sum()/(len(pred)*3*dx.sum()) + \
          (edge_y*dy).sum()/(len(pred)*3*dy.sum())
    return base+.04*edge


def _metrics(trainer,renderer,loader,device):
    totals={
        "fullFaceDynamicROI_MAE":0.,
        "staticReferenceDynamicROI_MAE":0.,
        "shiftedWrongVocalDynamicROI_MAE":0.,
        "mouthRegionMAE":0.,
        "eyeBrowRegionMAE":0.,
        "cheekZygomaticRegionMAE":0.,
        "fullFaceOutputAudioSensitivity":0.,
        "sameAudioBetterThanShiftedGain":0.,
    }
    count=0
    whole,zones=dynamic_region_masks(device)
    trainer.eval()
    renderer.eval()
    with torch.no_grad():
        for data in loader:
            ref,mel,cue,target,unused_mouth,unused_motion,wrong_mel,wrong_cue=[
                t.to(device) for t in data
            ]
            exact=trainer(ref,mel,cue,stage="fusion")
            # Each source frame's real, synced singer audio controls
            # both the motion model and whole face renderer.
            generated=renderer(ref,mel,cue,exact["motion"],exact["projectedIrisMotion"])
            mismatch=trainer(ref,wrong_mel,wrong_cue,stage="fusion")
            mismatched=renderer(
                ref,wrong_mel,wrong_cue,
                mismatch["motion"],mismatch["projectedIrisMotion"])
            n=len(ref)
            values={
                "fullFaceDynamicROI_MAE":region_mae(generated,target,whole),
                "staticReferenceDynamicROI_MAE":region_mae(ref,target,whole),
                "shiftedWrongVocalDynamicROI_MAE":region_mae(mismatched,target,whole),
                "mouthRegionMAE":region_mae(generated,target,zones[2:3]),
                "eyeBrowRegionMAE":region_mae(generated,target,zones[0:1]),
                "cheekZygomaticRegionMAE":region_mae(generated,target,zones[1:2]),
                "fullFaceOutputAudioSensitivity":region_mae(
                    generated,mismatched,whole),
            }
            values["sameAudioBetterThanShiftedGain"]=(
                values["shiftedWrongVocalDynamicROI_MAE"] -
                values["fullFaceDynamicROI_MAE"])
            for k,v in values.items():
                totals[k]+=float(v)*n
            count+=n
    if not count:
        raise ValueError("No actual face/sound validation samples")
    return {k:round(v/count,7) for k,v in totals.items()}


def train_full_face(train_path: Path, source_motion_checkpoint: Path,
                    output_checkpoint: Path,*,epochs=2,batch_size=8,
                    lr=.0003,device="cpu"):
    if not 1<=epochs<=20 or not 2<=batch_size<=32 or not 1e-7<=lr<=.01:
        raise ValueError("Invalid full-face research train settings")
    if output_checkpoint.exists():
        raise FileExistsError("Research checkpoints may not overwrite older versions")
    if not source_motion_checkpoint.is_file():
        raise FileNotFoundError("Trained v13 singer motion checkpoint required")
    payload=torch.load(source_motion_checkpoint,map_location="cpu",weights_only=True)
    if (payload.get("modelVersion")!=MOTION_MODEL_VERSION or
            payload.get("commerciallyValidated") is not False):
        raise ValueError("Source motion checkpoint must be trusted research-only v13")
    source=StagedSingingFaceNet().to(device)
    source.load_state_dict(payload["stateDict"],strict=True)
    source.eval()
    for p in source.parameters():
        p.requires_grad_(False)
    train_ds=FullFaceVideoFrames(train_path/"train")
    val_ds=FullFaceVideoFrames(train_path/"val")
    train=DataLoader(train_ds,batch_size=batch_size,shuffle=True,num_workers=0)
    val=DataLoader(val_ds,batch_size=batch_size,shuffle=False,num_workers=0)
    torch.set_num_threads(min(torch.get_num_threads(),2))
    torch.manual_seed(44)
    render=FullFaceVocalRenderer().to(device)
    optimizer=torch.optim.AdamW(render.parameters(),lr=lr)
    best=float("inf")
    hist=[]
    for epoch in range(1,epochs+1):
        render.train()
        total=seen=0.
        for batch in train:
            reference,mel,cues,target,*_=[t.to(device) for t in batch]
            with torch.no_grad():
                motion=source(reference,mel,cues,stage="fusion")
            predicted=render(
                reference,mel,cues,motion["motion"],motion["projectedIrisMotion"])
            loss=face_region_loss(predicted,target)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(render.parameters(),1.)
            optimizer.step()
            total+=float(loss.detach())*len(reference)
            seen+=len(reference)
        stats=_metrics(source,render,val,device)
        stats.update(epoch=epoch,trainDynamicFaceLoss=round(total/seen,7))
        print("SONG_V14_FACE_RENDER_EPOCH="+json.dumps(stats,sort_keys=True),flush=True)
        hist.append(stats)
        if stats["fullFaceDynamicROI_MAE"]<best:
            best=stats["fullFaceDynamicROI_MAE"]
            output_checkpoint.parent.mkdir(parents=True,exist_ok=True)
            torch.save({
                "modelVersion":MODEL_VERSION,
                "stateDict":{k:v.detach().cpu() for k,v in render.state_dict().items()},
                "sourceMotionCheckpointSha256":hashlib.sha256(
                    source_motion_checkpoint.read_bytes()).hexdigest(),
                "epoch":epoch,
                "status":"research_only_unvalidated_full_face_render",
                "commerciallyValidated":False,
            },output_checkpoint)
    good=min(hist,key=lambda x:x["fullFaceDynamicROI_MAE"])
    diagnostics=[]
    if good["fullFaceDynamicROI_MAE"]>=good["staticReferenceDynamicROI_MAE"]:
        diagnostics.append("RENDERED_FACE_WORSE_THAN_STATIC_COPY")
    if good["sameAudioBetterThanShiftedGain"]<=.0001:
        diagnostics.append("CORRECT_VOCAL_NOT_BETTER_THAN_TIME_SHIFTED")
    if good["fullFaceOutputAudioSensitivity"]<=.0001:
        diagnostics.append("FULL_FACE_RENDER_UNRESPONSIVE_TO_SOUND")
    report={
        "modelVersion":MODEL_VERSION,"status":"research_only_not_lipsync_validated",
        "sameRecordedAudioUsedForBothTruthAndGeneration":True,
        "actualSourceVideoUsedOnlyAsGroundTruth":True,
        "trainFrames":len(train_ds),"heldoutFrames":len(val_ds),
        "bestValidation":good,"diagnosticFlags":diagnostics,
        "epochs":epochs,"history":hist,
        "fullFacePhotorealQualityValidated":False,
        "commercialUseAllowed":False,"canAcceptPaidJobs":False,
        "checkpointSha256":hashlib.sha256(output_checkpoint.read_bytes()).hexdigest(),
    }
    output_checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report
