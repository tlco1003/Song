"""SONG-Vision v27 — owner-only coupled jaw/mouth observation trainer.

Research grounding:
  1987 Kim et al., Korean vowel X-ray/photo study: lip opening and jaw angle
  showed an approximately linear relation, but lip pursing is independent.
  Masapollo et al. (2025): timing of jaw/lip articulators also matters.

DATA HONESTY:
  What is observed is CHIN PATCH IMAGE TRANSLATION (pixels) after upper-face
  registration and a mouth-shadow proxy, not mandibular bone angle or true
  upper/lower dentition geometry. The video images have NO validated vowel
  labels. Train/heldout partitions are temporally separated by source clip.
"""
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path
from typing import Sequence
import cv2
import numpy as np
from scipy.stats import spearmanr
from sklearn.isotonic import IsotonicRegression

PROJECT=Path(__file__).resolve().parent
try:
    from owner_mouth_library_v26 import (detect_face_crop, _alignment_fixed_upper_face,
                                         _measure_patch, segment_observed_outer_lip,load_video_face)
except ImportError:
    sys.path.insert(0,str(PROJECT.parent/'song_v26_work'))
    from owner_mouth_library_v26 import (detect_face_crop, _alignment_fixed_upper_face,
                                         _measure_patch, segment_observed_outer_lip,load_video_face)
CANVAS=320


def inspect_owner_frames(videos: Sequence[Path], neutral_path: Path, neutral_second:float=7.6,
                         probe_step:float=0.8, max_seconds:float=56):
    neutral,_=load_video_face(neutral_path,neutral_second)
    reference=cv2.cvtColor(neutral,cv2.COLOR_BGR2GRAY)
    x0,x1,y0,y1=135,185,270,294
    chin_template=reference[y0:y1,x0:x1]
    data=[];rejected=[];sources=[]
    for video in videos:
        cap=cv2.VideoCapture(str(video))
        if not cap.isOpened():raise FileNotFoundError(video)
        duration=float(cap.get(cv2.CAP_PROP_FRAME_COUNT)/cap.get(cv2.CAP_PROP_FPS))
        sources.append({'name':video.name,'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),
                        'seconds':round(duration,4)})
        for t in np.arange(1.0,min(max_seconds,duration-1),probe_step):
            cap.set(cv2.CAP_PROP_POS_MSEC,float(t*1000))
            ok,frame=cap.read()
            if not ok:
                rejected.append((video.name,float(t),'decode'));continue
            try:
                face,_=detect_face_crop(frame)
                registered,ecc,accepted=_alignment_fixed_upper_face(neutral,face)
                if not accepted or ecc<.83:
                    rejected.append((video.name,round(float(t),3),'upper-face alignment'));continue
                gray=cv2.cvtColor(registered,cv2.COLOR_BGR2GRAY)
                shadow,aspect,excess=_measure_patch(registered)
                _,contour=segment_observed_outer_lip(registered)
                search=gray[y0-16:y1+17,x0-6:x1+7]
                cc=cv2.matchTemplate(search,chin_template,cv2.TM_CCOEFF_NORMED)
                _,corr,_,point=cv2.minMaxLoc(cc)
                if corr<.85:
                    rejected.append((video.name,round(float(t),3),'chin patch match low confidence'));continue
                chin_shift=int(point[1]-16)
                record={'source':video.name,'s':round(float(t),3),'phase':float(t/duration),
                    'openingShadowProxyPx':int(shadow),
                    'outerLipHeightProxyPx':int(contour['outerLipHeightPx']),
                    'outerLipWidthProxyPx':int(contour['outerLipWidthPx']),
                    'chinImageShiftPx':chin_shift,'chinMatchCorrelation':round(float(corr),5),
                    'upperFaceECC':round(float(ecc),5),
                    'hasMandibleBoneAngleMeasurement':False,
                    'hasVerifiedKoreanPhoneme':False}
                data.append(record)
            except (ValueError,cv2.error) as exc:
                rejected.append((video.name,round(float(t),3),str(exc)[:90]))
        cap.release()
    return data,rejected,sources


