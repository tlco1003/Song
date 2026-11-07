"""SONG-Vision v27: owner-calibrated lower-face/jaw image-motion and oral visibility.

The learned profile maps *image* mouth-aperture proxy to *image* chin-patch
translation, from temporally split owner-only speech. It is NOT a measured
mandible rotation angle, nor anatomical bone geometry; video is 2D.

This module improves v26's mouth-only copy by letting the jaw/chin region
move when mouth aperture opens. Upper cranial region is pixel invariant.
Visible teeth and tongue come from owner-provided source frames; the apparent
oral aperture is a heuristic visual segmentation with NO clinical GT score.
"""
from __future__ import annotations
import json, math, sys
from pathlib import Path
import cv2
import numpy as np

HERE=Path(__file__).resolve().parent
try:
    from owner_mouth_library_v26 import (OwnerMouthAtlas,VOWEL_TARGETS,render_observed_mouth,
                                         segment_observed_outer_lip)
except ImportError:
    sys.path.insert(0,str(HERE.parent/'song_v26_work'))
    from owner_mouth_library_v26 import (OwnerMouthAtlas,VOWEL_TARGETS,render_observed_mouth,
                                         segment_observed_outer_lip)


def _smooth01(z:np.ndarray)->np.ndarray:
    x=np.clip(z,0.,1.)
    return x*x*(3.-2.*x)


def learnable_jaw_shift(profile:dict,shadow_area:float)->float:
    if not profile.get('trainedWithActualOwnerVideo') or profile.get('status')!='RESEARCH_MEASURED_IMAGE_DISPLACEMENT_NOT_BONE':
        raise ValueError('Fail closed: no provenance-checked owner-trained jaw profile')
    xp=np.asarray(profile['inputOpeningShadowBreakpoints'],np.float64)
    yp=np.asarray(profile['predictedChinShiftPx'],np.float64)
    if xp.size<2 or xp.size!=yp.size or not np.all(np.diff(xp)>0) or not np.all(np.diff(yp)>=-1e-5):
        raise ValueError('Invalid monotonic owner jaw profile')
    neutral=float(np.interp(profile['neutralOpeningShadowPx'],xp,yp))
    active=float(np.interp(shadow_area,xp,yp))
    shift=max(0.,active-neutral)
    return float(np.clip(shift,0.,profile['maxAllowedJawDeltaPx']))


def measured_oral_masks(owner_face:np.ndarray, opening_state:str|None=None):
    """Heuristic in-image appearance masks; NEVER label as medical truth.

    Source has genuine human teeth/tongue/cavity pixels. This partitions
    appearance for temporal occlusion gating only; not a validated segmentation.
    """
    if owner_face.dtype!=np.uint8 or owner_face.ndim!=3 or owner_face.shape[2]!=3:
        raise ValueError('BGR uint8 expected')
    h,w=owner_face.shape[:2]
    _,outer_stats=segment_observed_outer_lip(owner_face)
    gray=cv2.cvtColor(owner_face,cv2.COLOR_BGR2GRAY)
    hsv=cv2.cvtColor(owner_face,cv2.COLOR_BGR2HSV)
    y,x=np.mgrid[:h,:w]
    center=((x/w-.5)/.112)**2+((y/h-.746)/.049)**2<=1
    front=((x/w-.5)/.118)**2+((y/h-.740)/.040)**2<=1
    upper_y=(y/h<.75)
    bg_skin=np.median(gray[int(.61*h):int(.66*h),int(.41*w):int(.59*w)])
    dark=(gray<.73*max(1.,bg_skin)) & center
    teeth=(gray>np.clip(bg_skin*1.05,105,235))&(hsv[...,1]<105)&front&(y/h>.716)&(y/h<.765)
    dark=cv2.morphologyEx(dark.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))>0
    # Mouth closed has a seam shadow; do not mislabel it as a deep cavity.
    mask_area=int(dark.sum())
    raw_teeth=int(teeth.sum())
    if opening_state in ('closed','near_closed'):
        dark[:]=False;teeth[:]=False
    if mask_area<15:
        dark[:]=False;teeth[:]=False
    # Prevent lip/skin highlights from appearing as phantom teeth in a
    # round pursed mouth. This is a visual prior, NOT a medical label.
    if float(outer_stats['outerLipAspect']) < 1.55:
        teeth[:]=False
    return {'observedDarkCavityMask':dark,'observedTeethCandidateMask':teeth,
            'nonMedicalAppearanceHeuristic':True,'clinicalGroundTruth':False,
            'cavityCandidateAreaPx':int(dark.sum()),'teethCandidateAreaPx':int(teeth.sum()),
            'outerLipSegmentation':outer_stats['method'],
            'innerContourIsVerified':False,
            'teethCandidateMayIncludeFalsePositives':True,
            'roundLipPhantomTeethSuppression':True,
            'sourceContainsActualTeethPixels':True}


