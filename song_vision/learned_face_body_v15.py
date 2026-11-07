"""SONG v15 trainable projected jaw / muscle-effect / skin mesh model.

A SELF-OWNED differentiable, anatomy-INFORMED *2-D projection* model.
No head CT/MRI, calibrated individual muscle insertion, FEM stress,
elastic modulus, true skull/bone geometry or electromyography is claimed.

A reference-landmark mesh is controlled by:
- rigid upper-head/skull anchor PRIOR (eyes + forehead/nose),
- moving lower-jaw hinge SURROGATE (not bone rotation measured by X-ray),
- trainable perioral, cheek, zygomatic, brow, lid and mentalis activity
  LATENT values, not observed muscle forces,
- smooth locally constrained projected soft-tissue displacement.
Outputs 478 rendered projected landmark positions for facial warping.
This is a component of our own model, not a third-party video generator.

Song meaning, actual vocal intensity, source face structure and optionally
author-reviewed expressive intent condition skin motion. No fixed mapping
'this word=>frown' or 'loud=>open mouth'.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import Dataset,DataLoader

from .staged_face_v13 import (
    StagedFaceFrames, StagedSingingFaceNet, MODEL_VERSION as FACE_VERSION
)
from .word_feelings_v15 import LearnedWordFeeling, TEXT_FEATURES
from .lyric_intent_v15 import load_reviewed_song_words, reviewed_context_at_time

MUSCLE_EFFECT_NAMES=(
    "orbicularis_oris_left_surrogate",
    "orbicularis_oris_right_surrogate",
    "zygomaticus_major_left_surrogate",
    "zygomaticus_major_right_surrogate",
    "buccinator_left_surrogate",
    "buccinator_right_surrogate",
    "corrugator_left_surrogate",
    "corrugator_right_surrogate",
    "orbicularis_oculi_left_surrogate",
    "orbicularis_oculi_right_surrogate",
    "mentalis_surrogate",
    "depressor_anguli_oris_left_surrogate",
    "depressor_anguli_oris_right_surrogate",
    "jaw_opening_surrogate",
)
CENTRE_LANDMARKS=(61,291,50,280,123,352,70,300,33,263,152,58,288,152)
EYE_FOREHEAD_HEAD_ANCHORS=(10,168,4,33,263,70,300)
LOWER_JAW_POINTS=(152,148,377,175,400,176,149,378,150,379)
VERSION="song-v15-projected-jaw-muscle-soft-tissue-face-v1"


class TrainableProjectedFaceRig(nn.Module):
    """Learn latent muscle-like actions and smooth, constrained face points.

    Reference normalized MediaPipe 478-point projection is input. The output
    xy is predicted; z is untouched because 2D source image is NOT a depth scan.
    """
    def __init__(self):
        super().__init__()
        self.acoustics=nn.Sequential(
            nn.Conv1d(8,24,5,padding=2),nn.GELU(),
            nn.AdaptiveAvgPool1d(4),nn.Flatten(),
            nn.Linear(96,64),nn.GELU())
        self.expression_motion=nn.Sequential(
            nn.Linear(38+4+TEXT_FEATURES+64+4,128),nn.GELU(),
            nn.Linear(128,96),nn.GELU(),
            nn.Linear(96,len(MUSCLE_EFFECT_NAMES)+2),
        )
        self.local_directions=nn.Parameter(torch.randn(len(MUSCLE_EFFECT_NAMES),2)*.03)
        self.jaw_hinge=nn.Linear(38+64,1)
        # Learned facial actions exist as proxies; never expose as EMG.
        self.register_buffer("anatomyCenters",torch.tensor(CENTRE_LANDMARKS,dtype=torch.long))

    def forward(self,reference_points,face_motion,iris_motion,vocal_cues,
                semantic_feature=None,expression_intent=None,
                semantic_present=None):
        b=len(reference_points)
        if (reference_points.shape!=(b,478,3) or
                face_motion.shape!=(b,38) or iris_motion.shape!=(b,4)
                or vocal_cues.shape!=(b,8,61) or
                not torch.isfinite(reference_points).all()):
            raise ValueError("Projected 478-point visible face and sound input required")
        if semantic_feature is None:
            semantic_feature=face_motion.new_zeros((b,TEXT_FEATURES))
        if expression_intent is None:
            expression_intent=face_motion.new_zeros((b,4))
        if semantic_present is None:
            semantic_present=face_motion.new_zeros((b,1))
        if (semantic_feature.shape!=(b,TEXT_FEATURES) or
                expression_intent.shape!=(b,4) or
                semantic_present.shape not in ((b,),(b,1))):
            raise ValueError("Mismatched lyric semantic context/intent")
        active=semantic_present.reshape(b,1).to(face_motion.dtype)
        # Meaning gate zero when there are no reviewed word/audio bindings.
        semantics=semantic_feature*active
        intent=expression_intent*active
        audio=self.acoustics(vocal_cues)
        inputs=torch.cat((face_motion,iris_motion,semantics,audio,intent),dim=1)
        latent=self.expression_motion(inputs)
        activity=torch.tanh(latent[:,:len(MUSCLE_EFFECT_NAMES)])
        # Landmark-localized smooth radial basis from actual reference face.
        xy=reference_points[:,:,:2]
        centers=xy.index_select(1,self.anatomyCenters)
        radial=((xy[:,:,None,:]-centers[:,None,:,:])**2).sum(dim=-1)
        support=torch.exp(-radial/(2*.06**2))
        vector=torch.tanh(self.local_directions)*.045
        deformation=(support*activity[:,None,:]).matmul(vector)
        # A jaw-hinge *image-plane proxy*. Rigid upper face anchors are
        # mechanically restrained; moving jawline responds separately.
        hinge=torch.tanh(self.jaw_hinge(torch.cat((face_motion,audio),1))) * .06
        nose_y=xy[:,4:5,1:2]
        chin_y=xy[:,152:153,1:2]
        lower=torch.clamp((xy[:,:,1:2]-nose_y) /
                          (chin_y-nose_y).abs().clamp(min=.05),0,1)
        deformation=deformation+torch.cat((
            hinge[:,:,None]*lower*0.,
            hinge[:,:,None]*lower,
        ),dim=-1).squeeze(2)
        # Face-wide projection translation/rotation is NOT learned as muscle.
        # Upper-face rigid anchors are strongly retained.
        fixed=face_motion.new_ones((b,478,1))
        fixed[:,list(EYE_FOREHEAD_HEAD_ANCHORS),:]=.02
        deformation=deformation*fixed
        predicted=reference_points.clone()
        predicted_xy=(xy+deformation).clamp(-.15,1.15)
        predicted=torch.cat((predicted_xy,reference_points[:,:,2:]),dim=-1)
        return {
            "predictedSurfacePoints":predicted,
            "estimatedFacialActivationProxy":activity,
            "estimatedJawDisplacement":hinge,
            "semanticConditionUsed":active,
        }


def soft_skin_smoothness(reference_points,predicted_points,neighbours=5):
    """Local displacement consistency (NOT a calibrated FEM model)."""
    if predicted_points.shape!=reference_points.shape or neighbours<2:
        raise ValueError("Expected comparable landmark meshes")
    ref=reference_points[:,:,:2]
    delta=predicted_points[:,:,:2]-ref
    dist=torch.cdist(ref.detach(),ref.detach())
    near=dist.topk(k=neighbours+1,largest=False).indices[:,:,1:]
    bb=torch.arange(len(ref),device=ref.device)[:,None,None]
    neighbour_displacement=delta[bb,near]
    return ((delta[:,:,None,:]-neighbour_displacement)**2).mean()


def proxy_skin_loss(reference_points,predicted_points,target_points):
    if (reference_points.shape!=predicted_points.shape or
            predicted_points.shape!=target_points.shape or
            target_points.shape[1:]!=(478,3)):
        raise ValueError("Cannot compare unaligned observed facial surfaces")
    # Camera-projected target coordinates, *not* internal physical bones.
    actual=F.smooth_l1_loss(predicted_points[:,:,:2],target_points[:,:,:2])
    smooth=soft_skin_smoothness(reference_points,predicted_points)
    anchor=F.l1_loss(
        predicted_points[:,list(EYE_FOREHEAD_HEAD_ANCHORS),:2],
        reference_points[:,list(EYE_FOREHEAD_HEAD_ANCHORS),:2])
    return actual+.01*smooth+.04*anchor


class RecordedFaceSkinSamples(Dataset):
    """True source and target landmarks from the same singer-video clip."""
    def __init__(self,prepared_split:Path):
        self.source=StagedFaceFrames(prepared_split)
        self.landmarks={}
        self.word_timelines={}
        for folder,*_ in self.source.records:
            if folder in self.landmarks:
                continue
            index=json.loads((folder/"index.json").read_text(encoding="utf-8"))
            with np.load(folder/"face-surface-v1.npz",allow_pickle=False) as f:
                point=f["surfacePoints"].copy()
                valid=f["valid"].copy()
            if len(point)!=len(index["frames"]):
                raise ValueError("Real video frames not matching face landmarks")
            by_file={row["file"]:(point[i],valid[i])
                     for i,row in enumerate(index["frames"])}
            self.landmarks[folder]=by_file
            lex=folder/"lyrics-reviewed-v15.json"
            self.word_timelines[folder]=(
                load_reviewed_song_words(lex,index["sourceVocalsSha256"])
                if lex.is_file() else None)
        self.records=[]
        for index,record in enumerate(self.source.records):
            folder,target,after,shifted,reference,*_=record
            pt,pok=self.landmarks[folder][target["file"]]
            rf,rok=self.landmarks[folder][reference["file"]]
            if pok and rok and np.isfinite(pt).all() and np.isfinite(rf).all():
                self.records.append(index)
        if len(self.records)<8:
            raise ValueError("Too few trusted observed face-surface pairs")

    def __len__(self):
        return len(self.records)

    def __getitem__(self,i):
        idx=self.records[i]
        record=self.source.records[idx]
        folder,target,after,shifted,reference,*_=record
        base=self.source[idx]
        ref,_=self.landmarks[folder][reference["file"]]
        actual,_=self.landmarks[folder][target["file"]]
        semantics=reviewed_context_at_time(
            self.word_timelines[folder],float(target["seconds"]))
        return {
            "face":base[0],"mel":base[1],"vocalCues":base[2],
            "shiftedMel":base[8],"shiftedCues":base[9],
            "referencePoints":torch.from_numpy(ref.copy()).float(),
            "targetPoints":torch.from_numpy(actual.copy()).float(),
            "codes":semantics["codes"],
            "wordsValid":semantics["wordsValid"],
            "semanticPresent":torch.tensor(semantics["reviewedWordPresent"]),
            "intent":semantics["intent"],
            "intentValid":torch.tensor(semantics["intentValid"]),
        }


def skin_motion_comparison(physics,stage,meaning,loader,device):
    scores={"trueVocalSurfaceMAE":0.,"staticRefSurfaceMAE":0.,
            "shiftedVocalSurfaceMAE":0.,"semanticReviewedFrameCount":0,
            "faceSurfaceFrameCount":0}
    physics.eval();stage.eval();meaning.eval()
    with torch.no_grad():
        for raw in loader:
            batch={k:v.to(device) for k,v in raw.items()}
            base=stage(batch["face"],batch["mel"],batch["vocalCues"],stage="fusion")
            text=meaning(batch["codes"],batch["wordsValid"])["phraseFeature"]
            intent=batch["intent"]*batch["intentValid"].unsqueeze(1)
            out=physics(batch["referencePoints"],base["motion"],
                        base["projectedIrisMotion"],batch["vocalCues"],
                        text,intent,batch["semanticPresent"])
            n=len(batch["face"])
            pred=out["predictedSurfacePoints"][:,:,:2]
            truth=batch["targetPoints"][:,:,:2]
            copied=batch["referencePoints"][:,:,:2]
            wrong_base=stage(batch["face"],batch["shiftedMel"],
                             batch["shiftedCues"],stage="fusion")
            shifted=physics(batch["referencePoints"],
                            wrong_base["motion"],wrong_base["projectedIrisMotion"],
                            batch["shiftedCues"],text,intent,
                            batch["semanticPresent"]
                            )["predictedSurfacePoints"][:,:,:2]
            scores["trueVocalSurfaceMAE"]+=float((pred-truth).abs().mean())*n
            scores["staticRefSurfaceMAE"]+=float((copied-truth).abs().mean())*n
            scores["shiftedVocalSurfaceMAE"]+=float((shifted-truth).abs().mean())*n
            scores["semanticReviewedFrameCount"]+=int(batch["semanticPresent"].sum())
            scores["faceSurfaceFrameCount"]+=n
    if not scores["faceSurfaceFrameCount"]:
        raise ValueError("No real performer-independent holdout")
    frames=scores["faceSurfaceFrameCount"]
    for k in ("trueVocalSurfaceMAE","staticRefSurfaceMAE","shiftedVocalSurfaceMAE"):
        scores[k]=round(scores[k]/frames,7)
    scores["correctVsMismatchedMotionGain"]=round(
        scores["shiftedVocalSurfaceMAE"]-scores["trueVocalSurfaceMAE"],7)
    return scores


def train_skin_projection(prepared:Path,v13_model:Path,
                          word_model:Path,output:Path,
                          *,epochs=2,batch_size=12,device="cpu"):
    if output.exists() or not 1<=epochs<=20 or not 2<=batch_size<=48:
        raise ValueError("Invalid face-skin training settings or archive exists")
    from .staged_face_v13 import MODEL_VERSION as V13
    from .word_feelings_v15 import VERSION as WORD_VERSION
    source=torch.load(v13_model,map_location="cpu",weights_only=True)
    words=torch.load(word_model,map_location="cpu",weights_only=True)
    if (source.get("modelVersion")!=V13 or
            words.get("modelVersion")!=WORD_VERSION or
            source.get("commerciallyValidated") is not False or
            words.get("commerciallyValidated") is not False):
        raise ValueError("Only trusted matching noncommercial source weights may initialize")
    torch.manual_seed(42)
    torch.set_num_threads(min(torch.get_num_threads(),2))
    stage=StagedSingingFaceNet().to(device).eval()
    stage.load_state_dict(source["stateDict"],strict=True)
    meaning=LearnedWordFeeling().to(device).eval()
    meaning.load_state_dict(words["stateDict"],strict=True)
    for net in (stage,meaning):
        for p in net.parameters():
            p.requires_grad_(False)
    train_data=RecordedFaceSkinSamples(prepared/"train")
    val_data=RecordedFaceSkinSamples(prepared/"val")
    training=DataLoader(train_data,batch_size=batch_size,shuffle=True,num_workers=0)
    val=DataLoader(val_data,batch_size=batch_size,shuffle=False,num_workers=0)
    rig=TrainableProjectedFaceRig().to(device)
    opt=torch.optim.AdamW(rig.parameters(),lr=.0003)
    hist=[];best=float("inf")
    for ep in range(1,epochs+1):
        rig.train()
        for data in training:
            batch={k:v.to(device) for k,v in data.items()}
            with torch.no_grad():
                f=stage(batch["face"],batch["mel"],batch["vocalCues"],stage="fusion")
                txt=meaning(batch["codes"],batch["wordsValid"])["phraseFeature"]
            pred=rig(batch["referencePoints"],f["motion"],
                     f["projectedIrisMotion"],batch["vocalCues"],txt,
                     batch["intent"]*batch["intentValid"].unsqueeze(1),
                     batch["semanticPresent"])
            loss=proxy_skin_loss(batch["referencePoints"],
                                 pred["predictedSurfacePoints"],batch["targetPoints"])
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(rig.parameters(),1.)
            opt.step()
        scores=skin_motion_comparison(rig,stage,meaning,val,device)
        scores["epoch"]=ep
        hist.append(scores)
        print("SONG_V15_REAL_FACE_SKIN_EPOCH="+json.dumps(scores),flush=True)
        if scores["trueVocalSurfaceMAE"]<best:
            best=scores["trueVocalSurfaceMAE"]
            output.parent.mkdir(parents=True,exist_ok=True)
            torch.save({
                "modelVersion":VERSION,
                "stateDict":{k:v.detach().cpu() for k,v in rig.state_dict().items()},
                "status":"research_only_unvalidated_checkpoint",
                "commerciallyValidated":False,
                "epoch":ep,
                "notActualBoneOrMuscleForce":True,
            },output)
    best_score=min(hist,key=lambda x:x["trueVocalSurfaceMAE"])
    diagnostics=[]
    if best_score["trueVocalSurfaceMAE"]>=best_score["staticRefSurfaceMAE"]:
        diagnostics.append("MESH_WORSE_THAN_STATIC_SKIN")
    if best_score["correctVsMismatchedMotionGain"]<=.0001:
        diagnostics.append("SOURCE_AUDIO_FACE_ALIGN_NOT_PROVEN")
    if best_score["semanticReviewedFrameCount"]==0:
        diagnostics.append("NO_WORD_TIMED_FACIAL_SEMANTIC_TRAINING_DATA")
    report={
        "status":"research_only_not_lipsync_validated",
        "modelVersion":VERSION,
        "modelType":"2D_ANATOMY_INFORMED_NOT_CALIBRATED_BIOMECHANICS",
        "actualBonesMeasured":False,
        "actualMuscleEMGMeasured":False,
        "actualSkinTissueStrainMeasured":False,
        "trainingFrames":len(train_data),"validationFrames":len(val_data),
        "bestValidation":best_score,"history":hist,
        "diagnosticFlags":diagnostics,"canAcceptPaidJobs":False,
        "commercialUseAllowed":False,
    }
    output.with_suffix(".report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report


def projected_tissue_warp(static_face:torch.Tensor,
                          reference_points:torch.Tensor,
                          predicted_points:torch.Tensor,
                          *,radius:float=.075)->torch.Tensor:
    """Differentiably warp actual source skin by predicted surface-point motion.

    This is image-plane morphing under a smooth local displacement field.
    It is NOT 3D collagen elasticity, real skin wrinkling, lighting or FEM.
    Trainable deformations are measured against actual same-video landmarks.
    """
    if (static_face.ndim!=4 or static_face.shape[1:]!=(3,96,96)
            or reference_points.shape!=(len(static_face),478,3)
            or predicted_points.shape!=reference_points.shape
            or not .02<=radius<=.20):
        raise ValueError("Expected source portrait and aligned 478-point visible surface")
    anchors=torch.tensor(CENTRE_LANDMARKS,device=static_face.device,dtype=torch.long)
    ref=reference_points[:,:,:2].index_select(1,anchors)
    moved=predicted_points[:,:,:2].index_select(1,anchors)
    axis=torch.linspace(0,1,96,device=static_face.device,dtype=static_face.dtype)
    yy,xx=torch.meshgrid(axis,axis,indexing="ij")
    grid=torch.stack((xx,yy),dim=-1).expand(len(static_face),-1,-1,-1)
    distances=((grid[:,:,:,None,:]-ref[:,None,None,:,:])**2).sum(dim=-1)
    influence=torch.exp(-distances/(2*radius**2))
    movement=((influence.unsqueeze(-1)*(moved-ref)[:,None,None,:,:]).sum(dim=3)/
              influence.sum(dim=3).unsqueeze(-1).clamp(min=.0001))
    sampling=(grid-movement).clamp(0,1)*2-1
    deformation=F.grid_sample(static_face,sampling,
                              mode="bilinear",padding_mode="border",align_corners=True)
    strength=influence.amax(dim=3).unsqueeze(1).clamp(0,1)
    return deformation*strength+static_face*(1-strength)