def fit_owner_coupling(data:list[dict]):
    # fixed split: earliest 70% training, final 20% test; middle 10% unused
    train=[r for r in data if r['phase']<.70]
    held=[r for r in data if r['phase']>=.80]
    if len(train)<25 or len(held)<8:
        raise RuntimeError('FAIL CLOSED: not enough independent heldout owner frames')
    x=np.array([r['openingShadowProxyPx'] for r in train],np.float64)
    y=np.array([r['chinImageShiftPx'] for r in train],np.float64)
    xv=np.array([r['openingShadowProxyPx'] for r in held],np.float64)
    yv=np.array([r['chinImageShiftPx'] for r in held],np.float64)
    model=IsotonicRegression(increasing=True,out_of_bounds='clip',y_min=0.,y_max=20.)
    model.fit(x,y)
    preds=model.predict(xv)
    baseline=float(y.mean())
    model_mae=float(np.mean(np.abs(yv-preds)))
    baseline_mae=float(np.mean(np.abs(yv-baseline)))
    train_rho=float(spearmanr(x,y).statistic)
    val_rho=float(spearmanr(xv,yv).statistic)
    observed_span=np.percentile(y,[5,95]).tolist()
    report={
        'targetMeaning':'image-estimated chin patch vertical translation relative to upper-face stabilized neutral reference, px at 320x320',
        'inputMeaning':'mouth dark-interior pixel area proxy, not anatomical lip area',
        'sampleTrain':len(train),'sampleHeldout':len(held),
        'trainOpeningChinSpearman':round(train_rho,4),
        'heldoutOpeningChinSpearman':round(val_rho,4),
        'heldoutMeanAbsoluteErrorPx':round(model_mae,4),
        'heldoutStaticMeanAbsoluteErrorPx':round(baseline_mae,4),
        'improvesOnStaticHoldout':bool(model_mae<baseline_mae),
        'estimatedChinShiftTrain5to95PctPx':[round(float(v),3) for v in observed_span],
        'estimatedChinShiftReferenceMm':None,
        'mandibularBoneAngleMeasured':False,
        'oralCavityMedicalSegmentationAccuracyMeasured':False,
        'observedKoreanVowelGroundTruth':False,
        'temporalPartition':'first_70pct_train_last_20pct_independent_test_middle_10pct_excluded',
        'modelForm':'monotone isotonic regression (nonnegative 2D visual displacement prior)',
        'validatedForProduction':False,
    }
    if not report['improvesOnStaticHoldout'] or train_rho<=.15:
        raise RuntimeError('FAIL CLOSED: observed coupling does not improve static on heldout; cannot claim learned performance')
    profile={
        'trainedWithActualOwnerVideo':True,
        'inputOpeningShadowBreakpoints':[round(float(z),5) for z in model.X_thresholds_.tolist()],
        'predictedChinShiftPx':[round(float(z),5) for z in model.y_thresholds_.tolist()],
        'neutralOpeningShadowPx':207,
        'maxAllowedJawDeltaPx':min(13.,max(2.,float(np.percentile(y,95)-np.percentile(y,5)))),
        'referenceImageSizePx':320,
        'referenceVideo': 'IMG_0853.mp4',
        'referenceSecond':7.6,
        'status':'RESEARCH_MEASURED_IMAGE_DISPLACEMENT_NOT_BONE',
    }
    return profile,report


def train(videos:list[Path],out:Path):
    out.mkdir(parents=True,exist_ok=True)
    rows,rejections,sources=inspect_owner_frames(videos,videos[0])
    profile,metrics=fit_owner_coupling(rows)
    metrics['sourceVideoHashes']=sources
    metrics['samplingIntervalSeconds']=.8
    metrics['acceptedFrames']=len(rows)
    metrics['rejectedFrames']=len(rejections)
    (out/'OWNER_V27_JAW_OBSERVATION_PRIVATE.json').write_text(json.dumps({'records':rows,'rejections':rejections,'sources':sources},ensure_ascii=False,indent=2))
    (out/'OWNER_V27_LEARNED_JAW_PROFILE.json').write_text(json.dumps(profile,ensure_ascii=False,indent=2))
    (out/'OWNER_V27_JAW_HELDOUT_METRICS.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
    return profile,metrics

if __name__=='__main__':
    a=argparse.ArgumentParser()
    a.add_argument('--videos',nargs='+',type=Path,required=True)
    a.add_argument('--out',type=Path,required=True)
    args=a.parse_args()
    _,report=train(args.videos,args.out)
    print(json.dumps(report,ensure_ascii=False,indent=2))
