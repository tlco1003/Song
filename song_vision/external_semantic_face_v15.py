"""Offline self-built SONG-v15 learning trial: words -> expression -> projected skin.

Real noncommercial sources:
- Korean emotion words with human valence/arousal ratings (community copy,
  source rights for commercial use require verification).
- RAVDESS actor-sung video (CC BY-NC-SA 4.0). Actor 01+02 train, 03 held out.

NO false claim that RAVDESS English songs provide human word-level emotion
timing. Word ratings train Korean lexical affect representation separately;
the word->face causal coupling must later be supervised with time-aligned,
consented singer lyrics and expressive intent.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

import cv2
import torch
from torch.utils.data import DataLoader,Subset

from .external_ravdess_intensity_v12 import (
    ACTORS,check_performer_and_strength_split,
    make_v12_manifest,select_condition_balanced_singing,
)
from .external_ravdess_multisinger import (
    ACTOR_MD5, DATASET_ID, RECORD_URL,download_official_actor_zip
)
from .face_surface_motion import annotate_face_surface_dataset
from .real_training import prepare_manifest
from .staged_face_v13 import train_staged,StagedSingingFaceNet
from .word_feelings_v15 import (
    fetch_original_word_norms,train_word_meanings,LearnedWordFeeling
)
from .learned_face_body_v15 import (
    train_skin_projection,RecordedFaceSkinSamples,TrainableProjectedFaceRig,
    projected_tissue_warp
)
from .research_vault_v15 import seal_study_model

STUDY="SONG-v15-learned-word-affect-and-projected-facial-biomechanics"


def preview_stats(prepared:Path,stage_ckpt:Path,
                  word_ckpt:Path,skin_ckpt:Path,limit=40)->dict:
    """Compare SAME recorded singer audio against recorded facial frames."""
    import numpy as np
    from .full_face_renderer_v14 import dynamic_region_masks,region_mae
    if not 8<=limit<=200:
        raise ValueError("Heldout video comparisons limited to 8..200")
    data=RecordedFaceSkinSamples(prepared/"val")
    sel=Subset(data,list(range(min(limit,len(data)))))
    stage=StagedSingingFaceNet().eval()
    stage.load_state_dict(torch.load(stage_ckpt,map_location="cpu",
                                      weights_only=True)["stateDict"],strict=True)
    meaning=LearnedWordFeeling().eval()
    meaning.load_state_dict(torch.load(word_ckpt,map_location="cpu",
                                        weights_only=True)["stateDict"],strict=True)
    rig=TrainableProjectedFaceRig().eval()
    rig.load_state_dict(torch.load(skin_ckpt,map_location="cpu",
                                   weights_only=True)["stateDict"],strict=True)
    zone,regions=dynamic_region_masks()
    counts=0;total=0.;baseline=0.;shifted=0.
    by_part={name:0. for name in ("browsEyes","cheekZygomatic","lipsChin")}
    from .core import tensor_patch
    with torch.no_grad():
        for i in range(len(sel)):
            batch=sel[i]
            folder,target,after,wrong,source,*_=data.source.records[data.records[i]]
            image=cv2.imread(str(folder/"frames"/target["file"]))
            if image is None or image.shape!=(96,96,3):
                raise FileNotFoundError("Real observed source video frame missing")
            real=tensor_patch(image).unsqueeze(0)
            f=batch["face"].unsqueeze(0)
            mel=batch["mel"].unsqueeze(0)
            cues=batch["vocalCues"].unsqueeze(0)
            reference=batch["referencePoints"].unsqueeze(0)
            txt=meaning(batch["codes"].unsqueeze(0),
                        batch["wordsValid"].unsqueeze(0))["phraseFeature"]
            a=stage(f,mel,cues,stage="fusion")
            geom=rig(reference,a["motion"],a["projectedIrisMotion"],cues,
                     txt,batch["intent"].unsqueeze(0),
                     batch["semanticPresent"].reshape(1,1).float())
            rendered=projected_tissue_warp(
                f,reference,geom["predictedSurfacePoints"])
            wrong_mel=batch["shiftedMel"].unsqueeze(0)
            wrong_cue=batch["shiftedCues"].unsqueeze(0)
            other=stage(f,wrong_mel,wrong_cue,stage="fusion")
            other_geom=rig(reference,other["motion"],other["projectedIrisMotion"],
                           wrong_cue,txt,batch["intent"].unsqueeze(0),
                           batch["semanticPresent"].reshape(1,1).float())
            wrong_img=projected_tissue_warp(
                f,reference,other_geom["predictedSurfacePoints"])
            total+=float(region_mae(rendered,real,zone))
            baseline+=float(region_mae(f,real,zone))
            shifted+=float(region_mae(wrong_img,real,zone))
            for label,z in zip(by_part,regions):
                by_part[label]+=float(region_mae(rendered,real,z.unsqueeze(0)))
            counts+=1
    stats={
        "countHeldoutVideoFrames":counts,
        "correctOriginalVocalFullFaceROIMAE":round(total/counts,7),
        "staticReferenceROIMAE":round(baseline/counts,7),
        "mismatched320msVocalROIMAE":round(shifted/counts,7),
        "correctVocalVsWrongVocalGain":round((shifted-total)/counts,7),
        "faceWarpBetterThanStaticCopy":total<baseline,
        "correctVocalBetterThanShifted":(shifted-total)/counts>.0001,
        "regionMAE":{key:round(value/counts,7)
                     for key,value in by_part.items()},
        "actualFaceSkinPhotorealismValidated":False,
    }
    return stats


def run_v15(*,face_teacher:Path,owner_public_key:Path,
            archive_dir:Path,word_epochs=8,
            skin_epochs=1,video_audit_frames=30)->dict:
    if not face_teacher.is_file() or not owner_public_key.is_file():
        raise FileNotFoundError("Pinned local face teacher and owner public key required")
    if archive_dir.exists() and any(archive_dir.iterdir()):
        raise FileExistsError("Prior user research archives must never be overwritten")
    if not 1<=word_epochs<=40 or not 1<=skin_epochs<=12:
        raise ValueError("Invalid research epoch bounds")
    with tempfile.TemporaryDirectory(prefix="song-v15-original-faces-private-") as temp:
        root=Path(temp)
        source,source_sha=fetch_original_word_norms()
        word_ckpt=root/"word-valence-arousal-trained.pt"
        word_report=train_word_meanings(source,word_ckpt,epochs=word_epochs)
        recordings=[];md5={}
        for actor in ACTORS:
            archive=root/f"RAVDESS-Actor-{actor}.zip"
            md5[actor]=download_official_actor_zip(actor,archive)
            recordings.extend(select_condition_balanced_singing(archive,root,actor))
            archive.unlink()
        split=check_performer_and_strength_split(recordings)
        manifest=make_v12_manifest(recordings,root)
        prepared=root/"private-aligned-voice-face-mesh"
        prepare_manifest(manifest,prepared,save_acoustic_cues=True)
        label_coverage=annotate_face_surface_dataset(
            prepared,face_teacher,min_coverage=.80)
        v13_ckpt=root/"independent-v13-motion.pt"
        v13_report=train_staged(prepared,v13_ckpt,
                                epochs_per_stage=(1,1,1,1),batch_size=12)
        skin_ckpt=root/"projected-face-skin.pt"
        skin_report=train_skin_projection(prepared,v13_ckpt,
                                          word_ckpt,skin_ckpt,
                                          epochs=skin_epochs,batch_size=12)
        face_visual=preview_stats(
            prepared,v13_ckpt,word_ckpt,skin_ckpt,
            limit=video_audit_frames)
        run_id=os.getenv("GITHUB_RUN_ID","owner-private-research")
        attempt=os.getenv("GITHUB_RUN_ATTEMPT","1")
        archived={}
        for name,weights,study_report,source_id in (
            ("korean-word-semantics",word_ckpt,word_report,
             "KOREAN-EMOTION-WORD-RATINGS"),
            ("singing-face-motion-v13",v13_ckpt,v13_report,
             "RAVDESS-FACE-120"),
            ("facial-skin-physics-proxy",skin_ckpt,skin_report,
             "RAVDESS-FACE-120"),
        ):
            filename=f"song-v15-{name}-{run_id}-a{attempt}.svault"
            archived[name]=seal_study_model(
                weights,weights.with_suffix(".report.json"),
                owner_public_key,archive_dir/filename,
                dataset=source_id,run_id=f"{run_id}-a{attempt}")
        result={
            "study":STUDY,
            "realWordNormSource":word_report["source"],
            "wordNormSha256":source_sha,
            "primaryWordResearch":word_report["primaryPaper"],
            "measuredWordAffectModelBestMAE":word_report["bestValenceArousalMAE"],
            "wordAffectConstantBaselineMAE":word_report["baselineMAE"],
            "wordsHeldout":word_report["holdoutWords"],
            "wordFeelingsNotTheSingerActualEmotion":True,
            "realVideoSource":RECORD_URL,
            "singerLicense":"CC-BY-NC-SA-4.0",
            "performedRealActorSourceChecksums":md5,
            "singerHoldout":split,
            "trainFaceFrames":skin_report["trainingFrames"],
            "holdoutFaceFrames":skin_report["validationFrames"],
            "skinCoordinateResults":skin_report["bestValidation"],
            "skinTrainingDiagnostics":skin_report["diagnosticFlags"],
            "originalRecordedAudioFaceVisualResults":face_visual,
            "trainedActualWordToFaceCorrespondence": (
                skin_report["bestValidation"]["semanticReviewedFrameCount"]>0),
            "wordTrainingFromExternalRealHumanRatings":True,
            "boneMuscleSkinRepresentation":"2D_anatomy_informed_trainable_proxy_no_actual_EMG_or_skeleton",
            "encryptedResearchWeights":archived,
            "sourceMediaOrOriginalWordListPublished":False,
            "commercialUseAllowed":False,
            "canAcceptPaidJobs":False,
        }
        file=archive_dir/(f"song-v15-{run_id}-a{attempt}.manifest.json")
        file.write_text(json.dumps(result,ensure_ascii=False,indent=2,sort_keys=True),
                        encoding="utf-8")
        print("SONG_V15_SEMANTICS_AND_FACE_SKIN_REAL_RESEARCH="+
              json.dumps(result,ensure_ascii=False,sort_keys=True),flush=True)
        return result


def main():
    p=argparse.ArgumentParser(
        description="Self-owned semantic meanings + 2D jaw/muscle/skin training, research-only")
    p.add_argument("--acknowledge-noncommercial-research",action="store_true")
    p.add_argument("--face-landmarker-task",type=Path,required=True)
    p.add_argument("--owner-public-key",type=Path,required=True)
    p.add_argument("--encrypted-research-directory",type=Path,required=True)
    p.add_argument("--word-epochs",type=int,default=8)
    p.add_argument("--skin-epochs",type=int,default=1)
    p.add_argument("--compare-heldout-frames",type=int,default=30)
    args=p.parse_args()
    if not args.acknowledge_noncommercial_research:
        p.error("The underlying datasets are for noncommercial research; explicit acknowledgement required")
    run_v15(face_teacher=args.face_landmarker_task,
            owner_public_key=args.owner_public_key,
            archive_dir=args.encrypted_research_directory,
            word_epochs=args.word_epochs,skin_epochs=args.skin_epochs,
            video_audit_frames=args.compare_heldout_frames)


if __name__=="__main__":
    main()