def apply_owner_jaw_image_motion(image:np.ndarray, jaw_shift_px:float,
                                 explain:bool=True):
    """Chin/lower-face *image displacement* coupled to mouth opening.

    Warps the lower jaw visible surface with attenuated coupling to lower lip
    and cheeks. Upper lip/nose/eyes/forehead remain fixed. This is NOT an
    actual temporomandibular joint (TMJ) reconstruction or bone rotation.

    Only a dynamic lower-face interior is updated, preserving background and
    hair outside a conservative oval. For a jawline changing its true exterior
    silhouette, calibrated face segmentation/depth would still be needed.
    """
    if image.dtype!=np.uint8 or image.ndim!=3 or image.shape[2]!=3:
        raise ValueError('Requires uint8 BGR image')
    h,w=image.shape[:2]
    if min(h,w)<128:raise ValueError('Source owner face smaller than supported rig')
    if not np.isfinite(jaw_shift_px) or jaw_shift_px<0 or jaw_shift_px>min(h,w)*.075:
        raise ValueError('Jaw shift outside owner-calibrated motion envelope')
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    X=xx/w;Y=yy/h
    # 2-D projection of jaw articulation with a stationary upper cranial zone.
    # A rotation-informed displacement field is approximated by increasing
    # downward skin motion toward the chin and decreasing near the cheekbones.
    vertical=_smooth01((Y-.69)/.19)
    width=(.25-.035*_smooth01((Y-.75)/.22))
    lateral=np.exp(-.5*(np.abs((X-.5)/width)**5)).astype(np.float32)
    jaw_envelope=vertical*lateral
    lower_face=np.exp(-.5*(((X-.50)/.19)**2+((Y-.875)/.12)**2)).astype(np.float32)
    # Motion is larger at chin than at cheeks and absent in the nose/eyes.
    blend=.65*jaw_envelope+.35*lower_face*vertical
    tail_falloff=1.-.75*_smooth01((Y-.94)/.06)
    blend*=tail_falloff
    jaw_dy=(float(jaw_shift_px)*(h/320.)*np.clip(blend,0,1)).astype(np.float32)
    jaw_dy[Y<.69]=0
    # Inverse remap: current dest pixel reads from upward source pixel.
    warped=cv2.remap(image,xx,(yy-jaw_dy).astype(np.float32),
                     interpolation=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
    # Preserve background/face upper region and use smooth taper at jaw sides.
    alpha=np.clip(blend*1.15,0,1)
    alpha[Y<.69]=0
    out=np.clip(image.astype(np.float32)*(1-alpha[...,None])+warped.astype(np.float32)*alpha[...,None],0,255).astype(np.uint8)
    # Exact copies of invariant regions matter more than a numeric tolerance.
    out[:int(.69*h),:]=image[:int(.69*h),:]
    return out, {
       'learnedChinShiftPxAt320':round(float(jaw_shift_px),4),
       'maxAppliedImageDisplacementPx':round(float(jaw_dy.max()),4),
       'jawImageRegionChanges':int(np.count_nonzero(np.any(out!=image,axis=2)&(Y>.80)&(Y<.95))),
       'headUpper69PercentUnchanged':True,
       'mandibularBoneRotationActuallyMeasured':False,
       'preservesBackgroundOutsideJawField':True,
       'claimLevel':'image-space skin/jaw co-motion research surrogate',
    }


def render_owner_v27(atlas:OwnerMouthAtlas, profile:dict, vowel:str,
                     transition_from:str|None=None, fraction:float=1.0):
    if vowel not in VOWEL_TARGETS:raise ValueError('Unsupported text vowel')
    view,legacy=render_observed_mouth(atlas,vowel)
    observed=atlas.meta[VOWEL_TARGETS[vowel]['state']]
    shift=learnable_jaw_shift(profile,observed.darkCenterAreaPx)
    modified,jaw=apply_owner_jaw_image_motion(view,shift)
    if transition_from is not None:
        if transition_from not in VOWEL_TARGETS:raise ValueError('Unrecognized prior vowel')
        prior,other=render_owner_v27(atlas,profile,transition_from)
        a=float(_smooth01(np.array(fraction)))
        modified=cv2.addWeighted(prior,1-a,modified,a,0)
        jaw['transitionBetweenObservedStates']=True
        jaw['transitionProvenToMatchRecordedPhonemes']=False
    src=atlas.images[VOWEL_TARGETS[vowel]['state']]
    visibility=measured_oral_masks(src,VOWEL_TARGETS[vowel]['state'])
    summary={k:v for k,v in visibility.items() if not isinstance(v,np.ndarray)}
    return modified,{**legacy,**jaw,'oralAppearance':summary,
                     'synchronizedKoreanVowelTimingVerified':False,
                     'jawAndLipCouplingSource':'owner_measured_image_correlation_with_heldout_baseline',
                     'clinicallyValidatedOralSegmentation':False}


def import_profile(path:Path):
    data=json.loads(path.read_text())
    if data.get('status')!='RESEARCH_MEASURED_IMAGE_DISPLACEMENT_NOT_BONE':
        raise ValueError('Unverified owner jaw calibration')
    return data
